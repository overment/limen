import { spawnSync } from "node:child_process";
import { chmod, mkdir, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWrite, textFile } from "../job/record.ts";

const LIMEN = fileURLToPath(new URL("../../bin/limen", import.meta.url));
const MARK = "# limen picture watch ";
// The tick must not inherit the routing or job identity of whoever moved the branch: no Git
// repository override, no coordinator wake route, no job context. Binary and home overrides stay.
const SCRUB = "^((GIT|HERDR|LIMEN|PI_SESSION)_[A-Za-z0-9_]*)=";
const KEEP = "LIMEN_(HOME|HERDR|OMP|PI|HUNK)";

type Watch = { readonly branch: string; readonly dir: string; readonly log: string; readonly flags: readonly string[] };

/** A project's watch is one Git hook in its own repository; no hook means off. */
export async function pictureWatch(
	cwd: string,
	mode: "on" | "off" | "status",
	dir: string | undefined,
	branch: string | undefined,
	flags: readonly string[],
): Promise<void> {
	const common = git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
	if (basename(common) !== ".git") {
		throw new Error(`picture watch needs a primary checkout; ${common} is not one`);
	}
	const root = dirname(common);
	const hook = git(root, ["rev-parse", "--path-format=absolute", "--git-path", "hooks/reference-transaction"]);
	const existing = await textFile(hook);
	const current = readWatch(existing);
	if (mode === "status") {
		console.log(
			current
				? `picture watch on: refs/heads/${current.branch} runs limen picture tick; log ${current.log}`
				: "picture watch off",
		);
		return;
	}
	if (mode === "off") {
		if (current) {
			await rm(hook);
		}
		console.log(current ? "picture watch off" : "picture watch already off");
		return;
	}
	if (existing && !current) {
		throw new Error(`${hook} already exists and is not a limen picture watch; limen will not replace it`);
	}
	const inside = relative(common, hook);
	if (inside.startsWith("..") || isAbsolute(inside)) {
		throw new Error(
			`core.hooksPath puts hooks at ${hook}, outside ${common}; limen installs the watch only in this repository's own hooks`,
		);
	}
	const watched =
		branch ??
		spawnSync("git", ["-C", root, "symbolic-ref", "--quiet", "--short", "HEAD"], { encoding: "utf8" }).stdout.trim();
	if (!watched) {
		throw new Error(`${root} has a detached HEAD; name the top branch with --branch`);
	}
	git(root, ["check-ref-format", "--branch", watched]);
	if (spawnSync("git", ["-C", root, "show-ref", "--verify", "--quiet", `refs/heads/${watched}`]).status !== 0) {
		throw new Error(`branch ${watched} does not exist in ${root}`);
	}
	const watch: Watch = {
		branch: watched,
		dir: dir ?? join(root, ".limen", "picture"),
		log: join(root, ".limen", "picture-watch.log"),
		flags,
	};
	if (spawnSync("git", ["-C", root, "check-ignore", "--quiet", "--", watch.dir]).status !== 0) {
		console.log(`warning: picture directory is not gitignored: ${watch.dir}`);
	}
	await mkdir(dirname(hook), { recursive: true });
	await atomicWrite(hook, hookText(root, watch));
	await chmod(hook, 0o755);
	console.log(`picture watch on: refs/heads/${watched} runs limen picture tick; log ${watch.log}`);
}

function readWatch(hook: string): Watch | undefined {
	const line = hook.split("\n").find((entry) => entry.startsWith(MARK));
	return line ? (JSON.parse(line.slice(MARK.length)) as Watch) : undefined;
}

function hookText(root: string, watch: Watch): string {
	const ref = `refs/heads/${watch.branch}`;
	const tick = [
		process.execPath,
		LIMEN,
		"picture",
		"tick",
		"--branch",
		watch.branch,
		"--dir",
		watch.dir,
		...watch.flags,
	]
		.map(quote)
		.join(" ");
	return `#!/bin/sh
${MARK}${JSON.stringify(watch)}
# Starts one background \`limen picture tick\` when ${ref} moves. It never delays or rejects a ref update.
# Remove with: limen picture watch off
[ "$1" = committed ] || exit 0
tip=
while read -r old new ref; do
	if [ "$ref" = ${quote(ref)} ] && [ "$old" != "$new" ]; then
		case $new in *[!0]*) tip=$new ;; esac
	fi
done
[ -n "$tip" ] || exit 0
unset $(env | sed -nE ${quote(`s/${SCRUB}.*/\\1/p`)} | grep -vxE ${quote(KEEP)})
cd ${quote(root)} || exit 0
mkdir -p ${quote(dirname(watch.log))}
(
	printf '%s %s moved to %s\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" ${quote(ref)} "$tip"
	exec ${tick}
) </dev/null >>${quote(watch.log)} 2>&1 &
exit 0
`;
}

const quote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;

function git(cwd: string, args: readonly string[]): string {
	const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
	}
	return result.stdout.trim();
}
