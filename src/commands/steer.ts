import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { processGroupAlive } from "../contain.ts";
import { resolveJob } from "../lookup.ts";

const READY_WAIT_MS = 2_000;

export async function steerCommand(args: readonly string[], cwd: string): Promise<void> {
	const query = args[0];
	const message = args.slice(1).join(" ").trim();
	if (!query || !message) throw new Error("steer requires a job id and a message");
	const { id, jobDir } = await resolveJob(cwd, query);
	const state = (await text(`${jobDir}/state`)) || "missing";
	if (state !== "running") throw new Error(`${id} is already ${state}; not steered`);
	const pid = Number(await text(`${jobDir}/pid`));
	if (!Number.isSafeInteger(pid) || pid <= 0 || !processGroupAlive(pid)) throw new Error(`${id} is not running; not steered`);
	if (!(await waitForReady(jobDir))) throw new Error(`steering is unavailable for ${id}; the worker extension is not loaded`);
	const seq = await enqueue(jobDir, message);
	console.log(`steered ${id} · ${seq}`);
}

async function enqueue(jobDir: string, message: string): Promise<string> {
	const inbox = `${jobDir}/steer/inbox`;
	await mkdir(inbox, { recursive: true });
	for (let next = (await highest(jobDir)) + 1; next <= 9_999; next += 1) {
		const seq = String(next).padStart(4, "0");
		try {
			await writeFile(`${inbox}/${seq}`, `${message}\n`, { flag: "wx", flush: true });
			return seq;
		} catch (error: unknown) {
			if (!isExist(error)) throw error;
		}
	}
	throw new Error(`steer inbox is full for ${jobDir}`);
}

async function highest(jobDir: string): Promise<number> {
	const names = await Promise.all(["inbox", "claims", "delivered"].map((part) => readdir(`${jobDir}/steer/${part}`).catch(() => [])));
	return names.flat().reduce((max, name) => {
		const value = Number(name);
		return /^\d+$/.test(name) && value > max ? value : max;
	}, 0);
}

async function waitForReady(jobDir: string): Promise<boolean> {
	const deadline = Date.now() + READY_WAIT_MS;
	while (Date.now() <= deadline) {
		if (await text(`${jobDir}/steer/ready`)) return true;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	return false;
}

function text(path: string): Promise<string> {
	return readFile(path, "utf8").then(
		(value) => value.trim(),
		() => "",
	);
}

function isExist(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}
