import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// The App key stays inside the broker server on the unix socket /var/lib/limen-token/token.sock.
// The seat's own git talks to that server through ~/.local/bin/limen-git-token. This module is that client.
// It never runs the server, and it never uses sudo: starting the server .mjs deletes and recreates the socket.
const CLIENT_NAME = "limen-git-token";

export type GithubBroker = {
	/** Executable client. Run directly, with the `owner/repo` as its only argument. */
	readonly command: string;
	/** Always true. `false` is rejected so a config file cannot ask Limen to sudo the server. */
	readonly direct: true;
};

export type MintedToken = {
	readonly token: string;
	readonly name?: string;
	readonly email?: string;
};

export type MintResult = {
	readonly minted?: MintedToken;
	/** Safe to log. Token-shaped text is removed. `no broker` means nothing is configured. */
	readonly detail: string;
};

/** `githubBroker` from hosts.json. Omitted means auto-detect. `direct: false` is refused. */
export function parseGithubBroker(value: unknown, path: string, ignored: string[]): GithubBroker | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${path} githubBroker must be an object`);
	}
	const body = value as Record<string, unknown>;
	const command = body.command;
	if (typeof command !== "string" || !command.trim() || /[\0\r\n]/.test(command)) {
		throw new Error(`${path} githubBroker.command must be a path`);
	}
	if (body.direct === false) {
		throw new Error(`${path} githubBroker.direct must be true; Limen does not start the broker server`);
	}
	if (body.direct !== undefined && body.direct !== true) {
		throw new Error(`${path} githubBroker.direct must be true`);
	}
	for (const key of Object.keys(body)) {
		if (key !== "command" && key !== "direct") {
			ignored.push(`githubBroker.${key}`);
		}
	}
	return { command: command.trim(), direct: true };
}

/** `owner/repo` from an HTTPS or ssh GitHub origin. Other urls are not sent to the client. */
export function githubRepo(url: string): string | undefined {
	const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(
		url.trim(),
	);
	return match?.[1];
}

/**
 * Which client to run. `LIMEN_GITHUB_BROKER` wins, then `githubBroker.command` in hosts.json, then
 * `~/.local/bin/limen-git-token` when that file is executable. Otherwise there is no client.
 */
export async function resolveBrokerCommand(configured?: GithubBroker): Promise<string | undefined> {
	const env = process.env.LIMEN_GITHUB_BROKER?.trim();
	if (env) {
		return env;
	}
	if (configured?.command) {
		return configured.command;
	}
	const detected = join(process.env.HOME?.trim() || homedir(), ".local", "bin", CLIENT_NAME);
	try {
		await access(detected, constants.X_OK);
		return detected;
	} catch {
		return undefined;
	}
}

/**
 * Asks the client for one installation token. The command is `<client> owner/repo`, the same call that already
 * worked with `LIMEN_GITHUB_BROKER` pointed at `limen-git-token`. Git itself may instead run that file as a
 * credential helper (`get`, with `protocol` and `host` on stdin). Stdout may be one token line, JSON
 * `{"token","name","email"}`, or helper attributes with `password=`. The token is not logged.
 */
export async function mintHostToken(repo: string, configured?: GithubBroker): Promise<MintResult> {
	if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
		return { detail: "not a github repo" };
	}
	const command = await resolveBrokerCommand(configured);
	if (!command) {
		return { detail: "no broker" };
	}
	const run = await execText(command, [repo]);
	const minted = run.code === 0 ? parseMint(run.stdout) : undefined;
	if (minted) {
		return { minted, detail: "" };
	}
	const detail = redactSecrets(run.stderr).trim();
	return { detail: detail || `broker exit ${run.code ?? "none"}` };
}

/** One check line per GitHub origin. The token is not included. */
export async function githubTokenLines(
	origins: readonly string[],
	configured?: GithubBroker,
): Promise<readonly string[]> {
	const lines: string[] = [];
	const seen = new Set<string>();
	for (const origin of origins) {
		const repo = githubRepo(origin);
		if (!repo || seen.has(repo)) {
			continue;
		}
		seen.add(repo);
		const minted = await mintHostToken(repo, configured);
		lines.push(minted.minted ? `github token ok ${repo}` : unavailable(repo, minted.detail));
	}
	return lines.length > 0 ? lines : ["github token skipped; no github.com origin"];
}

/** The job log line when the seat cannot hand the host a bot token. */
export function missingTokenLine(repo: string, detail: string): string {
	const why = detail === "no broker" ? "limen-git-token is not configured" : redactSecrets(detail).trim() || "no token";
	return `no seat GitHub bot token for ${repo} (${why}); the host push uses the host's own credentials`;
}

function unavailable(repo: string, detail: string): string {
	if (detail === "no broker") {
		return `github token unavailable ${repo}; limen-git-token is not configured`;
	}
	const why = redactSecrets(detail).trim();
	return why ? `github token unavailable ${repo}; ${why}` : `github token unavailable ${repo}`;
}

function parseMint(stdout: string): MintedToken | undefined {
	const text = stdout.trim();
	if (!text) {
		return undefined;
	}
	if (text.startsWith("{")) {
		try {
			const body = JSON.parse(text) as { token?: unknown; name?: unknown; email?: unknown };
			return typeof body.token === "string" ? clean(body.token, body.name, body.email) : undefined;
		} catch {
			return undefined;
		}
	}
	const password = text
		.split("\n")
		.map((line) => line.trim())
		.find((line) => line.startsWith("password="));
	if (password) {
		return clean(password.slice("password=".length), undefined, undefined);
	}
	const lines = text
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	return lines.length === 1 ? clean(lines[0] ?? "", undefined, undefined) : undefined;
}

function clean(token: string, name: unknown, email: unknown): MintedToken | undefined {
	const trimmed = token.trim();
	if (!trimmed || /\s/.test(trimmed) || trimmed.length > 512) {
		return undefined;
	}
	if (typeof name === "string" && typeof email === "string" && identity(name) && identity(email)) {
		return { token: trimmed, name, email };
	}
	return { token: trimmed };
}

const identity = (value: string): boolean => value.trim() !== "" && !/[\0\r\n]/.test(value);

export function redactSecrets(text: string): string {
	return text.replace(/\b(?:ghp_|gho_|ghu_|ghs_|ghr_|github_pat_)[A-Za-z0-9_]+/g, "[redacted]");
}

function execText(
	file: string,
	args: readonly string[],
): Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }> {
	const { promise, resolve } = Promise.withResolvers<{
		code: number | null;
		stdout: string;
		stderr: string;
	}>();
	execFile(file, [...args], { encoding: "utf8", timeout: 20_000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
		const status = (error as { status?: number } | null)?.status;
		resolve({
			code: error ? (typeof status === "number" ? status : null) : 0,
			stdout: stdout ?? "",
			stderr: stderr ?? "",
		});
	});
	return promise;
}
