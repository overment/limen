import * as fs from "node:fs";
import { isAbsolute, join } from "node:path";
import { installSeatSweep, showSeatNotification, uninstallSeatSweep, updateRegisteredProjects } from "../../hook/seat.ts";
import { confirmDeadJobs } from "../reap.ts";

const text = (path: string) => (fs.existsSync(path) ? fs.readFileSync(path, "utf8").trim() : "");
const modified = (path: string) => (fs.existsSync(path) ? fs.statSync(path).mtimeMs : 0);

export async function sweepCommand(args: readonly string[], _cwd: string): Promise<void> {
	if (args.length === 1 && args[0] === "--install") return installSeatSweep();
	if (args.length === 1 && args[0] === "--uninstall") return uninstallSeatSweep();
	if (args.length) throw new Error("sweep accepts no arguments, --install, or --uninstall");
	const living = updateRegisteredProjects((projects) => projects.filter((project) => isAbsolute(project) && fs.existsSync(project) && fs.statSync(project).isDirectory()));
	await Promise.all(living.map(sweepProject));
}
async function sweepProject(root: string): Promise<void> {
	const jobs = join(root, ".limen", "jobs"),
		threshold = positive("LIMEN_SEAT_RING_MS", 5 * 60_000);
	await confirmDeadJobs(jobs);
	if (Date.now() - modified(join(root, ".limen", "last-sweep")) < threshold) return;
	for (const entry of fs.existsSync(jobs) ? fs.readdirSync(jobs, { withFileTypes: true }) : []) {
		if (!entry.isDirectory()) continue;
		const job = join(jobs, entry.name),
			state = text(join(job, "state"));
		const delivered = fs.existsSync(join(job, "notify", "delivered")) ? fs.readdirSync(join(job, "notify", "delivered")) : [];
		const advisory = state === "running",
			stamp = advisory ? join(job, "advisory") : join(job, "finished-at");
		const unheard = advisory
			? !delivered.some((name) => name.startsWith("_advisory."))
			: ["done", "failed", "stopped"].includes(state) && !delivered.some((name) => !name.startsWith("_advisory."));
		const since = modified(stamp) || (advisory ? 0 : modified(join(job, "state")));
		if (!unheard || !since || Date.now() - since < threshold) continue;
		const seat = join(job, "notify", "seat"),
			markers = fs.existsSync(seat) ? fs.readdirSync(seat) : [];
		if (Date.now() - Math.max(0, ...markers.map((name) => modified(join(seat, name)))) < positive("LIMEN_SEAT_RERING_MS", 15 * 60_000)) continue;
		const label = text(join(job, "label")) || entry.name;
		if (!(await showSeatNotification(`limen: ${label} is ${advisory ? "unheard" : state}`, `job ${entry.name} · ${root}`))) continue;
		fs.mkdirSync(seat, { recursive: true });
		fs.writeFileSync(join(seat, `${Date.now()}`), `${new Date().toISOString()}\n`);
	}
}
const positive = (name: string, fallback: number) => (Number.isFinite(Number(process.env[name])) && Number(process.env[name]) > 0 ? Number(process.env[name]) : fallback);
