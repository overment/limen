import { constants } from "node:fs";
import { access, appendFile, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { repoRoot } from "../git.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
export async function initCommand(args: readonly string[], cwd: string): Promise<void> {
	if (args.length) throw new Error("init takes no arguments");
	const root = repoRoot(cwd);
	for (const legacy of [".control", ".agents/control", ".pi/extensions/control-wake.ts", ".pi/extensions/control-communication.ts"]) {
		if (await pathExists(`${root}/${legacy}`)) throw new Error(`legacy ${legacy} exists; run limen migrate instead`);
	}
	const copies = [
		[`${ROOT}/templates/agents.md`, `${root}/AGENTS.md`],
		[`${ROOT}/templates/worker.md`, `${root}/.agents/limen/worker.md`],
		[`${ROOT}/templates/reviewer.md`, `${root}/.agents/limen/reviewer.md`],
		[`${ROOT}/templates/communication.md`, `${root}/.agents/limen/communication.md`],
		[`${ROOT}/templates/spec/vision.md`, `${root}/spec/vision.md`],
		[`${ROOT}/templates/spec/build.md`, `${root}/spec/build.md`],
		[`${ROOT}/templates/spec/features/_template/ticket.md`, `${root}/spec/features/_template/ticket.md`],
		[`${ROOT}/templates/spec/features/_template/outcome.md`, `${root}/spec/features/_template/outcome.md`],
		...(["planned", "active", "done", "dropped"] as const).map((lane) => [`${ROOT}/templates/spec/features/${lane}/.gitkeep`, `${root}/spec/features/${lane}/.gitkeep`] as const),
		[`${ROOT}/hook/wake.ts`, `${root}/.pi/extensions/limen-wake.ts`],
		[`${ROOT}/hook/communication.ts`, `${root}/.pi/extensions/limen-communication.ts`],
	] as const;
	for (const [source, target] of copies) {
		await mkdir(dirname(target), { recursive: true });
		const exists = await pathExists(target);
		if (!exists) await copyFile(source, target, constants.COPYFILE_EXCL);
		console.log(`${exists ? "kept" : "created"} ${target.slice(root.length + 1)}`);
	}
	await Promise.all([mkdir(`${root}/.limen/jobs`, { recursive: true }), ensureIgnored(`${root}/.gitignore`)]);
	console.log("ready .limen/jobs");
}
async function ensureIgnored(path: string): Promise<void> {
	const exists = await pathExists(path);
	const content = exists ? await readFile(path, "utf8") : "";
	const relevant = content
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => [".limen/", "/.limen/", "!.limen/", "!/.limen/"].includes(line));
	if ([".limen/", "/.limen/"].includes(relevant.at(-1) ?? "")) return;
	const addition = `${content && !content.endsWith("\n") ? "\n" : ""}/.limen/\n`;
	if (exists) await appendFile(path, addition);
	else await writeFile(path, addition);
}
async function pathExists(path: string): Promise<boolean> {
	return access(path).then(
		() => true,
		() => false,
	);
}
