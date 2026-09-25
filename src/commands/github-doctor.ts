import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { access, lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bindingPath, originRepository, readBinding } from "./github.ts";

type Seat = {
	release: string;
	key: string;
	state: string;
	registry: string;
	timer: string;
	poller: string;
	node: string;
	herdr: string;
	cli?: string;
	alternateNode?: string;
	service?: string;
	sudoers?: string;
};
const seatDefaults = (): Seat => ({
	release: "/opt/limen",
	key: "/etc/limen-github/app.pem",
	state: "/var/lib/limen-github/state",
	registry: join(process.env.LIMEN_HOME || homedir(), ".limen/projects"),
	timer: "limen-github.timer",
	poller: "limen-github",
	node: "/usr/bin/node",
	herdr: "/usr/local/bin/herdr",
	cli: "/usr/local/bin/limen",
	service: "/etc/systemd/system/limen-github.service",
	alternateNode: "/usr/local/bin/node",
	sudoers: "/etc/sudoers.d/limen-github",
});

function command(bin: string, args: string[]): string | undefined {
	const result = spawnSync(bin, args, { encoding: "utf8", timeout: 3000 });
	return result.status === 0 ? result.stdout.trim() : undefined;
}

async function info(path: string) {
	return stat(path).catch(() => undefined);
}

async function safeParents(path: string, allowed: readonly number[]): Promise<boolean> {
	let current = dirname(await realpath(path).catch(() => path));
	for (;;) {
		const entry = await info(current);
		if (!entry?.isDirectory() || !allowed.includes(entry.uid) || (entry.mode & 0o022) !== 0) return false;
		if (current === dirname(current)) return true;
		current = dirname(current);
	}
}

async function rootExecutable(path: string): Promise<boolean> {
	const entry = await lstat(path).catch(() => undefined);
	return !!entry?.isFile() && entry.uid === 0 && (entry.mode & 0o022) === 0 && (entry.mode & 0o111) !== 0 && (await safeParents(path, [0]));
}

async function rootOwnedRelease(root: string): Promise<boolean> {
	const pending = [root];
	while (pending.length) {
		const dir = pending.pop() as string;
		const entries = await readdir(dir).catch(() => undefined);
		if (!entries) return false;
		for (const name of entries) {
			if (dir === root && (name === ".git" || name === "node_modules")) continue;
			const path = join(dir, name);
			const entry = await lstat(path).catch(() => undefined);
			if (!entry || entry.uid !== 0 || (entry.mode & 0o022) !== 0 || entry.isSymbolicLink()) return false;
			if (entry.isDirectory()) pending.push(path);
		}
	}
	return true;
}

function aclAllows(path: string, poller: string, permission: "r" | "x", uid: number, gid: number): boolean {
	const entry = command("getfacl", ["-cp", path]);
	if (!entry) return false;
	const owner = Number(command("stat", ["-c", "%u", path]));
	const group = Number(command("stat", ["-c", "%g", path]));
	const rows = entry.split("\n");
	const rights = (prefix: string) => rows.find((row) => row.startsWith(prefix))?.split(":")[2];
	if (owner === uid) return !!rights("user::")?.includes(permission);
	const mask = rights("mask::") ?? "rwx";
	const named = rights(`user:${poller}:`);
	if (named !== undefined) return named.includes(permission) && mask.includes(permission);
	if (group === gid) return !!rights("group::")?.includes(permission) && mask.includes(permission);
	return !!rights("other::")?.includes(permission);
}

