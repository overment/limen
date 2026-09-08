import { execFile } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type PiApi = {
	on(event: "session_start" | "session_shutdown" | "agent_settled", handler: (event: unknown, context: unknown) => void): void;
	on(event: "tool_execution_start", handler: (event: { readonly toolName?: string }, context: unknown) => void): void;
	on(event: "turn_start" | "turn_end", handler: (event: unknown, context: unknown) => void): void;
	registerTool?(tool: {
		readonly name: string;
		readonly label: string;
		readonly description: string;
		readonly parameters: object;
		execute(
			toolCallId: string,
			params: { readonly handoff?: string },
			signal: unknown,
			onUpdate: unknown,
			ctx: { shutdown(): void },
		): Promise<{ content: Array<{ type: "text"; text: string }>; details: object }>;
	}): void;
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
	let turnTools = 0;
	let metadataTimer: NodeJS.Timeout | undefined;
	let herdr: { readonly binary: string; readonly pane: string } | undefined;
	let seq = Date.now();
	let metadata = "";
	let metadataAt = 0;
	const report = (release = false) => {
		if (!herdr) return;
		try {
			const state = release ? "" : readFileSync(join(jobDir, "state"), "utf8").trim();
			const body = ["running", "done", "failed", "stopped"].includes(state) ? `job ${state.toUpperCase()}` : "job state unknown";
			if (!release && body === metadata && Date.now() - metadataAt < 60_000) return;
			metadata = body;
			metadataAt = Date.now();
			const change = release
				? ["--clear-display-agent", "--clear-token", "limen", "--clear-state-labels"]
				: [
						"--display-agent",
						`limen ${process.env.LIMEN_ROLE?.trim() || "worker"}`,
						"--token",
						`limen=${body}`,
						"--state-label",
						`idle=${body} · pane ready`,
						"--state-label",
						`done=${body} · pane ready`,
						"--ttl-ms",
						"180000",
					];
			execFile(herdr.binary, ["pane", "report-metadata", herdr.pane, "--source", "limen", "--seq", String((seq += 1)), ...change], { timeout: 2_000 }, () => {}).unref();
		} catch {
			// Advisory. Never infer job completion from a pane settling or an unreadable record.
		}
	};
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
	pi.registerTool?.({
		name: "finish",
		label: "Finish",
		description: "End this hosted job. Pass the handoff text; the job is recorded done and the session exits.",
		parameters: {
			type: "object",
			properties: { handoff: { type: "string", description: "Handoff for the coordinator" } },
			required: ["handoff"],
		},
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const handoff = typeof params?.handoff === "string" ? params.handoff.trim() : "";
			if (handoff) write("result", handoff);
			ctx.shutdown();
			return { content: [{ type: "text", text: "done" }], details: {} };
		},
	});
	pi.on("session_start", () => {
		mkdirSync(join(jobDir, "session"), { recursive: true });
		write("activity", "think");
		log(`[limen ${new Date().toISOString()}] hosted reporter attached`);
		const binary = process.env.LIMEN_HERDR?.trim() || "herdr";
		const pane = process.env.HERDR_PANE_ID?.trim();
		if (metadataTimer) clearInterval(metadataTimer);
		herdr = process.env.HERDR_ENV === "1" && binary !== "0" && pane ? { binary, pane } : undefined;
		if (!herdr) return;
		report();
		// Refresh even through long silent turns; state changes remain the supervisor's responsibility.
		metadataTimer = setInterval(report, 1_000);
		metadataTimer.unref();
	});
	pi.on("agent_settled", () => report());
	pi.on("turn_start", () => {
		turnTools = 0;
		write("activity", "think");
		log("think");
	});
	pi.on("tool_execution_start", (event) => {
		const name = event.toolName?.trim() || "tool";
		tools += 1;
		turnTools += 1;
		write("activity", "tool");
		write("last-tool", name);
		write("tool-calls", String(tools));
		log(name);
	});
	pi.on("turn_end", () => {
		// A turn end is not job completion — hosted jobs are multi-turn.
		write("last-turn-tools", String(turnTools));
		write("activity", "wait");
		log("wait");
	});
	pi.on("session_shutdown", () => {
		if (metadataTimer) clearInterval(metadataTimer);
		metadataTimer = undefined;
		report(true);
		herdr = undefined;
		write("activity", "wait");
		write("session-ended", new Date().toISOString());
		log(`[limen ${new Date().toISOString()}] hosted session shutdown`);
	});
}
