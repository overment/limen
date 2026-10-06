import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Diagnostic, PictureFile } from "./picture-model.ts";

const DATA_DIRS = ["nodes", "edges", "features", "journeys"] as const;
const MAX_FILES = 10_000;

// Read only flat Markdown files; missing graph directories and unrelated paths are ignored.
export async function readDataset(dir: string): Promise<{ files: PictureFile[]; diagnostics: Diagnostic[] }> {
	const info = await stat(dir);
	if (!info.isDirectory()) {
		throw new Error(`picture directory ${dir} is not a directory`);
	}

	const diagnostics: Diagnostic[] = [];
	const sources: string[] = [];
	for (const name of DATA_DIRS) {
		const entries = await readdir(join(dir, name), { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") {
				return [];
			}
			throw error;
		});
		for (const entry of entries) {
			if (entry.isFile() && entry.name.endsWith(".md")) {
				sources.push(`${name}/${entry.name}`);
			}
		}
	}
	sources.sort();
	if (sources.length > MAX_FILES) {
		diagnostics.push({
			level: "error",
			code: "read.too-many",
			message: `more than ${MAX_FILES} files; only the first ${MAX_FILES} are read`,
			source: null,
			id: null,
			line: null,
		});
	}

	const files: PictureFile[] = [];
	for (const source of sources.slice(0, MAX_FILES)) {
		files.push({ source, text: await readFile(join(dir, source), "utf8") });
	}
	return { files, diagnostics };
}
