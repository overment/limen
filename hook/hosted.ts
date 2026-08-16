import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type PiApi = {
	on(event: "session_start" | "session_shutdown", handler: (event: unknown, context: unknown) => void): void;
	on(event: "tool_execution_start", handler: (event: { readonly toolName?: string }, context: unknown) => void): void;
	on(event: "turn_start" | "turn_end", handler: (event: unknown, context: unknown) => void): void;
};

/** Keep `.limen/jobs/<id>/` truthful for a Herdr-hosted pi (no JSON stream). */
export default function limenHosted(pi: PiApi): void {
	if (process.env.LIMEN_HOSTED !== "1" || process.env.LIMEN_JOB !== "1") return;
	const root = process.env.LIMEN_CONTEXT_ROOT;
	const id = process.env.LIMEN_JOB_ID;
	if (!root || !id) return;
	const jobDir = join(root, ".limen", "jobs", id);
	if (!existsSync(jobDir)) return;
	let tools = 0;
	const write = (name: string, content: string) => {
		try {
			writeFileSync(join(jobDir, name), content.endsWith("\n") ? content : `${content}\n`);
		} catch {
			// Advisory.
		}
	};
	const log = (line: string) => {
		try {
			appendFileSync(join(jobDir, "log"), line.endsWith("\n") ? line : `${line}\n`);
		} catch {
			// Advisory.
		}
	};
	pi.on("session_start", () => {
		mkdirSync(join(jobDir, "session"), { recursive: true });
		write("activity", "think");
		log(`[limen ${new Date().toISOString()}] hosted reporter attached`);
	});
	pi.on("turn_start", () => {
		write("activity", "think");
		log("think");
	});
	pi.on("tool_execution_start", (event) => {
		const name = event.toolName?.trim() || "tool";
		tools += 1;
		write("activity", "tool");
		write("last-tool", name);
		write("tool-calls", String(tools));
		log(name);
	});
	pi.on("turn_end", () => {
		// A turn end is not job completion — hosted jobs are multi-turn.
		write("activity", "wait");
		log("wait");
	});
	pi.on("session_shutdown", () => {
		write("activity", "wait");
		write("session-ended", new Date().toISOString());
		log(`[limen ${new Date().toISOString()}] hosted session shutdown`);
	});
}
