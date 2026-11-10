import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// The seat rotator writes flat files: `active` names the account, and `<name>.token` sits beside it.
// `claude-account-rotate` itself only checks and marks; it has no subcommand that prints a token, so Limen reads the files.
// A host job reads that token once, at start, and again on continue. The token never goes into argv or the job log.
const NAME = /^[A-Za-z0-9._@+-]{1,80}$/;
const TOKEN_MAX = 8_192;

export type SeatAccount = { readonly name: string; readonly token: string };

/**
 * The account a host job should bill. `LIMEN_CLAUDE_ACCOUNTS` forces that directory and ignores the live credentials
 * file, so a test cannot pick up a real login. Otherwise `~/.claude-accounts` wins, then Claude Code's credentials file.
 */
export function resolveSeatAccount(): SeatAccount | undefined {
	const forced = process.env.LIMEN_CLAUDE_ACCOUNTS?.trim();
	const found = readAccountsDir(forced || join(homedir(), ".claude-accounts"));
	if (found || forced) {
		return found;
	}
	return readCredentialsFile();
}

/** A token safe to place in a remote file: one line, bounded, no spaces. Anything else is refused, not logged. */
export function cleanToken(raw: string): string | undefined {
	const token = raw.trim();
	if (token.length < 20 || token.length > TOKEN_MAX || /\s/.test(token) || token.includes("\0")) {
		return undefined;
	}
	return token;
}

function readAccountsDir(root: string): SeatAccount | undefined {
	const named = firstLine(readText(join(root, "active")) ?? readText(join(root, ".active")));
	if (!NAME.test(named)) {
		return undefined;
	}
	// Production keeps `$ACCOUNTS/<name>.token` beside `active`. A directory `token` file is only a fallback.
	const token = cleanToken(
		readText(join(root, `${named}.token`)) ??
			readText(join(root, named, "token")) ??
			readText(join(root, named, "token.txt")) ??
			"",
	);
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
