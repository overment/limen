import { readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import type { EngineId } from "./engine.ts";

/** Resolve only local paths. Pi, not Limen, interprets the selected module or package. */
export async function normalizeWorkerExtensions(
	paths: readonly string[],
	cwd: string,
	engine: EngineId,
): Promise<string[]> {
	if (paths.length && engine !== "pi") {
		throw new Error("--extension is supported only for Pi workers; use --engine pi");
	}
	const selected: string[] = [];
	for (const input of paths) {
		if (
			!input.trim() ||
			/[\0\r\n*?[\]]/.test(input) ||
			/^(?:[a-z][a-z0-9+.-]*:|[^/]+@[^/]+:|--)/i.test(input) ||
			(input.startsWith("~") && !input.startsWith("~/"))
		) {
			throw new Error(`extension must be a local file or directory path: ${JSON.stringify(input)}`);
		}
		const path = resolve(cwd, input.startsWith("~/") ? resolve(homedir(), input.slice(2)) : input);
		try {
			const canonical = await realpath(path);
			const info = await stat(canonical);
			if (!info.isFile() && !info.isDirectory()) {
				throw new Error("target is neither a file nor a directory");
			}
			if (!selected.includes(canonical)) {
				selected.push(canonical);
			}
		} catch (error) {
			throw new Error(`cannot use extension ${path}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return selected;
}

/** Missing records belong to legacy jobs; all other record errors must reach launch failure handling. */
export async function readWorkerExtensions(jobDir: string, engine: EngineId): Promise<string[]> {
	const record = `${jobDir}/extensions.json`;
	let body: string;
	try {
		body = await readFile(record, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return [];
		}
		throw new Error(`cannot read ${record}: ${String(error)}`);
	}
	let paths: unknown;
	try {
		paths = JSON.parse(body);
	} catch {
		throw new Error(`invalid ${record}: expected a JSON array of absolute local paths`);
	}
	if (!Array.isArray(paths) || !paths.every((path) => typeof path === "string" && isAbsolute(path))) {
		throw new Error(`invalid ${record}: expected a JSON array of absolute local paths`);
	}
	return normalizeWorkerExtensions(paths, jobDir, engine);
}
