import { constants } from "node:fs";
import { access, appendFile, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { repoRoot } from "../git.ts";

const TEMPLATE_ROOT = fileURLToPath(new URL("../../templates", import.meta.url));
const HOOK = fileURLToPath(new URL("../../hook/wake.ts", import.meta.url));

export async function initCommand(_args: readonly string[], cwd: string): Promise<void> {
	const root = repoRoot(cwd);
	const copies = [
		[`${TEMPLATE_ROOT}/agents.md`, `${root}/AGENTS.md`],
		[`${TEMPLATE_ROOT}/worker.md`, `${root}/.agents/control/worker.md`],
		[`${TEMPLATE_ROOT}/reviewer.md`, `${root}/.agents/control/reviewer.md`],
		[`${TEMPLATE_ROOT}/spec/vision.md`, `${root}/spec/vision.md`],
		[`${TEMPLATE_ROOT}/spec/build.md`, `${root}/spec/build.md`],
		[`${TEMPLATE_ROOT}/spec/features/_template/ticket.md`, `${root}/spec/features/_template/ticket.md`],
		[HOOK, `${root}/.pi/extensions/control-wake.ts`],
	] as const;
	for (const [source, target] of copies) {
		await mkdir(dirname(target), { recursive: true });
		const exists = await pathExists(target);
		if (!exists) await copyFile(source, target, constants.COPYFILE_EXCL);
		console.log(`${exists ? "kept" : "created"} ${target.slice(root.length + 1)}`);
	}
	await mkdir(`${root}/.control/jobs`, { recursive: true });
	await ensureIgnored(`${root}/.gitignore`);
	console.log("ready .control/jobs");
}

async function ensureIgnored(path: string): Promise<void> {
	const exists = await pathExists(path);
	const content = exists ? await readFile(path, "utf8") : "";
	const relevant = content
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => [".control/", "/.control/", "!.control/", "!/.control/"].includes(line));
	if ([".control/", "/.control/"].includes(relevant.at(-1) ?? "")) return;
	const addition = `${content && !content.endsWith("\n") ? "\n" : ""}/.control/\n`;
	if (exists) await appendFile(path, addition);
	else await writeFile(path, addition);
}

async function pathExists(path: string): Promise<boolean> {
	return access(path).then(
		() => true,
		() => false,
	);
}
