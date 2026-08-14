import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { limenRoot } from "../git.ts";
import { resolveJob } from "../lookup.ts";
export const watchCommand = (args: readonly string[], cwd: string): Promise<void> => changeSubscriptions(args, cwd, true);
export const unwatchCommand = (args: readonly string[], cwd: string): Promise<void> => changeSubscriptions(args, cwd, false);
async function changeSubscriptions(args: readonly string[], cwd: string, watching: boolean): Promise<void> {
	const session = notificationSession();
	const bulk = args.length === 1 && args[0] === (watching ? "--running" : "--all");
	if (!bulk && args.length !== 1) throw new Error(`${watching ? "watch" : "unwatch"} requires one job${watching ? " or --running" : " or --all"}`);
	const root = limenRoot(cwd);
	const jobs = bulk ? await jobDirectories(`${root}/.limen/jobs`, watching) : [(await resolveJob(cwd, args[0] ?? "")).jobDir];
	for (const job of jobs) await setSubscription(job, session, watching);
	console.log(`${watching ? "watching" : "unwatched"} ${jobs.length} job${jobs.length === 1 ? "" : "s"}`);
}
async function jobDirectories(root: string, runningOnly: boolean): Promise<string[]> {
	const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
	const jobs = entries.filter((entry) => entry.isDirectory()).map((entry) => `${root}/${entry.name}`);
	if (!runningOnly) return jobs;
	const states = await Promise.all(jobs.map((job) => readFile(`${job}/state`, "utf8").catch(() => "")));
	return jobs.filter((_job, index) => states[index]?.trim() === "running");
}
async function setSubscription(job: string, session: string, watching: boolean): Promise<void> {
	const marker = `${job}/notify/subscribers/${session}`;
	if (!watching) {
		await rm(marker, { force: true });
		return;
	}
	await mkdir(`${job}/notify/subscribers`, { recursive: true });
	await exclusiveWrite(marker, `${new Date().toISOString()}\n`);
	await exclusiveWrite(`${job}/notify/ready`, "1\n");
}
async function exclusiveWrite(path: string, content: string): Promise<void> {
	await writeFile(path, content, { flag: "wx", flush: true }).catch((error: unknown) => {
		if (!(typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST")) throw error;
	});
}
function notificationSession(): string {
	const value = process.env.PI_SESSION_ID?.trim();
	if (!value || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) throw new Error("watching requires a Pi session; ask the coordinator to watch through its bash tool");
	return value;
}
