import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { removeHookCopies } from "../../hook/inherit.ts";
import { repoRoot } from "../git.ts";
import { processGroupAlive } from "../proc.ts";

type Kind = "none" | "file" | "directory";
type Pair = { readonly old: string; readonly next: string; oldKind?: Kind; nextKind?: Kind };
type ExtensionPair = Pair & { readonly name: string };
const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));
export async function migrateCommand(args: readonly string[], cwd: string): Promise<void> {
	if (args.length) throw new Error("migrate takes no arguments");
	const root = repoRoot(cwd);
	const directories: Pair[] = [
		{ old: `${root}/.control`, next: `${root}/.limen` },
		{ old: `${root}/.agents/control`, next: `${root}/.agents/limen` },
	];
	const extension = (name: string): ExtensionPair => ({
		old: `${root}/.pi/extensions/control-${name}.ts`,
		next: `${root}/.pi/extensions/limen-${name}.ts`,
		name,
	});
	const extensions = [extension("wake"), extension("communication")];
	for (const pair of directories) {
		pair.oldKind = await kind(pair.old);
		pair.nextKind = await kind(pair.next);
		if (pair.oldKind !== "none" && pair.oldKind !== "directory") throw new Error(`${relative(root, pair.old)} is not a directory`);
		if (pair.nextKind !== "none" && pair.nextKind !== "directory") throw new Error(`${relative(root, pair.next)} is not a directory`);
		if (pair.oldKind === "directory" && pair.nextKind === "directory") throw new Error(`both ${relative(root, pair.old)} and ${relative(root, pair.next)} exist`);
	}
	if (directories[0]?.oldKind === "directory") await refuseLiveLegacyJobs(directories[0].old);
	for (const pair of extensions) {
		pair.oldKind = await kind(pair.old);
		pair.nextKind = await kind(pair.next);
		if (pair.oldKind === "directory" || pair.nextKind === "directory") throw new Error(`${pair.name} extension path must be a regular file`);
	}
	const agents = await plannedPatch(`${root}/AGENTS.md`, patchAgents);
	const runtimeExists = directories[0]?.oldKind === "directory" || directories[0]?.nextKind === "directory";
	const ignore = await plannedPatch(`${root}/.gitignore`, (text) => patchIgnore(text, runtimeExists));
	for (const pair of directories) {
		if (pair.oldKind === "directory") {
			await mkdir(dirname(pair.next), { recursive: true });
			await rename(pair.old, pair.next);
			console.log(`moved ${relative(root, pair.old)} -> ${relative(root, pair.next)}`);
		} else console.log(`${pair.nextKind === "directory" ? "kept" : "no-op"} ${relative(root, pair.next)}`);
	}
	for (const pair of extensions) {
		if (pair.oldKind === "file") {
			await rm(pair.old);
			console.log(`removed ${relative(root, pair.old)}`);
		} else console.log(`${pair.nextKind === "file" ? "kept" : "no-op"} ${pair.name} extension`);
	}
	const needStub = runtimeExists || extensions.some((pair) => pair.oldKind === "file" || pair.nextKind === "file");
	const stub = `${root}/.pi/extensions/limen.ts`;
	if (needStub && (await kind(stub)) === "none") {
		await mkdir(dirname(stub), { recursive: true });
		await writeFile(stub, await readFile(`${PACKAGE_ROOT}/templates/limen-extension.ts`), { flag: "wx" });
		console.log("created .pi/extensions/limen.ts");
	} else if (needStub) console.log("kept .pi/extensions/limen.ts");
	for (const path of removeHookCopies(root)) console.log(`removed ${path}`);
	for (const patch of [agents, ignore]) {
		if (!patch) continue;
		if (patch.before === patch.after) console.log(`kept ${relative(root, patch.path)}`);
		else {
			await writeFile(patch.path, patch.after);
			console.log(`patched ${relative(root, patch.path)}`);
		}
	}
	console.log("migration complete; restart the coordinator or run /reload");
}
async function refuseLiveLegacyJobs(control: string): Promise<void> {
	const jobs = `${control}/jobs`;
	const jobsKind = await kind(jobs);
	if (jobsKind === "file") throw new Error(".control/jobs is not a directory");
	if (jobsKind === "none") return;
	for (const entry of await readdir(jobs, { withFileTypes: true })) {
		if (!entry.isDirectory() || (await text(`${jobs}/${entry.name}/state`)) !== "running") continue;
		const pid = Number(await text(`${jobs}/${entry.name}/pid`));
		if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`legacy running job ${entry.name} has no valid PID; wait or repair its handshake before migrating`);
		if (processGroupAlive(pid)) throw new Error(`legacy job ${entry.name} still has a live process group; stop it before migrating`);
	}
}
async function plannedPatch(path: string, transform: (text: string) => string) {
	const pathKind = await kind(path);
	if (pathKind === "none") return;
	if (pathKind !== "file") throw new Error(`${path} must be a regular file`);
	const before = await readFile(path, "utf8");
	return { path, before, after: transform(before) };
}
function patchAgents(text: string): string {
	return text
		.replace(/\bcontrol(?=\s+(?:init|spawn|jobs|wait|stop)\b)/g, "limen")
		.replaceAll(".control/jobs", ".limen/jobs")
		.replace(/`control`/g, "`limen`");
}
function patchIgnore(text: string, runtimeExists: boolean): string {
	const newline = text.includes("\r\n") ? "\r\n" : "\n";
	const hadLegacy = text.split(/\r?\n/).some((line) => /^\s*!?\/?\.control(?:\/.*)?\s*$/.test(line));
	if (!hadLegacy && !runtimeExists) return text;
	const mapped = text.split(/\r?\n/).map((line) => line.replace(/^(\s*!?\/?)\.control(?=\/|\s*$)/, "$1.limen"));
	const broad = (line: string) => /^\s*!?\/?\.limen\/?\s*$/.test(line);
	const first = mapped.findIndex(broad);
	const kept = mapped.filter((line) => !broad(line));
	kept.splice(first < 0 ? Math.max(0, kept.length - Number(kept.at(-1) === "")) : first, 0, "/.limen/");
	return kept.join(newline);
}
async function kind(path: string): Promise<Kind> {
	return lstat(path).then(
		(value) => (value.isDirectory() ? "directory" : value.isFile() ? "file" : Promise.reject(new Error(`${path} has an unsupported file type`))),
		(error: unknown) => {
			if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return "none";
			throw error;
		},
	);
}
function text(path: string): Promise<string> {
	return readFile(path, "utf8").then(
		(value) => value.trim(),
		() => "",
	);
}
function relative(root: string, path: string): string {
	return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}
