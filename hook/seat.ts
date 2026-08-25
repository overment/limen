import { execFile } from "node:child_process";
import * as fs from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const home = () => process.env.LIMEN_HOME || homedir();
export const projectsFile = () => join(home(), ".limen", "projects");
export const registeredProjects = () => [...new Set((fs.existsSync(projectsFile()) ? fs.readFileSync(projectsFile(), "utf8") : "").split(/\r?\n/).filter(Boolean))];
export function updateRegisteredProjects(update: (projects: readonly string[]) => readonly string[]): readonly string[] {
	return withRegistryLock(() => {
		const before = registeredProjects(),
			after = [...new Set(update(before))];
		if (before.length === after.length && before.every((project, index) => project === after[index])) return before;
		const path = projectsFile(),
			temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
		try {
			fs.writeFileSync(temporary, after.length ? `${after.join("\n")}\n` : "", { flag: "wx" });
			fs.renameSync(temporary, path);
		} finally {
			fs.rmSync(temporary, { force: true });
		}
		return after;
	});
}
export async function registerProject(root: string): Promise<void> {
	const project = resolve(root);
	updateRegisteredProjects((projects) => (projects.includes(project) ? projects : [...projects, project]));
}
export async function showSeatNotification(title: string, body: string): Promise<boolean> {
	const herdr = process.env.LIMEN_HERDR || "herdr";
	if (herdr !== "0" && (await run(herdr, ["notification", "show", title, "--body", body, "--sound", "request"]))) return true;
	return run("/usr/bin/osascript", ["-e", "on run argv", "-e", "display notification (item 2 of argv) with title (item 1 of argv)", "-e", "end run", "--", title, body]);
}
export async function installSeatSweep(): Promise<void> {
	const path = join(home(), "Library", "LaunchAgents", "limen-sweep.plist");
	const values = [process.execPath, join(PACKAGE_ROOT, "bin", "limen"), "sweep"].map((value) => `<string>${xml(value)}</string>`).join("");
	const plist = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>works.earendil.limen-sweep</string><key>ProgramArguments</key><array>${values}</array><key>StartInterval</key><integer>60</integer></dict></plist>\n`;
	fs.mkdirSync(dirname(path), { recursive: true });
	fs.writeFileSync(path, plist);
	console.log(`wrote ${path}\nnode ${process.execPath}\nlimen ${join(PACKAGE_ROOT, "bin", "limen")}\nMoving this checkout requires running limen sweep --install again.`);
}
export async function uninstallSeatSweep(): Promise<void> {
	const path = join(home(), "Library", "LaunchAgents", "limen-sweep.plist");
	fs.rmSync(path, { force: true });
	console.log(`removed ${path}`);
}
function withRegistryLock<T>(action: () => T): T {
	const path = projectsFile(),
		lock = `${path}.lock`,
		deadline = Date.now() + 10_000;
	fs.mkdirSync(dirname(path), { recursive: true });
	while (true) {
		try {
			fs.mkdirSync(lock);
			fs.writeFileSync(join(lock, "owner"), `${process.pid}\n`);
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			if (removeAbandonedLock(lock)) continue;
			if (Date.now() >= deadline) throw new Error(`timed out locking ${path}`);
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
		}
	}
	try {
		return action();
	} finally {
		fs.rmSync(lock, { recursive: true, force: true });
	}
}
function removeAbandonedLock(lock: string): boolean {
	try {
		const owner = Number(fs.existsSync(join(lock, "owner")) ? fs.readFileSync(join(lock, "owner"), "utf8").trim() : 0);
		if (owner > 0) {
			try {
				process.kill(owner, 0);
				return false;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ESRCH") return false;
			}
		} else if (Date.now() - fs.statSync(lock).mtimeMs < 5_000) return false;
		fs.rmSync(lock, { recursive: true, force: true });
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
		throw error;
	}
}
function run(command: string, args: readonly string[]): Promise<boolean> {
	return new Promise((done) => execFile(command, args, { timeout: 2_000 }, (error) => done(!error)));
}
const xml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
