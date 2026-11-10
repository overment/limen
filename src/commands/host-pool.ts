import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { textFile } from "../job/record.ts";
import { repoRoot } from "../project/git.ts";
import { registeredProjects } from "../project/seat.ts";
import { resolveSeatAccount } from "../runtime/claude-account.ts";
import { hostCheckScript, type RemoteHost, shellText } from "../runtime/host-shell.ts";
import { hostByAlias, loadHostPool } from "../runtime/hosts.ts";

/** `limen hosts check ALIAS` and `limen hosts prune [--dry-run]`. */
export async function hostsCommand(args: readonly string[], cwd: string): Promise<void> {
	const [verb, ...rest] = args;
	if (verb === "check") {
		await checkHost(rest);
		return;
	}
	if (verb === "prune") {
		await prunePushedBranches(cwd, rest);
		return;
	}
	throw new Error("hosts check <alias> | hosts prune [--dry-run]");
}

async function checkHost(args: readonly string[]): Promise<void> {
	const alias = args[0];
	if (!alias || args.length > 1) {
		throw new Error("hosts check <alias>");
	}
	const host = hostByAlias(loadHostPool(), alias);
	if (!host.enabled) {
		throw new Error(`--host ${alias} is disabled`);
	}
	const result = await shellText(host, hostCheckScript(host), 40_000);
	const report = readCheck(host, `${result.stdout}\n${result.stderr}`);
	const account = resolveSeatAccount();
	console.log(report.lines.join("\n"));
	console.log(
		account
			? `${host.alias}: seat account ${account.name} (passed to a host job as CLAUDE_CODE_OAUTH_TOKEN; not stored there)`
			: `${host.alias}: no seat Claude account; a host job uses the host's own login`,
	);
	if (report.claudeKeychain) {
		console.log(
			`${host.alias}: keychain -25308: non-interactive ssh cannot unlock the login keychain. Host jobs use a file token on the seat; see docs/hosts.md.`,
		);
	}
	if (!report.ok || (!report.claudeOk && !account)) {
		throw new Error(`${host.alias} is not ready`);
	}
}

function readCheck(
	host: RemoteHost,
	text: string,
): { readonly lines: string[]; readonly ok: boolean; readonly claudeOk: boolean; readonly claudeKeychain: boolean } {
	const lines: string[] = [];
	const saw = { pi: false, node: false, git: false, hook: false };
	let pi = false;
	let node = false;
	let git = false;
	let hook = false;
	let claudeOk = false;
	let claudeKeychain = false;
	for (const raw of text.split("\n")) {
		const line = raw.trim();
		if (!line) {
			continue;
		}
		noteCheckLine(line, saw, (name, ok) => {
			if (name === "pi") {
				pi = ok;
			} else if (name === "node") {
				node = ok;
			} else if (name === "git") {
				git = ok;
			} else if (name === "hook") {
				hook = ok;
			} else {
				claudeOk = ok;
			}
		});
		if (/25308|User interaction is not allowed/i.test(line)) {
			claudeKeychain = true;
		}
		if (/^(?:pi|node|git|hook|claude) /.test(line)) {
			lines.push(`${host.alias}: ${line}`);
		}
	}
	for (const name of ["pi", "node", "git", "hook"] as const) {
		if (!saw[name]) {
			lines.push(`${host.alias}: ${name === "git" ? "git ls-remote failed" : `${name} missing`}`);
		}
	}
	return { lines, ok: pi && node && git && hook, claudeOk, claudeKeychain };
}

function noteCheckLine(
	line: string,
	saw: { pi: boolean; node: boolean; git: boolean; hook: boolean },
	set: (name: "pi" | "node" | "git" | "hook" | "claude", ok: boolean) => void,
): void {
	const name = /^(pi|node|git|hook|claude)\b/.exec(line)?.[1] as "pi" | "node" | "git" | "hook" | "claude" | undefined;
	if (!name) {
		return;
	}
	if (name !== "claude") {
		saw[name] = true;
	}
	if (line === `${name} ok` || line.startsWith(`${name} ok `)) {
		set(name, true);
	} else if (line === `${name} fail` || line === `${name} missing` || line.startsWith(`${name} missing`)) {
		set(name, false);
	}
}

async function prunePushedBranches(cwd: string, args: readonly string[]): Promise<void> {
	const dryRun = args.includes("--dry-run");
	if (args.some((arg) => arg !== "--dry-run")) {
		throw new Error("hosts prune [--dry-run]");
	}
	const roots = new Set<string>();
	try {
		roots.add(repoRoot(cwd));
	} catch {
		// The command can run from a seat that is not inside one project.
	}
	for (const root of registeredProjects()) {
		roots.add(root);
	}
	let deleted = 0;
	for (const root of roots) {
		deleted += await pruneRoot(root, dryRun);
	}
	if (deleted === 0) {
		console.log(dryRun ? "no limen branches to delete" : "no limen branches deleted");
	}
}

async function pruneRoot(root: string, dryRun: boolean): Promise<number> {
	const jobs = `${root}/.limen/jobs`;
	let count = 0;
	for (const id of await readdir(jobs).catch(() => [] as string[])) {
		const dir = `${jobs}/${id}`;
		const branch = await textFile(`${dir}/branch`);
		const state = await textFile(`${dir}/state`);
		if (!branch.startsWith("limen/") || (state !== "done" && state !== "failed" && state !== "stopped")) {
			continue;
		}
		const recorded = await textFile(`${dir}/worktree`);
		const gitDir = recorded && existsSync(recorded) ? recorded : root;
		if (!(await remoteHasBranch(gitDir, branch))) {
			continue;
		}
		if (dryRun) {
			console.log(`would delete origin/${branch}`);
			count += 1;
			continue;
		}
		const removed = await deleteBranch(gitDir, branch);
		console.log(removed.line);
		if (removed.ok) {
			count += 1;
		}
	}
	return count;
}

function remoteHasBranch(cwd: string, branch: string): Promise<boolean> {
	const want = `refs/heads/${branch}`;
	const { promise, resolve } = Promise.withResolvers<boolean>();
	// Exit status alone is not enough: a missing ref can still exit 0 with empty output.
	// Only an exact advertised ref counts, not a longer name that shares this prefix.
	execFile("git", ["ls-remote", "origin", want], { cwd, encoding: "utf8" }, (_error, stdout) => {
		resolve((stdout ?? "").split("\n").some((line) => line.endsWith(`\t${want}`)));
	});
	return promise;
}

function deleteBranch(cwd: string, branch: string): Promise<{ ok: boolean; line: string }> {
	const { promise, resolve } = Promise.withResolvers<{ ok: boolean; line: string }>();
	execFile("git", ["push", "origin", "--delete", branch], { cwd, encoding: "utf8" }, (error, _stdout, stderr) => {
		if (!error) {
			resolve({ ok: true, line: `deleted origin/${branch}` });
			return;
		}
		const message = (stderr || error.message).trim();
		const gone = /remote ref does not exist/i.test(message);
		resolve({
			ok: gone,
			line: gone ? `origin/${branch} already gone` : `could not delete origin/${branch}: ${message}`,
		});
	});
	return promise;
}
