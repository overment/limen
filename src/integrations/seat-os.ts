import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";

/**
 * The operating-system facts the GitHub doorbell reads on a seat: group ids, access rights and the poller's scheduled
 * service. Linux reads getent, getfacl and systemd; macOS reads Directory Services, `ls -le` ACLs and launchd.
 * Every reader is metadata only: never the App key, the poller env or sudo output.
 */
export type SeatPlatform = "linux" | "darwin";
export const seatPlatform = (): SeatPlatform => (process.platform === "darwin" ? "darwin" : "linux");

function run(bin: string, args: readonly string[]): string | undefined {
	const result = spawnSync(bin, args, { encoding: "utf8", timeout: 3000 });
	return result.status === 0 ? result.stdout.trim() : undefined;
}

/** A positive group id from `getent group NAME` (Linux) or `dscl . -read /Groups/NAME PrimaryGroupID` (macOS). */
export function parseGroupId(output: string, platform: SeatPlatform): number | undefined {
	const raw = platform === "darwin" ? /^PrimaryGroupID:\s*(\d+)\s*$/m.exec(output)?.[1] : output.split(":")[2];
	const id = Number(raw);
	return raw && /^\d+$/.test(raw) && Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

/** The id of a local group, or undefined when the account database has no such group. */
export function groupId(name: string, platform: SeatPlatform = seatPlatform()): number | undefined {
	const output =
		platform === "darwin"
			? run("dscl", [".", "-read", `/Groups/${name}`, "PrimaryGroupID"])
			: run("getent", ["group", name]);
	return output === undefined ? undefined : parseGroupId(output, platform);
}

export type Access = {
	readonly permission: "r" | "x";
	readonly poller: string;
	readonly pollerUid: number;
	readonly gid: number;
	readonly owner: number;
	readonly group: number;
	readonly mode: number;
	readonly directory: boolean;
};

/** Linux: the named user's ACL entry under the mask, else the owner, group or other class from `getfacl -cp`. */
export function linuxAclAllows(listing: string, access: Access): boolean {
	const { permission, poller, pollerUid, gid, owner, group } = access;
	const rows = listing.split("\n");
	const rights = (prefix: string) => rows.find((row) => row.startsWith(prefix))?.split(":")[2];
	if (owner === pollerUid) {
		return !!rights("user::")?.includes(permission);
	}
	const mask = rights("mask::") ?? "rwx";
	const named = rights(`user:${poller}:`);
	if (named !== undefined) {
		return named.includes(permission) && mask.includes(permission);
	}
	if (group === gid) {
		return !!rights("group::")?.includes(permission) && mask.includes(permission);
	}
	return !!rights("other::")?.includes(permission);
}

const ACL_ROW = /^\s*\d+:\s+user:(\S+)\s+(?:inherited\s+)?(allow|deny)\s+(\S+)\s*$/;
/**
 * macOS: the first `user:POLLER` entry in `ls -led` that names the right decides (deny before allow, in order);
 * without one, the POSIX owner, group or other bits decide. A directory's r is `list` and x is `search`.
 */
export function darwinAclAllows(listing: string, access: Access): boolean {
	const { permission, poller, pollerUid, gid, owner, group, mode, directory } = access;
	const right = directory ? (permission === "r" ? "list" : "search") : permission === "r" ? "read" : "execute";
	for (const row of listing.split("\n")) {
		const entry = ACL_ROW.exec(row);
		if (entry?.[1] === poller && entry[3]?.split(",").includes(right)) {
			return entry[2] === "allow";
		}
	}
	const bit = permission === "r" ? 4 : 1;
	if (owner === pollerUid) {
		return ((mode >> 6) & bit) !== 0;
	}
	if (group === gid) {
		return ((mode >> 3) & bit) !== 0;
	}
	return (mode & bit) !== 0;
}

/** Whether the poller may read (r) or traverse/execute (x) a path, from its owner, group, mode and ACL. */
export function aclAllows(
	path: string,
	poller: string,
	permission: "r" | "x",
	pollerUid: number,
	gid: number,
	platform: SeatPlatform = seatPlatform(),
): boolean {
	let entry: ReturnType<typeof statSync>;
	try {
		entry = statSync(path);
	} catch {
		return false;
	}
	const listing = platform === "darwin" ? run("ls", ["-led", path]) : run("getfacl", ["-cp", path]);
	if (listing === undefined) {
		return false;
	}
	const access: Access = {
		permission,
		poller,
		pollerUid,
		gid,
		owner: entry.uid,
		group: entry.gid,
		mode: entry.mode & 0o777,
		directory: entry.isDirectory(),
	};
	return platform === "darwin" ? darwinAclAllows(listing, access) : linuxAclAllows(listing, access);
}

export type PollerService = {
	readonly label: string;
	readonly user: string;
	readonly node: string;
	readonly release: string;
};
/**
 * A launchd job is the macOS poller service when it runs `NODE RELEASE/bin/limen github poll` as the poller, on a
 * timer, with PATH `/usr/bin:/usr/local/bin`. Input is `plutil -convert json` of the root-owned plist.
 */
export function launchdPollerOk(json: string, want: PollerService): boolean {
	let plist: {
		Label?: unknown;
		UserName?: unknown;
		ProgramArguments?: unknown;
		EnvironmentVariables?: { PATH?: unknown };
		StartInterval?: unknown;
		Program?: unknown;
	};
	try {
		plist = JSON.parse(json);
	} catch {
		return false;
	}
	const args = Array.isArray(plist.ProgramArguments) ? plist.ProgramArguments : [];
	const expected = [want.node, `${want.release}/bin/limen`, "github", "poll"];
	return (
		plist.Label === want.label &&
		plist.UserName === want.user &&
		plist.Program === undefined &&
		args.length === expected.length &&
		expected.every((arg, index) => args[index] === arg) &&
		plist.EnvironmentVariables?.PATH === "/usr/bin:/usr/local/bin" &&
		typeof plist.StartInterval === "number" &&
		plist.StartInterval > 0
	);
}

/** `launchctl print-disabled system` lists the label as disabled (`=> disabled`, or `=> true` on older macOS). */
export function launchdDisabled(listing: string, label: string): boolean {
	const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`"${escaped}"\\s*=>\\s*(?:disabled|true)\\b`).test(listing);
}

/** The macOS poller plist is a safe launchd job, as above. */
export function launchdServiceOk(plist: string, want: PollerService): boolean {
	const json = run("plutil", ["-convert", "json", "-o", "-", plist]);
	return json !== undefined && launchdPollerOk(json, want);
}

/** The macOS poller is loaded in the system domain and not disabled. */
export function launchdLoaded(label: string): boolean {
	const disabled = run("launchctl", ["print-disabled", "system"]);
	return (
		disabled !== undefined &&
		!launchdDisabled(disabled, label) &&
		run("launchctl", ["print", `system/${label}`]) !== undefined
	);
}
