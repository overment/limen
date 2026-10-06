import { readFile } from "node:fs/promises";
import { openJobPlace } from "../integrations/herdr.ts";
import { resolveJob } from "../job/lookup.ts";
import { limenRoot } from "../project/git.ts";

export async function openCommand(args: readonly string[], cwd: string): Promise<void> {
	const query = args[0];
	if (!query || args.length !== 1) {
		throw new Error("open requires exactly one job id");
	}
	const { jobDir } = await resolveJob(cwd, query, "read");
	console.log(
		await openJobPlace({ jobDir, cwd: limenRoot(cwd), running: (await text(`${jobDir}/state`)) === "running" }),
	);
}

function text(path: string): Promise<string> {
	return readFile(path, "utf8").then(
		(value) => value.trim(),
		() => "",
	);
}
