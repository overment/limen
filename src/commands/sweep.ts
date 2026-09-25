import * as fs from "node:fs";
import { isAbsolute, join } from "node:path";
import { installSeatSweep, showSeatNotification, uninstallSeatSweep, updateRegisteredProjects } from "../../hook/seat.ts";
import { confirmDeadJobs } from "../reap.ts";

const text = (path: string) => (fs.existsSync(path) ? fs.readFileSync(path, "utf8").trim() : "");
const modified = (path: string) => (fs.existsSync(path) ? fs.statSync(path).mtimeMs : 0);
const metadata = (path: string) => {
	try {
		return fs.statSync(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
};

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
			statePath = join(job, "state"),
			state = text(statePath);
		const delivered = fs.existsSync(join(job, "notify", "delivered")) ? fs.readdirSync(join(job, "notify", "delivered")) : [];
		const advisory = state === "running",
			stamp = advisory ? join(job, "advisory") : join(job, "finished-at");
		const unheard = advisory
			? !delivered.some((name) => name.startsWith("_advisory."))
			: ["done", "failed", "stopped"].includes(state) && !delivered.some((name) => !name.startsWith("_advisory."));
		if (!unheard) continue;
		const advisoryStamp = advisory ? metadata(stamp) : undefined;
		if (advisory && !advisoryStamp) continue;
		const since = advisoryStamp ? advisoryStamp.mtimeMs : Math.max(modified(stamp), modified(statePath));
		if (!since || Date.now() - since < threshold) continue;
		const seat = join(job, "notify", "seat"),
			markers = fs.existsSync(seat) ? fs.readdirSync(seat) : [],
			event = advisoryStamp ? `_advisory.${since}.${advisoryStamp.birthtimeMs}` : `_terminal.${state}.${since}`;
		if (markers.some((name) => name === event || (/^\d+$/.test(name) && Number(name) >= since))) continue;
		// Claim before transport: a concurrent sweep or ambiguous failure must not replay this event.
		fs.mkdirSync(seat, { recursive: true });
		try {
			fs.writeFileSync(join(seat, event), `${new Date().toISOString()}\n`, { flag: "wx" });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
			throw error;
		}
		const label = text(join(job, "label")) || entry.name;
		if (!(await showSeatNotification(`limen: ${label} is ${advisory ? "unheard" : state}`, `job ${entry.name} · ${root}`)))
			console.error(`seat notification failed for ${entry.name}; event recorded to avoid an ambiguous retry`);
	}
}
const positive = (name: string, fallback: number) => (Number.isFinite(Number(process.env[name])) && Number(process.env[name]) > 0 ? Number(process.env[name]) : fallback);
