export type Activity = "think" | "tool" | "wait";
export type StreamEvent =
	| { readonly kind: "log"; readonly line: string }
	| { readonly kind: "assistant"; readonly text: string; readonly stopReason?: string }
	| { readonly kind: "tool"; readonly name: string; readonly detail?: string }
	| { readonly kind: "activity"; readonly name: Activity };
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
		const text = assistantText(message),
			stopReason = assistantStopReason(message);
		return text || stopReason ? { kind: "assistant", text, ...(stopReason ? { stopReason } : {}) } : { kind: "activity", name: "think" };
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
