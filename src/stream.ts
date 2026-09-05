export type Activity = "think" | "tool" | "wait";
export type StreamEvent =
	| { readonly kind: "log"; readonly line: string }
	| { readonly kind: "assistant"; readonly text: string; readonly stopReason?: string }
	| { readonly kind: "tool"; readonly name: string; readonly detail?: string }
	| { readonly kind: "activity"; readonly name: Activity }
	| { readonly kind: "session"; readonly id: string };
export function createStreamParser(): { push(chunk: string): StreamEvent[]; flush(): StreamEvent[] } {
	let buffer = "";
	const take = (line: string): StreamEvent | undefined => {
		const trimmed = line.trim();
		if (!trimmed) return;
		if (!trimmed.startsWith("{")) return { kind: "log", line: trimmed };
		try {
			return interpret(JSON.parse(trimmed));
		} catch {
			return { kind: "log", line: trimmed };
		}
	};
	return {
		push(chunk) {
			buffer += chunk;
			const lines = buffer.split(/\r?\n/);
			buffer = lines.pop() ?? "";
			return compact(lines.map(take));
		},
		flush() {
			const event = take(buffer);
			buffer = "";
			return event ? [event] : [];
		},
	};
}
// Claude speaks a different stream: one JSON object per line, tool calls inside an assistant message,
// and one closing `result` that carries the authoritative final answer. Same four events come out.
export function createClaudeStreamParser(): { push(chunk: string): StreamEvent[]; flush(): StreamEvent[] } {
	let buffer = "";
	const take = (line: string): StreamEvent[] => {
		const trimmed = line.trim();
		if (!trimmed) return [];
		if (!trimmed.startsWith("{")) return [{ kind: "log", line: trimmed }];
		try {
			return interpretClaude(JSON.parse(trimmed));
		} catch {
			return [{ kind: "log", line: trimmed }];
		}
	};
	return {
		push(chunk) {
			buffer += chunk;
			const lines = buffer.split(/\r?\n/);
			buffer = lines.pop() ?? "";
			return lines.flatMap(take);
		},
		flush() {
			const events = take(buffer);
			buffer = "";
			return events;
		},
	};
}
function interpretClaude(event: unknown): StreamEvent[] {
	if (!event || typeof event !== "object" || !("type" in event)) return [];
	if (event.type === "system") {
		const id = "session_id" in event && typeof event.session_id === "string" ? event.session_id : "";
		return "subtype" in event && event.subtype === "init" && id
			? [
					{ kind: "session", id },
					{ kind: "activity", name: "think" },
				]
			: [];
	}
	if (event.type === "user") return [{ kind: "activity", name: "wait" }];
	// A clean run already logged its answer as the last assistant text, and that text is what the
	// coordinator files; the closing result only has to speak when the run failed.
	if (event.type === "result") {
		const subtype = "subtype" in event && typeof event.subtype === "string" ? event.subtype : "unknown";
		if (!(("is_error" in event && event.is_error === true) || subtype !== "success")) return [];
		const text = "result" in event && typeof event.result === "string" ? event.result.trim() : "";
		return [{ kind: "assistant", text, stopReason: `error: ${subtype}` }];
	}
	if (event.type !== "assistant") return [];
	const message = "message" in event ? event.message : undefined;
	const content = message && typeof message === "object" && "content" in message ? message.content : undefined;
	if (!Array.isArray(content)) return [];
	return content.flatMap((block): StreamEvent[] => {
		if (!block || typeof block !== "object" || !("type" in block)) return [];
		if (block.type === "tool_use" && "name" in block && typeof block.name === "string" && block.name.trim()) {
			const detail = "input" in block ? toolDetail(block.input) : "";
			return [{ kind: "tool", name: block.name.trim(), ...(detail ? { detail } : {}) }];
		}
		if (block.type === "text" && "text" in block && typeof block.text === "string" && block.text.trim()) return [{ kind: "assistant", text: block.text.trim() }];
		return [{ kind: "activity", name: "think" }];
	});
}
function interpret(event: unknown): StreamEvent | undefined {
	if (!event || typeof event !== "object" || !("type" in event)) return;
	const tool = "toolName" in event && typeof event.toolName === "string" ? event.toolName.trim() : "";
	if (event.type === "tool_execution_start" && tool) {
		const detail = "args" in event ? toolDetail(event.args) : "";
		return { kind: "tool", name: tool, ...(detail ? { detail } : {}) };
	}
	if (event.type === "tool_execution_end") return { kind: "activity", name: "wait" };
	if (event.type === "message_end") {
		const message = "message" in event ? event.message : undefined;
		if (!message || typeof message !== "object" || !("role" in message) || message.role !== "assistant") return { kind: "activity", name: "think" };
		const text = assistantText(message),
			stopReason = assistantStopReason(message);
		return { kind: "assistant", text, ...(stopReason ? { stopReason } : {}) };
	}
	if (event.type === "agent_start" || event.type === "turn_start" || event.type === "message_start" || event.type === "message_update") return { kind: "activity", name: "think" };
}
export function assistantText(message: unknown): string {
	if (!message || typeof message !== "object" || !("role" in message) || message.role !== "assistant") return "";
	if (!("content" in message) || !Array.isArray(message.content)) return "";
	return message.content
		.flatMap((part) => (part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part && typeof part.text === "string" ? [part.text] : []))
		.join("")
		.trim();
}
export function assistantStopReason(message: unknown): string {
	if (!message || typeof message !== "object" || !("role" in message) || message.role !== "assistant") return "";
	const reason = "stopReason" in message && (message.stopReason === "error" || message.stopReason === "aborted") ? message.stopReason : "";
	const detail = reason && "errorMessage" in message && typeof message.errorMessage === "string" ? message.errorMessage.replace(/\s+/g, " ").trim() : "";
	return detail ? `${reason}: ${detail}` : reason;
}
function toolDetail(args: unknown): string {
	if (!args || typeof args !== "object") return "";
	const pick =
		"command" in args && typeof args.command === "string"
			? args.command
			: "path" in args && typeof args.path === "string"
				? args.path
				: "file_path" in args && typeof args.file_path === "string"
					? args.file_path
					: "";
	return pick.trim().replace(/\s+/g, " ").slice(0, 80);
}
function compact(events: Array<StreamEvent | undefined>): StreamEvent[] {
	return events.filter((event): event is StreamEvent => event !== undefined);
}
