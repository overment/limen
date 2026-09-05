import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { processGroupAlive } from "../contain.ts";
import { limenRoot } from "../git.ts";
import { resolveJob } from "../lookup.ts";

const READY_WAIT_MS = 2_000;

export async function steerCommand(args: readonly string[], cwd: string): Promise<void> {
	const running = args[0] === "--running";
	const message = args.slice(1).join(" ").trim();
	if (!message || (!running && !args[0])) throw new Error(running ? "steer requires a message" : "steer requires a job id and a message");
	const targets = running ? await watchedRunning(cwd) : [await resolveJob(cwd, args[0] ?? "")];
	if (!targets.length) {
		console.log("nothing was reached");
		return;
	}
	for (const target of targets) {
		try {
			console.log(`steered ${target.id} · ${await deliver(target, message)}`);
		} catch (error: unknown) {
			if (!running) throw error;
			console.log(`not reached ${target.id}`);
		}
	}
}

async function deliver(target: { readonly id: string; readonly jobDir: string }, message: string): Promise<string> {
	const { id, jobDir } = target;
	const state = (await text(`${jobDir}/state`)) || "missing";
	if (state !== "running") throw new Error(`${id} is already ${state}; not steered`);
	const pid = Number(await text(`${jobDir}/pid`));
	if (!Number.isSafeInteger(pid) || pid <= 0 || !processGroupAlive(pid)) throw new Error(`${id} is not running; not steered`);
	if (!(await waitForReady(jobDir))) throw new Error(`steering is unavailable for ${id}; the worker extension is not loaded`);
	return enqueue(jobDir, message);
}

async function watchedRunning(cwd: string): Promise<ReadonlyArray<{ readonly id: string; readonly jobDir: string }>> {
	const session = process.env.PI_SESSION_ID?.trim();
	if (!session || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(session)) throw new Error("steer --running requires a Pi session; ask the coordinator to steer through its bash tool");
	const jobsRoot = `${limenRoot(cwd)}/.limen/jobs`;
	const selected: Array<{ id: string; jobDir: string }> = [];
	for (const entry of await readdir(jobsRoot, { withFileTypes: true }).catch(() => [])) {
		if (!entry.isDirectory()) continue;
		const jobDir = `${jobsRoot}/${entry.name}`;
		if ((await text(`${jobDir}/state`)) === "running" && (await text(`${jobDir}/notify/subscribers/${session}`))) selected.push({ id: entry.name, jobDir });
	}
	return selected;
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
