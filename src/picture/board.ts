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
		const heading = /^## (\S+)$/.exec(line);
		if (heading) {
			section = SECTIONS[heading[1]!] ? heading[1]! : null;
		} else if (/^#{1,6}\s/.test(line)) {
			section = null;
		}
		if (!section) {
			continue;
		}
		const match = ENTRY.exec(line);
		if (!match) {
			continue;
		}
		const id = `f${match[1]}`;
		if (!entries.has(id)) {
			entries.set(id, { section, state: match[2]!, line: index + 1 });
		}
	}
	return entries;
}
