import { rename, writeFile } from "node:fs/promises";

type PiApi = {
	on(event: "tool_execution_start", handler: () => Promise<void>): void;
};

export default function controlProgress(pi: PiApi): void {
	const path = process.env.CONTROL_TOOL_COUNT_FILE;
	delete process.env.CONTROL_TOOL_COUNT_FILE;
	if (!path) return;
	let count = 0;
	let pending = Promise.resolve();
	pi.on("tool_execution_start", () => {
		count += 1;
		const value = count;
		pending = pending.then(() => atomicWrite(path, `${value}\n`)).catch(() => {});
		return pending;
	});
}

async function atomicWrite(path: string, content: string): Promise<void> {
	const temporary = `${path}.${process.pid}.tmp`;
	await writeFile(temporary, content);
	await rename(temporary, path);
}
