export type Activity = "think" | "tool" | "wait";
export type StreamEvent =
	| { readonly kind: "log"; readonly line: string }
	| { readonly kind: "tool"; readonly name: string }
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
	if (event.type === "tool_execution_start" && tool) return { kind: "tool", name: tool };
	if (event.type === "tool_execution_end") return { kind: "activity", name: "wait" };
	if (event.type === "message_end") {
		const line = assistantText("message" in event ? event.message : undefined);
		return line ? { kind: "log", line } : { kind: "activity", name: "think" };
	}
	if (
		event.type === "agent_start" ||
		event.type === "turn_start" ||
		event.type === "message_start" ||
		event.type === "message_update"
	)
		return { kind: "activity", name: "think" };
}

function assistantText(message: unknown): string {
	if (!message || typeof message !== "object" || !("role" in message) || message.role !== "assistant") return "";
	if (!("content" in message) || !Array.isArray(message.content)) return "";
	return message.content
		.flatMap((part) =>
			part &&
			typeof part === "object" &&
			"type" in part &&
			part.type === "text" &&
			"text" in part &&
			typeof part.text === "string"
				? [part.text]
				: [],
		)
		.join("")
		.trim();
}

function compact(events: Array<StreamEvent | undefined>): StreamEvent[] {
	return events.filter((event): event is StreamEvent => event !== undefined);
}
