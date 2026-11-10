import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readOptional } from "../project/inherit.ts";

// Which shell commands a job's session surely ran, so a "Note check" line marked proven can name one as its evidence.
// Limen reads the recorded bash calls and their results; it never runs or replays them. What it cannot read is no
// proof, and each command keeps the reason, so the open check says why.

// A heredoc body is data, not commands: `<<'EOF'` up to the line that ends it, or to the end of an unfinished one.
// The rest of the opening line stays.
const HEREDOC = /<<-?[ \t]*(['"]?)([A-Za-z_]\w*)\1([^\n]*)\n[\s\S]*?(?:\n[ \t]*\2[ \t]*(?=\n|$)|$)/g;
// Leading assignments, `!` and wrappers that run the rest: `CI=1 timeout 60 npm test` runs `npm test`.
const PREFIX = /^(?:[A-Za-z_]\w*=(?:'[^']*'|"[^"]*"|[^\s'"])*\s+|!\s+|(?:time|nohup|env|command)\s+|timeout\s+\S+\s+)+/;
// A command name as written. Quotes, `\`, `$`, globs and braces can make `exit` or any other word of a name, and a
// name that starts with `-` is an option to a wrapper: `command -p exit 0` runs `exit`.
const NAME = /^(?:[\w@%+,./:~=][\w@%+,./:~=-]*|\[\[?)$/;
// A call that holds one of these may skip a later command and still exit 0: `if`, a loop or a function body may not
// run; `exit`, `exec`, or text run by `eval`, `source`, `.` or a `mapfile -C` callback can end the shell; `trap`,
// `set -n`, `shopt`, `hash -p`, `enable` and `alias` change what a later command runs.
const STOPPERS = new Set([
	...["if", "then", "else", "elif", "fi", "while", "until", "for", "do", "done", "case", "esac", "select", "coproc"],
	...["function", "{", "}", "exit", "return", "exec", "logout", "eval", "source", ".", "builtin", "trap", "set"],
	...["shopt", "hash", "enable", "alias", "mapfile", "readarray"],
]);
// OMP runs one shell for the whole session, so these change what every later call runs: a function, an option, a trap.
const KEPT = new Set(["function", "eval", "source", ".", "trap", "set", "shopt", "hash", "enable", "alias"]);
// One chain: simple commands joined by `&&` or a pipe. Any other separator starts a list, a subshell or a substitution.
const CHAINED = new Set(["", "&&", "|", "|&"]);
const PIPES = new Set(["|", "|&"]);
const SHOWN: Record<string, string> = { "\n": "a line break", "`": "a backtick" };
/** The reason for a command that no recorded bash call names as a command. */
export const NOT_NAMED = "no shell call names it as a command";

type Piece = { readonly words: string; readonly sep: string };
type Call = { readonly command: string; ok: boolean };
type Message = { role?: unknown; toolCallId?: unknown; toolName?: unknown; isError?: unknown; content?: unknown };
/** One simple command of a recorded bash call; `why` is empty when the call proves that it ran. */
export type Run = { readonly words: string; readonly why: string };
/** A command of a named chain that no call proves, and why. */
export type Gap = { readonly command: string; readonly why: string };

/**
 * Every simple command of the job's bash calls, Pi and OMP alike. One counts when its call ended with exit 0, the call
 * is one chain of commands joined by `&&` or a pipe, and no pipe follows it: a pipe's exit status is its last command's.
 */
export function sessionRuns(jobDir: string): Run[] {
	const omp = readOptional(join(jobDir, "engine"))?.trim() === "omp";
	return transcripts(jobDir).flatMap((lines) => {
		let kept = "";
		return bashCalls(lines).flatMap(({ command, ok }) => {
			const parts = pieces(command);
			const held = kept && `an earlier call in OMP's persistent shell holds \`${kept}\``;
			const why = (ok ? "" : "its shell call did not end with exit 0") || held || chainWhy(command, parts);
			kept ||= omp ? keptWord(command, parts) : "";
			return parts.map(({ words }, index) => ({
				words: words.replace(PREFIX, ""),
				why: why || (PIPES.has(parts[index + 1]?.sep ?? "") ? "a `|` follows it and hides its exit status" : ""),
			}));
		});
	});
}

/** Undefined when each simple command of `named` starts one that surely ran: `npm test -- --grep x` runs `npm test`. */
export function unproven(runs: readonly Run[], named: string): Gap | undefined {
	const wanted = pieces(named)
		.map((piece) => piece.words.replace(PREFIX, ""))
		.filter(Boolean);
	for (const want of wanted) {
		const matches = runs.filter(({ words }) => words === want || words.startsWith(`${want} `));
		if (!matches.some(({ why }) => !why)) {
			return { command: want, why: matches.at(-1)?.why ?? NOT_NAMED };
		}
	}
	return wanted.length ? undefined : { command: named, why: NOT_NAMED };
}

/** The bash calls of one transcript in order. A call is `ok` when the bash result that answers it is no error. */
function bashCalls(lines: readonly string[]): Call[] {
	const calls: Call[] = [];
	const waiting = new Map<unknown, Call>();
	for (const message of lines.map(recorded)) {
		const answered = message.role === "toolResult" && message.toolName === "bash" && waiting.get(message.toolCallId);
		if (answered) {
			answered.ok = message.isError === false;
			waiting.delete(message.toolCallId);
		}
		for (const part of Array.isArray(message.content) ? message.content : []) {
			if (part?.type === "toolCall" && part.name === "bash" && typeof part.arguments?.command === "string") {
				const call = { command: part.arguments.command, ok: false };
				calls.push(call);
				if (typeof part.id === "string") {
					waiting.set(part.id, call);
				}
			}
		}
	}
	return calls;
}

/** The message of one transcript line; a torn last line holds none. */
function recorded(line: string): Message {
	try {
		return JSON.parse(line)?.message ?? {};
	} catch {
		return {};
	}
}

function transcripts(jobDir: string): string[][] {
	const dir = join(jobDir, "session");
	let files: string[] = [];
	try {
		files = readdirSync(dir).filter((name) => name.endsWith(".jsonl"));
	} catch {
		// A job without a transcript ran no command Limen can see.
	}
	return files.map((file) =>
		(readOptional(join(dir, file)) ?? "")
			.split("\n")
			.filter((line) => line.includes('"toolCall"') || line.includes('"toolResult"')),
	);
}

/** Why exit 0 of this call proves nothing; empty when it is one chain of plain commands joined by `&&` or a pipe. */
function chainWhy(command: string, parts: readonly Piece[]): string {
	// `$'…'` quotes by other rules than '…'; Limen does not read it.
	if (command.includes("$'")) {
		return "its shell call holds `$'`";
	}
	for (const { words, sep } of parts) {
		const word = firstWord(words);
		if (!CHAINED.has(sep)) {
			return `its shell call holds ${SHOWN[sep] ?? `\`${sep}\``}`;
		}
		// `!` turns a failure into exit 0, also for a command the shell could not find.
		if (/(?:^|\s)!\s/.test(words.match(PREFIX)?.[0] ?? "")) {
			return "its shell call holds `!`";
		}
		if (STOPPERS.has(word) || (word && !NAME.test(word))) {
			return `its shell call holds \`${word}\``;
		}
	}
	return "";
}

/** What an OMP call leaves in its persistent shell for later calls: a function definition `()` or a word of `KEPT`. */
function keptWord(command: string, parts: readonly Piece[]): string {
	if (/\w\s*\(\s*\)/.test(command)) {
		return "()";
	}
	return parts.map(({ words }) => firstWord(words)).find((word) => KEPT.has(word)) ?? "";
}

const firstWord = (words: string): string => words.replace(PREFIX, "").split(" ")[0] ?? "";

/** Splits a shell call at its unquoted separators; each piece keeps the separator before it. Comments are dropped. */
function pieces(command: string): Piece[] {
	// A line end right after `&&` or a pipe continues the chain.
	// A host session can record the same call with CRLF. Normalize before continuation joining, or a
	// backslash-newline that proves a command on the seat becomes "a line break" for the host.
	const text = command
		.replaceAll("\r\n", "\n")
		.replaceAll("\r", "\n")
		.replace(HEREDOC, "$3")
		.replaceAll("\\\n", " ")
		.replace(/(&&|\|)[ \t]*\n/g, "$1 ")
		.trim();
	const found: Piece[] = [];
	let current = "";
	let sep = "";
	let quote = "";
	let escaped = false;
	for (let index = 0; index < text.length; index += 1) {
		// An unquoted `#` that starts a word begins a comment, which runs to the line end.
		if (!(quote || escaped) && text.charAt(index) === "#" && /^$|[\s;&|()]/.test(text.charAt(index - 1))) {
			const end = text.indexOf("\n", index);
			index = (end === -1 ? text.length : end) - 1;
			continue;
		}
		const next = quote || escaped ? "" : separator(text, index);
		if (next) {
			found.push({ words: squash(current), sep });
			current = "";
			sep = next;
			index += next.length - 1;
			continue;
		}
		const char = text.charAt(index);
		current += char;
		if (escaped) {
			escaped = false;
		} else if (char === "\\" && quote !== "'") {
			escaped = true;
		} else if (char === quote) {
			quote = "";
		} else if (!quote && (char === "'" || char === '"')) {
			quote = char;
		}
	}
	found.push({ words: squash(current), sep });
	return found;
}

/** The separator at `index`: `&&`, `||`, `|&`, `;`, `&`, `|`, `(`, `)`, a backtick or a line end. `2>&1` redirects. */
function separator(text: string, index: number): string {
	const pair = text.slice(index, index + 2);
	if (pair === "&&" || pair === "||" || pair === "|&") {
		return pair;
	}
	const char = text.charAt(index);
	const redirect = /[<>]/.test(text.charAt(index - 1)) || (char === "&" && text.charAt(index + 1) === ">");
	return !redirect && ";&|()`\n".includes(char) ? char : "";
}

const squash = (text: string): string => text.replace(/\s+/g, " ").trim();
