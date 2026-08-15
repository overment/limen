import { appendFileSync, existsSync, type FSWatcher, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, watch, writeFileSync } from "node:fs";
import { join } from "node:path";

type PiApi = {
	on(event: "session_start" | "session_shutdown", handler: (event: unknown, context: unknown) => void): void;
	sendUserMessage(content: string, options?: { readonly deliverAs: "steer" }): void;
};

const CLAIM_STALE_MS = 30_000;

export default function limenSteering(pi: PiApi): void {
	let watcher: FSWatcher | undefined;
	let sweepTimer: NodeJS.Timeout | undefined;
	let changeTimer: NodeJS.Timeout | undefined;
	let jobDir: string | undefined;
	const stop = () => {
		watcher?.close();
		watcher = undefined;
		if (sweepTimer) clearInterval(sweepTimer);
		sweepTimer = undefined;
		if (changeTimer) clearTimeout(changeTimer);
		changeTimer = undefined;
		jobDir = undefined;
	};
	const sweep = () => {
		if (!jobDir) return;
		try {
			for (const name of pendingNames(jobDir)) {
				if (!deliver(pi, jobDir, name)) break;
			}
		} catch {
			// Delivery is advisory; inbox files remain until a later sweep.
		}
	};
	const scheduleSweep = () => {
		if (!jobDir || changeTimer) return;
		changeTimer = setTimeout(() => {
			changeTimer = undefined;
			sweep();
		}, 50);
		changeTimer.unref();
	};
	pi.on("session_start", () => {
		if (process.env.LIMEN_JOB !== "1") return;
		stop();
		const root = process.env.LIMEN_CONTEXT_ROOT;
		const id = process.env.LIMEN_JOB_ID;
		if (!root || !id) return;
		const job = join(root, ".limen", "jobs", id);
		if (!existsSync(job)) return;
		try {
			mkdirSync(join(job, "steer", "inbox"), { recursive: true });
			mkdirSync(join(job, "steer", "delivered"), { recursive: true });
			writeFileSync(join(job, "steer", "ready"), "1\n", { flag: "wx" });
		} catch {
			if (!existsSync(join(job, "steer", "ready"))) return;
		}
		jobDir = job;
		try {
			watcher = watch(join(job, "steer"), { recursive: true }, scheduleSweep);
			watcher.unref();
			watcher.on("error", () => {
				watcher?.close();
				watcher = undefined;
			});
		} catch {
			// Polling still delivers.
		}
		sweepTimer = setInterval(sweep, 500);
		sweepTimer.unref();
		sweep();
	});
	pi.on("session_shutdown", stop);
}

function deliver(pi: PiApi, job: string, name: string): boolean {
	const inbox = join(job, "steer", "inbox", name);
	const claim = join(job, "steer", "claims", name);
	const delivered = join(job, "steer", "delivered", name);
	mkdirSync(join(job, "steer", "claims"), { recursive: true });
	mkdirSync(join(job, "steer", "delivered"), { recursive: true });
	recoverClaim(claim, delivered);
	if (existsSync(delivered)) {
		rmSync(inbox, { force: true });
		return true;
	}
	const text = readText(inbox);
	if (!text) return false;
	try {
		mkdirSync(claim);
		writeFileSync(join(claim, "owner"), `${process.pid}\n${new Date().toISOString()}\n`);
		writeFileSync(join(claim, "text"), `${text}\n`);
	} catch {
		return false;
	}
	try {
		pi.sendUserMessage(text, { deliverAs: "steer" });
		writeFileSync(join(claim, "accepted"), "1\n");
		renameSync(claim, delivered);
		rmSync(inbox, { force: true });
		appendFileSync(join(job, "log"), `[limen ${new Date().toISOString()}] steered: ${preview(text)}\n`);
		return true;
	} catch {
		rmSync(claim, { recursive: true, force: true });
		return false;
	}
}

function pendingNames(job: string): string[] {
	try {
		return readdirSync(join(job, "steer", "inbox"))
			.filter((name) => /^\d+$/.test(name))
			.sort((left, right) => Number(left) - Number(right));
	} catch {
		return [];
	}
}

function recoverClaim(claim: string, delivered: string): void {
	try {
		if (!existsSync(claim)) return;
		const age = Date.now() - statSync(claim).mtimeMs;
		if (age < CLAIM_STALE_MS) return;
		if (existsSync(join(claim, "accepted"))) {
			if (!existsSync(delivered)) renameSync(claim, delivered);
			else rmSync(claim, { recursive: true, force: true });
			return;
		}
		rmSync(claim, { recursive: true, force: true });
	} catch {
		// Another sweep recovered it first.
	}
}

function readText(path: string): string {
	if (!existsSync(path)) return "";
	return readFileSync(path, "utf8").trim();
}

function preview(text: string): string {
	const line = text.split("\n")[0] ?? "";
	return line.length <= 120 ? line : `${line.slice(0, 119)}…`;
}
