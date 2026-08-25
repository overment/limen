import { spawn } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";

type SessionEntry = { readonly type?: unknown; readonly message?: { readonly role?: unknown; readonly content?: unknown } };
type SpeakContext = {
	readonly sessionManager: { getBranch(): readonly SessionEntry[] };
	readonly ui: { notify(message: string, level: "info" | "error"): void };
};
export type SpeakPiApi = {
	registerCommand?(name: string, options: { readonly description: string; handler(args: string, context: SpeakContext): void | Promise<void> }): void;
};

export function registerSpeak(pi: SpeakPiApi): void {
	const executable = executableOnPath("speak");
	if (!executable || !pi.registerCommand) return;
	pi.registerCommand("speak", {
		description: "Read the latest assistant response aloud; use /speak full to skip compression",
		async handler(args, context) {
			const mode = args.trim();
			if (mode && mode !== "full" && mode !== "--full") {
				context.ui.notify("usage: /speak [full]", "error");
				return;
			}
			const text = latestAssistantText(context.sessionManager.getBranch());
			if (!text) {
				context.ui.notify("No assistant response to speak", "error");
				return;
			}
			context.ui.notify(mode ? "Preparing full speech..." : "Preparing spoken brief...", "info");
			const error = await runSpeak(executable, text, Boolean(mode));
			context.ui.notify(error ? `Speech failed: ${error}` : "Speech finished", error ? "error" : "info");
		},
	});
}

export function latestAssistantText(entries: readonly SessionEntry[]): string | undefined {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (entry?.type !== "message" || entry.message?.role !== "assistant") continue;
		const content = entry.message.content;
		if (!Array.isArray(content)) return;
		const text = content
			.flatMap((part) => (part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part && typeof part.text === "string" ? [part.text] : []))
			.join("\n")
			.trim();
		return text || undefined;
	}
}

function executableOnPath(name: string): string | undefined {
	for (const directory of (process.env.PATH ?? "").split(delimiter)) {
		if (!directory) continue;
		const path = join(directory, name);
		try {
			accessSync(path, constants.X_OK);
			if (statSync(path).isFile()) return path;
		} catch {}
	}
}

function runSpeak(executable: string, text: string, full: boolean): Promise<string | undefined> {
	return new Promise((resolve) => {
		const child = spawn(executable, full ? ["--full"] : [], { stdio: ["pipe", "ignore", "pipe"] });
		let stderr = "";
		let settled = false;
		const finish = (error?: string) => {
			if (settled) return;
			settled = true;
			resolve(error);
		};
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk: string) => (stderr = `${stderr}${chunk}`.slice(-2000)));
		child.on("error", (error) => finish(error.message));
		child.on("close", (code) => finish(code === 0 ? undefined : stderr.trim() || `speak exited ${code}`));
		child.stdin.on("error", () => {});
		child.stdin.end(text);
	});
}
