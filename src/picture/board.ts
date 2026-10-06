import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface BoardEntry {
	section: string;
	state: string;
	line: number;
}

const SECTIONS: Record<string, true> = { NOW: true, NEXT: true, PARKED: true, DROPPED: true, PROVEN: true };
const ENTRY = /^- `F(\d{3})-[a-z0-9]+(?:-[a-z0-9]+)*` \(\p{Extended_Pictographic}\uFE0F? ([A-Z][A-Z0-9_-]*)\):/u;

export async function readBoard(root: string): Promise<Map<string, BoardEntry>> {
	const text = await readFile(join(root, "spec", "build.md"), "utf8").catch((error: NodeJS.ErrnoException) => {
		if (error.code === "ENOENT") {
			return "";
		}
		throw error;
	});
	const entries = new Map<string, BoardEntry>();
	let section: string | null = null;
	for (const [index, line] of text.split(/\r?\n/).entries()) {
		const heading = /^## (\S+)$/.exec(line)?.[1];
		if (heading !== undefined) {
			section = SECTIONS[heading] ? heading : null;
		} else if (/^#{1,6}\s/.test(line)) {
			section = null;
		}
		if (!section) {
			continue;
		}
		const [, number, state] = ENTRY.exec(line) ?? [];
		if (number === undefined || state === undefined) {
			continue;
		}
		const id = `f${number}`;
		if (!entries.has(id)) {
			entries.set(id, { section, state, line: index + 1 });
		}
	}
	return entries;
}
