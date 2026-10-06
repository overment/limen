import { randomUUID } from "node:crypto";
import { existsSync, linkSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { hostedForegroundPid } from "../integrations/herdr.ts";
import { processInfo } from "./contain.ts";
import type { EngineId } from "./engine.ts";

export type HostedLaunch = {
	readonly launchId: string;
	readonly jobDir: string;
	readonly sessionDir: string;
	readonly engine: string;
	readonly pane: string;
	readonly parent: number;
	readonly parentBorn: string;
	readonly boot: string;
};
export type HostedBinding = HostedLaunch & {
	readonly pid: number;
	readonly born: string;
	readonly sessionId: string;
	readonly platform: string;
};
export function hostedBoot(): string | undefined {
	// Other adapters stay unowned until their boot and session evidence is proven.
	if (process.platform !== "linux") {
		return;
	}
	try {
		return readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim() || undefined;
	} catch {
		return;
	}
}
/** Only hosted Pi on Linux can bind its pane; OMP and other platforms have no ownership proof to lose. */
export function hostedBindingSupported(engine: string): boolean {
	return engine === "pi" && hostedBoot() !== undefined;
}
/** Read persisted launch evidence, not current ownership or proof of death. */
export function readHostedBinding(jobDir: string): HostedBinding | undefined {
	try {
		const binding: HostedBinding = JSON.parse(readFileSync(join(jobDir, "engine-binding"), "utf8"));
		const launch: HostedLaunch = JSON.parse(readFileSync(join(jobDir, "engine-launch"), "utf8"));
		if (binding.jobDir !== realpathSync(jobDir) || binding.sessionDir !== realpathSync(join(jobDir, "session"))) {
			return;
		}
		if (
			binding.engine !== "pi" ||
			binding.platform !== "linux" ||
			typeof binding.boot !== "string" ||
			!binding.boot ||
			typeof binding.sessionId !== "string" ||
			!binding.sessionId
		) {
			return;
		}
		if (
			typeof binding.pane !== "string" ||
			!binding.pane ||
			!Number.isSafeInteger(binding.parent) ||
			binding.parent <= 0 ||
			!/^\d+$/.test(binding.parentBorn)
		) {
			return;
		}
		if (!Number.isSafeInteger(binding.pid) || binding.pid <= 0 || !/^\d+$/.test(binding.born)) {
			return;
		}
		if (typeof binding.launchId !== "string" || !binding.launchId) {
			return;
		}
		for (const key of ["launchId", "jobDir", "sessionDir", "engine", "pane", "parent", "parentBorn", "boot"] as const) {
			if (binding[key] !== launch[key]) {
				return;
			}
		}
		return binding;
	} catch {
		return;
	}
}
export async function hostedIdentityObservation(
	binding: HostedBinding,
): Promise<"present" | "mismatch" | "unavailable"> {
	if (binding.platform !== process.platform) {
		return "unavailable";
	}
	const boot = hostedBoot();
	if (!boot) {
		return "unavailable";
	}
	if (binding.boot !== boot) {
		return "mismatch";
	}
	const current = await processInfo(binding.pid);
	if (current.kind === "unavailable") {
		return "unavailable";
	}
	return current.kind === "present" && current.process.born === binding.born ? "present" : "mismatch";
}
/** Current pane membership is checked between two fresh checks of the immutable binding. */
export async function hostedBindingInPane(
	target: string,
	pid: number,
	engine: EngineId,
	jobDir: string,
): Promise<"owned" | "mismatch" | "unavailable"> {
	const binding = readHostedBinding(jobDir);
	if (!binding || binding.pid !== pid || binding.engine !== engine) {
		return "mismatch";
	}
	let session: string;
	try {
		session = readFileSync(`${jobDir}/engine-session`, "utf8");
		const association = JSON.parse(session);
		if (
			association.pid !== binding.pid ||
			association.born !== binding.born ||
			association.sessionId !== binding.sessionId
		) {
			return "mismatch";
		}
	} catch {
		return "mismatch";
	}
	const before = await hostedIdentityObservation(binding);
	if (before !== "present") {
		return before;
	}
	const foreground = hostedForegroundPid(target, pid);
	if (foreground !== "present") {
		return foreground;
	}
	const after = await hostedIdentityObservation(binding);
	if (after !== "present") {
		return after;
	}
	try {
		return readFileSync(`${jobDir}/engine-session`, "utf8") === session ? "owned" : "mismatch";
	} catch {
		return "mismatch";
	}
}
export async function hostedEngineObservation(
	target: string,
	pid: number,
	engine: EngineId,
	jobDir: string,
): Promise<"owned" | "mismatch" | "unavailable"> {
	try {
		if (readFileSync(`${jobDir}/herdr/pane`, "utf8").trim() !== target) {
			return "mismatch";
		}
	} catch {
		return "mismatch";
	}
	return hostedBindingInPane(target, pid, engine, jobDir);
}
export async function hostedEngineOwned(
	target: string,
	pid: number,
	engine: EngineId,
	jobDir: string,
): Promise<boolean> {
	return (await hostedEngineObservation(target, pid, engine, jobDir)) === "owned";
}
function publishExclusive(path: string, value: unknown): void {
	const prepared = `${path}.${process.pid}.${randomUUID()}`;
	try {
		writeFileSync(prepared, `${JSON.stringify(value)}\n`, { flag: "wx" });
		linkSync(prepared, path);
	} finally {
		rmSync(prepared, { force: true });
	}
}
export async function prepareHostedLaunch(
	jobDir: string,
	pane: string,
	engine: string,
	parentPid: number,
): Promise<void> {
	if (!hostedBindingSupported(engine)) {
		return;
	}
	const parent = await processInfo(parentPid);
	const boot = hostedBoot();
	if (parent.kind !== "present" || !boot) {
		return;
	}
	mkdirSync(join(jobDir, "session"), { recursive: true });
	const launch: HostedLaunch = {
		launchId: randomUUID(),
		jobDir: realpathSync(jobDir),
		sessionDir: realpathSync(join(jobDir, "session")),
		engine,
		pane,
		parent: parentPid,
		parentBorn: parent.process.born,
		boot,
	};
	publishExclusive(join(jobDir, "engine-launch"), launch);
}
export async function registerHostedBinding(jobDir: string, pane: string, context: unknown): Promise<boolean> {
	try {
		const manager = (
			context as {
				sessionManager?: { getSessionDir(): string; getSessionId(): string; getSessionFile(): string | undefined };
			}
		)?.sessionManager;
		if (!manager) {
			return false;
		}
		const sessionDir = realpathSync(manager.getSessionDir());
		const file = manager.getSessionFile();
		const sessionId = manager.getSessionId();
		if (
			sessionDir !== realpathSync(join(jobDir, "session")) ||
			(file && realpathSync(dirname(file)) !== sessionDir) ||
			!sessionId
		) {
			return false;
		}
		const saved = readHostedBinding(jobDir);
		if (saved) {
			return (
				saved.pid === process.pid &&
				saved.sessionId === sessionId &&
				(await hostedIdentityObservation(saved)) === "present"
			);
		}
		// A legacy PID or a damaged binding is not permission to adopt this process.
		if (existsSync(join(jobDir, "engine-pid")) || existsSync(join(jobDir, "engine-binding"))) {
			return false;
		}
		const launch: HostedLaunch = JSON.parse(readFileSync(join(jobDir, "engine-launch"), "utf8"));
		if (typeof launch.launchId !== "string" || !launch.launchId) {
			return false;
		}
		const current = await processInfo(process.pid);
		const parent = await processInfo(launch.parent);
		if (
			launch.jobDir !== realpathSync(jobDir) ||
			launch.sessionDir !== sessionDir ||
			launch.engine !== "pi" ||
			launch.pane !== pane ||
			launch.boot !== hostedBoot() ||
			!launch.boot
		) {
			return false;
		}
		if (current.kind !== "present" || parent.kind !== "present" || parent.process.born !== launch.parentBorn) {
			return false;
		}
		const directChild = current.process.ppid === launch.parent;
		const shellExec = current.process.pid === launch.parent && current.process.born === launch.parentBorn;
		if (!directChild && !shellExec) {
			return false;
		}
		const binding: HostedBinding = {
			...launch,
			pid: process.pid,
			born: current.process.born,
			sessionId,
			platform: process.platform,
		};
		publishExclusive(join(jobDir, "engine-binding"), binding);
		return true;
	} catch {
		return false;
	}
}
