import { constants } from "node:fs";
import { access, appendFile, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatDrift, listDrift, removeHookCopies } from "../../hook/inherit.ts";
import { registerProject } from "../../hook/seat.ts";
import { isGitRepository, repoRoot, workspaceRoot } from "../git.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
export async function initCommand(args: readonly string[], cwd: string): Promise<void> {
	const drop = args[0] === "--drop-leftovers";
	if (args.length && !(drop && args.length === 1)) throw new Error("init takes no arguments, or only --drop-leftovers");
	if (drop) {
		const root = workspaceRoot(cwd) ?? (isGitRepository(cwd) ? repoRoot(cwd) : undefined);
		if (!root) throw new Error("init --drop-leftovers requires a Limen project or workspace");
		for (const path of removeHookCopies(root)) console.log(`removed ${path}`);
		const leftovers = listDrift(root).filter((item) => item.kind === "leftover");
		if (!leftovers.length) console.log("no leftover copies");
		for (const item of leftovers) {
			await rm(`${root}/${item.path}`);
			console.log(`dropped ${item.path}`);
		}
		return;
	}
	if (!isGitRepository(cwd)) throw new Error("init requires a Git repository; run 'git init' first, or use 'limen workspace init' for a non-Git workspace");
	const root = repoRoot(cwd);
	for (const legacy of [".control", ".agents/control", ".pi/extensions/control-wake.ts", ".pi/extensions/control-communication.ts"]) {
		if (await pathExists(`${root}/${legacy}`)) throw new Error(`legacy ${legacy} exists; leftover Control path — rename or remove it by hand`);
	}
	await initialize(root, true);
}
export async function workspaceCommand(args: readonly string[], cwd: string): Promise<void> {
	if (args.length !== 1 || args[0] !== "init") throw new Error("workspace requires init");
	if (isGitRepository(cwd)) throw new Error("workspace init requires a non-Git parent directory");
	await initialize(resolve(cwd), false);
}
async function initialize(root: string, repository: boolean): Promise<void> {
	const copies = [
		[`${ROOT}/templates/styleguide.md`, `${root}/.agents/limen/styleguide.md`],
		[`${ROOT}/templates/spec/vision.md`, `${root}/spec/vision.md`],
		[`${ROOT}/templates/spec/build.md`, `${root}/spec/build.md`],
		...(repository ? [] : ([[`${ROOT}/templates/spec/workspace.md`, `${root}/spec/workspace.md`]] as const)),
		[`${ROOT}/templates/spec/features/_template/ticket.md`, `${root}/spec/features/_template/ticket.md`],
		[`${ROOT}/templates/spec/features/_template/outcome.md`, `${root}/spec/features/_template/outcome.md`],
		...(["planned", "active", "done", "dropped"] as const).map((lane) => [`${ROOT}/templates/spec/features/${lane}/.gitkeep`, `${root}/spec/features/${lane}/.gitkeep`] as const),
		[`${ROOT}/templates/limen-extension.ts`, `${root}/.pi/extensions/limen.ts`],
	] as const;
	for (const [source, target] of copies) {
		await mkdir(dirname(target), { recursive: true });
		const exists = await pathExists(target);
		if (!exists) await copyFile(source, target, constants.COPYFILE_EXCL);
		console.log(`${exists ? "kept" : "created"} ${target.slice(root.length + 1)}`);
	}
	for (const path of removeHookCopies(root)) console.log(`removed ${path}`);
	await mkdir(`${root}/.limen/jobs`, { recursive: true });
	await registerProject(root);
	if (repository) await ensureIgnored(`${root}/.gitignore`);
	console.log("ready .limen/jobs");
	const drift = formatDrift(listDrift(root));
	if (drift) console.log(drift);
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
