import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// The seat's rotator (claude-account-rotate, or a ~/.claude-accounts directory) picks the live Claude login.
// A host job reads that token once, at start, and again on continue. The token never goes into argv or the job log.
const NAME = /^[A-Za-z0-9._@+-]{1,80}$/;
const TOKEN_MAX = 8_192;

export type SeatAccount = { readonly name: string; readonly token: string };

/**
 * The account a host job should bill. `LIMEN_CLAUDE_ACCOUNTS` forces that directory and ignores the rotator and the
 * live credentials file, so a test cannot pick up a real login. Otherwise the rotator command wins, then the
 * directory, then Claude Code's own credentials file (what a swap has already written on the seat).
 */
export function resolveSeatAccount(): SeatAccount | undefined {
	const forced = process.env.LIMEN_CLAUDE_ACCOUNTS?.trim();
	if (forced) {
		return readAccountsDir(forced);
	}
	return readRotatorCommand() ?? readAccountsDir(join(homedir(), ".claude-accounts")) ?? readCredentialsFile();
}

/** A token safe to place in a remote file: one line, bounded, no spaces. Anything else is refused, not logged. */
export function cleanToken(raw: string): string | undefined {
	const token = raw.trim();
	if (token.length < 20 || token.length > TOKEN_MAX || /\s/.test(token) || token.includes("\0")) {
		return undefined;
	}
	return token;
}

function readRotatorCommand(): SeatAccount | undefined {
	const bin = process.env.LIMEN_CLAUDE_ROTATE?.trim() || "claude-account-rotate";
	const token = cleanToken(capture(bin, ["token"]) ?? "");
	if (!token) {
		return undefined;
	}
	const named = capture(bin, ["active"])?.trim() ?? "";
	return { name: NAME.test(named) ? named : "rotated", token };
}

function capture(bin: string, args: readonly string[]): string | undefined {
	const result = spawnSync(bin, [...args], { encoding: "utf8", timeout: 8_000, stdio: ["ignore", "pipe", "pipe"] });
	if (result.error || result.status !== 0) {
		return undefined;
	}
	return result.stdout;
}

function readAccountsDir(root: string): SeatAccount | undefined {
	const named = firstLine(readText(join(root, "active")) ?? readText(join(root, ".active")));
	if (!NAME.test(named)) {
		return undefined;
	}
	const token = cleanToken(readText(join(root, named, "token")) ?? readText(join(root, named, "token.txt")) ?? "");
	return token ? { name: named, token } : undefined;
}

function readCredentialsFile(): SeatAccount | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(join(homedir(), ".claude", ".credentials.json"), "utf8"));
	} catch {
		return undefined;
	}
	const oauth = field(parsed, "claudeAiOauth");
	const token = cleanToken(typeof oauth === "object" && oauth !== null ? stringField(oauth, "accessToken") : "");
	if (!token) {
		return undefined;
	}
	return { name: credentialName(), token };
}

function credentialName(): string {
	try {
		const parsed = JSON.parse(readFileSync(join(homedir(), ".claude.json"), "utf8")) as unknown;
		const account = field(parsed, "oauthAccount");
		const email = typeof account === "object" && account !== null ? stringField(account, "emailAddress") : "";
		return NAME.test(email) ? email : "seat";
	} catch {
		return "seat";
	}
}

function field(value: unknown, name: string): unknown {
	return typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;
}

function stringField(value: object, name: string): string {
	const member = Reflect.get(value, name);
	return typeof member === "string" ? member : "";
}

function readText(path: string): string | undefined {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
}

function firstLine(text: string | undefined): string {
	return text?.trim().split(/\r?\n/)[0]?.trim() ?? "";
}