// This inspects metadata and access only. Never read or print the App key, poller env, or sudo output.
export async function githubDoctor(root: string, seat: Seat = seatDefaults()): Promise<void> {
	let failures = 0;
	const report = (ok: boolean, label: string, fix: string) => {
		console.log(`${ok ? "OK" : "FIX"} ${label}${ok ? "" : ` — ${fix}`}`);
		if (!ok) failures++;
	};
	const pollerId = command("id", ["-u", seat.poller]);
	const pollerUid = pollerId && /^\d+$/.test(pollerId) ? Number(pollerId) : -1;
	const workerUid = process.getuid?.() ?? -1;
	const worker = userInfo().username;
	const groups = command("id", ["-nG"]);
	const sudo = spawnSync("sudo", ["-n", "-l"], { encoding: "utf8", timeout: 2000 });
	report(
		workerUid > 0 && workerUid !== pollerUid && !!groups && !/\b(?:sudo|wheel|admin)\b/.test(groups) && sudo.status !== 0,
		"worker has no sudo and is distinct from poller",
		"remove worker sudo/admin groups and noninteractive sudo grants as root; log in again",
	);
	report(pollerUid > 0, "isolated poller identity", `run docs/seat/github-setup.sh as root to create ${seat.poller}`);
	const group = command("getent", ["group", "limen-github"]);
	const gid = Number(group?.split(":")[2]);
	report(
		Number.isSafeInteger(gid) && gid > 0 && (process.getgroups?.() ?? []).includes(gid),
		"worker in limen-github group",
		`add ${worker} to limen-github as root; log in again`,
	);

	const release = await info(seat.release);
	const releaseSafe =
		release?.isDirectory() &&
		release.uid === 0 &&
		(release.mode & 0o022) === 0 &&
		(await rootExecutable(join(seat.release, "bin/limen"))) &&
		(await rootOwnedRelease(seat.release));
	report(
		!!releaseSafe,
		"root-owned poller release",
		`install the same landed Limen revision as this CLI at ${seat.release} with npm ci; keep all parents root-owned, not worker-writable`,
	);
	if (seat.cli) {
		const link = await lstat(seat.cli).catch(() => undefined);
		const directory = await lstat(dirname(seat.cli)).catch(() => undefined);
		const target = await realpath(seat.cli).catch(() => undefined);
		const selected = command("/bin/sh", ["-c", "command -v limen"]);
		report(
			!!link?.isSymbolicLink() &&
				link.uid === 0 &&
				!!directory?.isDirectory() &&
				directory.uid === 0 &&
				(directory.mode & 0o022) === 0 &&
				(await safeParents(dirname(seat.cli), [0])) &&
				(await safeParents(seat.cli, [0])) &&
				target === join(seat.release, "bin/limen") &&
				selected === seat.cli,
			"root-owned Limen CLI available on PATH",
			`as root run ln -sfnT ${seat.release}/bin/limen ${seat.cli}; keep /usr/local/bin root-owned mode 0755 and include it in the coordinator's noninteractive SSH PATH`,
		);
	}
	const nodeSafe = await rootExecutable(seat.node);
	report(
		nodeSafe && command(seat.node, ["-p", "process.versions.node.split('.')[0]"]) === "24",
		"root-owned Node 24 interpreter",
		`install a root-owned Node 24 binary at ${seat.node}; never link to the worker's NVM home; stop the timer until repaired`,
	);
	report(
		await rootExecutable(seat.herdr),
		"root-owned Herdr handoff binary",
		`install a root-owned Herdr binary at ${seat.herdr}, with root-owned non-writable parents; stop the timer until repaired`,
	);
	const service = seat.service ? await info(seat.service) : undefined;
	const unit = seat.service && (await readFile(seat.service, "utf8").catch(() => ""));
	if (seat.alternateNode) {
		const alternate = await lstat(seat.alternateNode).catch(() => undefined);
		report(
			!alternate || (await rootExecutable(seat.alternateNode)),
			"alternate Node path is not worker-controlled",
			`replace ${seat.alternateNode} with a root-owned Node 24 binary or remove it; never link to a worker NVM home`,
		);
	}
	report(
		!!service?.isFile() &&
			service.uid === 0 &&
			(service.mode & 0o022) === 0 &&
			!!unit?.includes(`ExecStart=${seat.node} ${seat.release}/bin/limen github poll`) &&
			unit.includes("User=limen-github") &&
			unit.includes("Environment=PATH=/usr/bin:/usr/local/bin") &&
			command("systemctl", ["show", "-P", "FragmentPath", "limen-github.service"]) === seat.service &&
			command("systemctl", ["show", "-P", "DropInPaths", "limen-github.service"]) === "" &&
			command("systemctl", ["show", "-P", "User", "limen-github.service"]) === seat.poller &&
			(command("systemctl", ["show", "-P", "ExecStart", "limen-github.service"]) ?? "").includes(`${seat.node} ${seat.release}/bin/limen github poll`),
		"safe poller service command and PATH",
		"install docs/seat/limen-github.service as root; use the root-owned interpreter explicitly",
	);
	const sudoers = seat.sudoers ? await info(seat.sudoers) : undefined;
	report(
		!!sudoers?.isFile() && sudoers.uid === 0 && (sudoers.mode & 0o777) === 0o440,
		"root-owned narrow sudo policy file",
		"install docs/seat/github-setup.sh sudo policy as root and validate with visudo -cf /etc/sudoers.d/limen-github",
	);
	if (releaseSafe) {
		const installed = command("git", ["-c", `safe.directory=${seat.release}`, "-C", seat.release, "rev-parse", "HEAD"]);
		const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
		const cli = command("git", ["-c", `safe.directory=${cliRoot}`, "-C", cliRoot, "rev-parse", "HEAD"]);
		report(
			!!installed && !!cli && installed === cli,
			"poller and CLI revision match",
			"deploy the same landed Git revision to /opt/limen and the coordinator CLI; restart the timer",
		);
	}

	const key = await info(seat.key);
	const keyLink = await lstat(seat.key).catch(() => undefined);
	const keySafe =
		key?.isFile() &&
		keyLink?.isFile() &&
		key.uid === pollerUid &&
		pollerUid > 0 &&
		(key.mode & 0o077) === 0 &&
		(await safeParents(seat.key, [0, pollerUid])) &&
		aclAllows(dirname(seat.key), seat.poller, "x", pollerUid, gid);
	const workerCannotRead = await access(seat.key, constants.R_OK).then(
		() => false,
		() => true,
	);
	report(
		!!keySafe && workerCannotRead,
		"App PEM poller-only and unreadable by worker",
		"install the PEM outside worker homes as poller:poller mode 0600 under root-owned /etc/limen-github; verify both identities with test -r",
	);
	const state = await info(seat.state);
	report(
		!!state?.isDirectory() && state.uid === pollerUid && pollerUid > 0 && (state.mode & 0o077) === 0 && (await safeParents(seat.state, [0, pollerUid])),
		"private poller state",
		"install /var/lib/limen-github/state as poller:poller mode 0700; keep parents non-worker-writable",
	);
	report(
		command("systemctl", ["is-enabled", seat.timer]) === "enabled" && command("systemctl", ["is-active", seat.timer]) === "active",
		"enabled active GitHub timer",
		"systemctl daemon-reload && systemctl enable --now limen-github.timer; inspect journalctl -u limen-github.service",
	);

	const registry = await readFile(seat.registry, "utf8").catch(() => undefined);
	let registryAccess = registry !== undefined && pollerUid > 0 && aclAllows(seat.registry, seat.poller, "r", pollerUid, gid);
	for (let parent = dirname(seat.registry); parent !== dirname(parent); parent = dirname(parent)) registryAccess &&= aclAllows(parent, seat.poller, "x", pollerUid, gid);
	report(registryAccess, "readable seat project registry", `create ${seat.registry} with limen init; grant poller read/traverse ACL`);
	const projects = registry?.split("\n").filter(Boolean) ?? [];
	report(projects.includes(root), "project registered on this seat", "run limen init in this checkout, then grant the poller traverse ACLs on its parents");
	const seen = new Set<string>();
	for (const project of [root, ...projects]) {
		if (seen.has(project)) continue;
		seen.add(project);
		if (!isAbsolute(project) || resolve(project) !== project) {
			report(false, `project registry path ${JSON.stringify(project)}`, "replace with an absolute normalized project root");
			continue;
		}
		const label = `project ${project}`;
		const registryPath = await info(project);
		const limen = await info(join(project, ".limen"));
		const github = await info(join(project, ".limen/github"));
		const bindingFile = await info(bindingPath(project));
		if (project !== root && !bindingFile) {
			console.log(`SKIP ${label} has no GitHub binding`);
			continue;
		}
		let traverse = !!registryPath?.isDirectory();
		for (let parent = project; parent !== dirname(parent); parent = dirname(parent)) traverse &&= aclAllows(parent, seat.poller, "x", pollerUid, gid);
		traverse &&= aclAllows(join(project, ".limen"), seat.poller, "x", pollerUid, gid);
		traverse &&= aclAllows(join(project, ".limen/github"), seat.poller, "x", pollerUid, gid) && aclAllows(bindingPath(project), seat.poller, "r", pollerUid, gid);
		report(
			!!traverse &&
				!!limen?.isDirectory() &&
				!!github?.isDirectory() &&
				!!bindingFile?.isFile() &&
				gid > 0 &&
				limen.gid === gid &&
				github.gid === gid &&
				bindingFile.gid === gid &&
				(bindingFile.mode & 0o007) === 0,
			`${label} registry ACL and binding access`,
			"run limen init then limen github connect in its coordinator; grant poller traverse ACL to checkout parents and group access to .limen/github",
		);
		const binding = await readBinding(project);
		let origin: string | undefined;
		try {
			origin = originRepository(project);
		} catch {
			/* an absent/invalid origin is reported below */
		}
		report(
			!!binding?.coordinator && !!binding.user && !!origin && binding.repo.toLowerCase() === origin.toLowerCase() && binding.user === worker,
			`${label} coordinator binding`,
			"from its persistent Herdr coordinator run limen github connect (or disconnect before changing origin)",
		);
		const agent = binding?.coordinator && command(process.env.LIMEN_HERDR || "herdr", ["agent", "get", binding.coordinator]);
		let live = false;
		try {
			const response = JSON.parse(agent ?? "null") as {
				result?: { agent?: { agent_status?: string; interactive_ready?: boolean; pane_id?: string } };
				agent?: { agent_status?: string; interactive_ready?: boolean; pane_id?: string };
				agent_status?: string;
				interactive_ready?: boolean;
				pane_id?: string;
			};
			const liveAgent = response.result?.agent ?? response.agent ?? response;
			const status = liveAgent.agent_status;
			live =
				liveAgent.pane_id === binding?.coordinator &&
				(status === "idle" || status === "working" || status === "blocked" || status === "done") &&
				liveAgent.interactive_ready === true;
		} catch {
			/* unavailable Herdr is a repair, not a reason to dump its response */
		}
		report(
			live,
			`${label} live registered Herdr agent`,
			"attach/start its persistent Herdr coordinator and reconnect if its pane identity changed; done is warm idle only with interactive_ready true",
		);
	}
	if (failures) throw new Error(`github doctor: ${failures} prerequisite${failures === 1 ? "" : "s"} need repair`);
}
