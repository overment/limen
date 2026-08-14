import { readFileSync } from "node:fs";
import { join } from "node:path";

const CUSTOM_TYPE = "limen-communication";

type SessionEntry = {
	readonly type: string;
	readonly customType?: string;
	readonly content?: unknown;
};
type Context = {
	readonly cwd: string;
	readonly sessionManager: { buildContextEntries(): readonly SessionEntry[] };
};
type PiApi = {
	on(event: "session_start", handler: (event: unknown, context: Context) => void): void;
	on(
		event: "before_agent_start",
		handler: (
			event: unknown,
			context: Context,
		) =>
			| undefined
			| {
					readonly message: {
						readonly customType: string;
						readonly content: string;
						readonly display: boolean;
					};
			  },
	): void;
};

/** Put stable project communication guidance in the coordinator thread, not the system prompt. */
export default function limenCommunication(pi: PiApi): void {
	let prompt = "";
	pi.on("session_start", (_event, context) => {
		prompt = process.env.LIMEN_JOB === "1" ? "" : readPrompt(context.cwd);
	});
	pi.on("before_agent_start", (_event, context) => {
		if (!prompt || hasPrompt(context.sessionManager.buildContextEntries(), prompt)) return;
		return { message: { customType: CUSTOM_TYPE, content: prompt, display: false } };
	});
}

function readPrompt(cwd: string): string {
	try {
		return readFileSync(join(cwd, ".agents/limen/communication.md"), "utf8").trim();
	} catch {
		return "";
	}
}

function hasPrompt(entries: readonly SessionEntry[], prompt: string): boolean {
	return entries.some((entry) => entry.type === "custom_message" && entry.customType === CUSTOM_TYPE && entry.content === prompt);
}
