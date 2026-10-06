import { execFile } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { herdrBinary, hostedForegroundPid } from "../src/integrations/herdr.ts";
import { readHostedBinding, registerHostedBinding } from "../src/runtime/hosted-binding.ts";

type PiApi = {
	on(
		event: "session_start" | "session_shutdown" | "agent_settled",
		handler: (event: unknown, context: unknown) => void | Promise<void>,
	): void;
	on(
		event: "tool_execution_start",
		handler: (
			event: { readonly toolName?: string; readonly args?: { readonly command?: string } },
			context: unknown,
		) => void,
	): void;
	on(event: "tool_execution_end", handler: (event: unknown, context: unknown) => void): void;
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

// Herdr drops pane metadata after its TTL; an unchanged label is re-sent well before then.
const METADATA_TTL_MS = 180_000;
const METADATA_REFRESH_MS = 60_000;

/** Keep `.limen/jobs/<id>/` truthful for a Herdr-hosted pi (no JSON stream). */
export default function limenHosted(pi: PiApi): void {
	if (process.env.LIMEN_HOSTED !== "1" || process.env.LIMEN_JOB !== "1") {
		return;
	}
	const root = process.env.LIMEN_CONTEXT_ROOT;
	const id = process.env.LIMEN_JOB_ID;
	if (!root || !id) {
		return;
	}
	const jobDir = join(root, ".limen", "jobs", id);
	if (!existsSync(jobDir)) {
		return;
	}
	let tools = 0;
	let pendingTools = 0;
	let turnTools = 0;
	let metadataTimer: NodeJS.Timeout | undefined;
	let herdr: { readonly binary: string; readonly pane: string } | undefined;
	let seq = Date.now();
	let metadata = "";
	let metadataAt = 0;
	const report = (release = false) => {
		if (!herdr) {
			return;
		}
		try {
			// The supervisor owns warning metadata until it removes the advisory.
			if (!release && existsSync(join(jobDir, "advisory"))) {
				metadata = ""; // Restore ordinary labels on the first poll after recovery.
				return;
			}
			const state = release ? "" : readFileSync(join(jobDir, "state"), "utf8").trim();
			const body = ["running", "done", "failed", "stopped"].includes(state)
				? `job ${state.toUpperCase()}`
				: "job state unknown";
			if (!release && body === metadata && Date.now() - metadataAt < METADATA_REFRESH_MS) {
				return;
			}
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
						String(METADATA_TTL_MS),
					];
			seq += 1;
			execFile(
				herdr.binary,
				["pane", "report-metadata", herdr.pane, "--source", "limen", "--seq", String(seq), ...change],
				{ timeout: 2_000 },
				() => {},
			).unref();
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
			if (handoff) {
				write("result", handoff);
			}
			write("session-ended", new Date().toISOString());
			ctx.shutdown();
			return { content: [{ type: "text", text: "done" }], details: {} };
		},
	});
	pi.on("session_start", async (_event, context) => {
		mkdirSync(join(jobDir, "session"), { recursive: true });
		let pane = process.env.HERDR_PANE_ID?.trim() || "";
		if (readHostedBinding(jobDir)?.pid === process.pid) {
			try {
				pane = readFileSync(join(jobDir, "herdr/pane"), "utf8").trim();
			} catch {
				pane = "";
			}
		}
		const registered =
			hostedForegroundPid(pane, process.pid) === "present" && (await registerHostedBinding(jobDir, pane, context));
		const binding = registered ? readHostedBinding(jobDir) : undefined;
		if (binding) {
			write("engine-pid", String(binding.pid));
			write("engine-session", JSON.stringify({ pid: binding.pid, born: binding.born, sessionId: binding.sessionId }));
		} else if (readHostedBinding(jobDir)?.pid === process.pid) {
			rmSync(join(jobDir, "engine-session"), { force: true });
		}
		write("activity", "think");
		log(`[limen ${new Date().toISOString()}] hosted reporter attached`);
		const binary = herdrBinary();
		if (metadataTimer) {
			clearInterval(metadataTimer);
		}
		herdr = process.env.HERDR_ENV === "1" && binary && pane ? { binary, pane } : undefined;
		if (!herdr) {
			return;
		}
		report();
		// Refresh even through long silent turns; state changes remain the supervisor's responsibility.
		metadataTimer = setInterval(report, 1_000);
		metadataTimer.unref();
	});
	pi.on("agent_settled", () => report());
	pi.on("turn_start", () => {
		turnTools = 0;
		write("activity", pendingTools ? "tool" : "think");
		log("think");
	});
	pi.on("tool_execution_start", (event) => {
		const name = event.toolName?.trim() || "tool";
		tools += 1;
		pendingTools += 1;
		turnTools += 1;
		write("activity", "tool");
		write("last-tool", name);
		write("tool-detail", event.args?.command?.trim().replace(/\s+/g, " ").slice(0, 80) || name);
		write("tool-calls", String(tools));
		log(name);
	});
	pi.on("tool_execution_end", () => {
		pendingTools = Math.max(0, pendingTools - 1);
		write("activity", pendingTools ? "tool" : "think");
	});
	pi.on("turn_end", () => {
		// A turn end is not job completion — hosted jobs are multi-turn.
		write("last-turn-tools", String(turnTools));
		write("activity", pendingTools ? "tool" : "wait");
		log("wait");
	});
	pi.on("session_shutdown", () => {
		if (metadataTimer) {
			clearInterval(metadataTimer);
		}
		metadataTimer = undefined;
		report(true);
		herdr = undefined;
		write("activity", "wait");
		// Pi also emits shutdown on reload. Only finish or actual process exit ends the job.
		if (readHostedBinding(jobDir)?.pid === process.pid) {
			rmSync(join(jobDir, "engine-session"), { force: true });
		}
		log(`[limen ${new Date().toISOString()}] hosted session shutdown`);
	});
}
