import * as fs from "node:fs";
import { isAbsolute, join } from "node:path";
import { sweepCoordinators } from "../integrations/coordinator-signal.ts";
import { isTerminal } from "../job/job.ts";
import { noteKind } from "../job/view.ts";
import { receiptFamily } from "../job/wake-delivery.ts";
import {
	installSeatSweep,
	showSeatNotification,
	uninstallSeatSweep,
	updateRegisteredProjects,
} from "../project/seat.ts";
import { HOSTED_UNCERTAINTY_MS, readHostedUncertainty } from "../runtime/hosted-uncertainty.ts";
import { confirmDeadJobs } from "../runtime/reap.ts";

const text = (path: string) => (fs.existsSync(path) ? fs.readFileSync(path, "utf8").trim() : "");
const modified = (path: string) => (fs.existsSync(path) ? fs.statSync(path).mtimeMs : 0);
const metadata = (path: string) => {
	try {
		return fs.statSync(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return undefined;
		}
		throw error;
	}
};

export async function sweepCommand(args: readonly string[], _cwd: string): Promise<void> {
	if (args.length === 1 && args[0] === "--install") {
		return installSeatSweep();
	}
	if (args.length === 1 && args[0] === "--uninstall") {
		return uninstallSeatSweep();
	}
	if (args.length) {
		throw new Error("sweep accepts no arguments, --install, or --uninstall");
	}
	const living = updateRegisteredProjects((projects) =>
		projects.filter((project) => isAbsolute(project) && fs.existsSync(project) && fs.statSync(project).isDirectory()),
	);
	await Promise.all(living.map(sweepProject));
}
async function sweepProject(root: string): Promise<void> {
	const jobs = join(root, ".limen", "jobs");
	const threshold = positive("LIMEN_SEAT_RING_MS", 5 * 60_000);
	await confirmDeadJobs(jobs);
	// Exit detection runs every pass: a dead coordinator pane is news now, not after the seat ring threshold.
	await sweepCoordinators(root).catch((error: unknown) =>
		console.error(`coordinator sweep failed for ${root}: ${error instanceof Error ? error.message : String(error)}`),
	);
	if (Date.now() - modified(join(root, ".limen", "last-sweep")) < threshold) {
		return;
	}
	for (const entry of fs.existsSync(jobs) ? fs.readdirSync(jobs, { withFileTypes: true }) : []) {
		if (!entry.isDirectory()) {
			continue;
		}
		const job = join(jobs, entry.name);
		const due = seatEvent(job);
		if (!due?.since || Date.now() - due.since < threshold || !claimSeatEvent(job, due)) {
			continue;
		}
		const label = text(join(job, "label")) || entry.name;
		const title = `limen: ${label}${due.headline}`;
		if (!(await showSeatNotification(title, `job ${entry.name} · ${root}`))) {
			console.error(`seat notification failed for ${entry.name}; event recorded to avoid an ambiguous retry`);
		}
	}
}
type SeatEvent = { readonly since: number; readonly event: string; readonly headline: string };
/** What the seat has not heard about a job yet: hosted ownership uncertainty, an advisory, or its terminal state. */
function seatEvent(job: string): SeatEvent | undefined {
	const statePath = join(job, "state");
	const state = text(statePath);
	const delivered = fs.existsSync(join(job, "notify", "delivered"))
		? fs.readdirSync(join(job, "notify", "delivered"))
		: [];
	const heard = new Set(delivered.map(receiptFamily));
	const running = state === "running";
	const advisoryText = running ? text(join(job, "advisory")) : "";
	const uncertainty = running && !advisoryText ? readHostedUncertainty(job) : undefined;
	if (uncertainty) {
		if (Date.now() - uncertainty.since < HOSTED_UNCERTAINTY_MS) {
			return;
		}
		if (heard.has("_uncertainty") || !metadata(join(job, "ownership-uncertainty"))) {
			return;
		}
		return { since: uncertainty.since, event: `_uncertainty.${uncertainty.since}`, headline: " · ownership" };
	}
	if (running) {
		if (heard.has("_advisory")) {
			return;
		}
		const stamp = metadata(join(job, "advisory"));
		if (!stamp) {
			return;
		}
		return {
			since: stamp.mtimeMs,
			event: `_advisory.${stamp.mtimeMs}.${stamp.birthtimeMs}`,
			headline: ` · ${noteKind(advisoryText)}`,
		};
	}
	if (!isTerminal(state) || heard.has("_completion")) {
		return;
	}
	const since = Math.max(modified(join(job, "finished-at")), modified(statePath));
	return { since, event: `_terminal.${state}.${since}`, headline: ` is ${state}` };
}
/** Claim before transport: a concurrent sweep or ambiguous failure must not replay this event. False when claimed already. */
function claimSeatEvent(job: string, { since, event }: SeatEvent): boolean {
	const seat = join(job, "notify", "seat");
	const markers = fs.existsSync(seat) ? fs.readdirSync(seat) : [];
	if (markers.some((name) => name === event || (/^\d+$/.test(name) && Number(name) >= since))) {
		return false;
	}
	fs.mkdirSync(seat, { recursive: true });
	try {
		fs.writeFileSync(join(seat, event), `${new Date().toISOString()}\n`, { flag: "wx" });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") {
			return false;
		}
		throw error;
	}
	return true;
}
const positive = (name: string, fallback: number) =>
	Number.isFinite(Number(process.env[name])) && Number(process.env[name]) > 0 ? Number(process.env[name]) : fallback;
