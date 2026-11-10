import { execFile } from "node:child_process";
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
	if (report.claudeKeychain && account) {
		console.log(
			`${host.alias}: host Claude keychain is locked for non-interactive ssh. Jobs still use the seat account. gh and git need a file credential; see docs/hosts.md.`,
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
	let pi = false;
	let git = false;
	let claudeOk = false;
	let claudeKeychain = false;
	for (const raw of text.split("\n")) {
		const line = raw.trim();
		if (!line) {
			continue;
		}
		if (line.startsWith("pi ")) {
			pi = line.startsWith("pi ok");
			lines.push(`${host.alias}: ${line}`);
		} else if (line.startsWith("git ")) {
			git = line === "git ok";
			lines.push(`${host.alias}: ${line}`);
		} else if (line.startsWith("claude ")) {
			claudeOk = line === "claude ok";
			claudeKeychain = /25308|User interaction is not allowed/i.test(line);
			lines.push(`${host.alias}: ${line}`);
		}
	}
	if (!pi) {
		lines.push(`${host.alias}: pi missing`);
	}
	if (!git && !lines.some((line) => line.includes(": git "))) {
		lines.push(`${host.alias}: git ls-remote failed`);
	}
	return { lines, ok: pi && git, claudeOk, claudeKeychain };
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
		const worktree = (await textFile(`${dir}/worktree`)) || root;
		if (dryRun) {
			console.log(`would delete origin/${branch}`);
			count += 1;
			continue;
		}
		const removed = await deleteBranch(worktree, branch);
		console.log(removed.line);
		if (removed.ok) {
			count += 1;
		}
	}
	return count;
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
