export type StreamEvent =
	| { readonly kind: "log"; readonly line: string }
	| { readonly kind: "tool"; readonly name: string };

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
	const record = event as { type?: unknown; toolName?: unknown; message?: unknown };
	if (record.type === "tool_execution_start" && typeof record.toolName === "string" && record.toolName.trim()) {
		return { kind: "tool", name: record.toolName.trim() };
	}
	if (record.type === "message_end") {
		const line = assistantText(record.message);
		if (line) return { kind: "log", line };
	}
	return;
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
