import { execFile } from "node:child_process";
import { existsSync } from "node:fs";

// The seat's GitHub App key stays with the limen-github user. This asks that user's broker for one installation
// token for one repo. The token is the broker's stdout. It is never an argument here and never written to a log.
const BROKER_USER = "limen-github";
const DEFAULT_BROKER = "/usr/local/libexec/limen-token-broker.mjs";

export type MintedToken = {
	readonly token: string;
	readonly name?: string;
	readonly email?: string;
};

export type MintResult = {
	readonly minted?: MintedToken;
	/** Safe to log: broker stderr with token-shaped text removed, or why there was no token. */
	readonly detail: string;
};

/** `LIMEN_GITHUB_BROKER`, or the seat path. A missing file means the host keeps its own git credentials. */
export function githubBrokerPath(): string {
	return process.env.LIMEN_GITHUB_BROKER?.trim() || DEFAULT_BROKER;
}

/** `owner/repo` from an HTTPS or ssh GitHub origin. Other urls are not sent to the broker. */
export function githubRepo(url: string): string | undefined {
	const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(
		url.trim(),
	);
	return match?.[1];
}

/**
 * Runs the broker. Production is `sudo -n -u limen-github -- node <broker> owner/repo`.
 * `LIMEN_GITHUB_BROKER_DIRECT=1` runs the file itself, which is how tests stand in for it.
 * Stdout is one token line, or JSON `{"token","name","email"}`.
 */
export async function mintHostToken(repo: string): Promise<MintResult> {
	const path = githubBrokerPath();
	if (!existsSync(path)) {
		return { detail: "no broker" };
	}
	if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
		return { detail: "not a github repo" };
	}
	const direct = process.env.LIMEN_GITHUB_BROKER_DIRECT === "1";
	const run = direct
		? await execText(path, [repo])
		: await execText("sudo", ["-n", "-u", BROKER_USER, "--", "node", path, repo]);
	const minted = run.code === 0 ? parseMint(run.stdout) : undefined;
	if (minted) {
		return { minted, detail: "" };
	}
	const detail = redactSecrets(run.stderr).trim();
	return { detail: detail || `broker exit ${run.code ?? "none"}` };
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
	return clean(text.split("\n")[0] ?? "", undefined, undefined);
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
