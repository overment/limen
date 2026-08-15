import { readFile } from "node:fs/promises";
import { limenRoot } from "../git.ts";
import { openJobPlace } from "../herdr.ts";
import { resolveJob } from "../lookup.ts";

export async function openCommand(args: readonly string[], cwd: string): Promise<void> {
	const query = args[0];
	if (!query || args.length !== 1) throw new Error("open requires exactly one job id");
	const { jobDir } = await resolveJob(cwd, query);
	console.log(await openJobPlace({ jobDir, cwd: limenRoot(cwd), running: (await text(`${jobDir}/state`)) === "running" }));
}

function text(path: string): Promise<string> {
	return readFile(path, "utf8").then(
		(value) => value.trim(),
		() => "",
	);
}
