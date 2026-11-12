import { spawnSync } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";

/** Core terminals opt into the app with the source terminal's herdr.space label. */
export async function openCoreLog(input: {
	readonly jobDir: string;
	readonly cwd: string;
	readonly logPath?: string;
}): Promise<void> {
	const directory = `${input.jobDir}/herdr-core`;
	const recorded = await readFile(`${directory}/terminal`, "utf8").catch(() => "");
	if (recorded.trim()) {
		try {
			const terminal = coreCall(["get", recorded.trim()]);
			if (terminal.state === "live") {
				return;
			}
		} catch (error) {
			if (!(error instanceof Error && "kind" in error && error.kind === "not_found")) {
				throw error;
			}
		}
	}
	const source = process.env.HC_TERMINAL_ID?.trim();
	if (!source) {
		throw new Error("hc log view needs HC_TERMINAL_ID in the source terminal");
	}
	const parent = coreCall(["get", source]);
	const labels = parent.labels as Record<string, unknown> | undefined;
	const space = labels?.["herdr.space"];
	if (typeof space !== "string" || !space) {
		throw new Error("hc source terminal has no herdr.space label");
	}
	const created = coreCall([
		"run",
		"--bg",
		"--no-notify",
		"--outlive-parent",
		"--parent",
		source,
		"--cwd",
		input.cwd,
		"--label",
		`herdr.space=${space}`,
		"--",
		"tail",
		"-n",
		"+1",
		"-f",
		input.logPath ?? `${input.jobDir}/log`,
	]);
	if (typeof created.address !== "string" || !created.address) {
		throw new Error("hc response missing address");
	}
	await mkdir(directory, { recursive: true });
	await writeFile(`${directory}/terminal`, `${created.address}\n`);
}

export async function closeCoreLog(jobDir: string): Promise<void> {
	const terminal = (await readFile(`${jobDir}/herdr-core/terminal`, "utf8").catch(() => "")).trim();
	if (!terminal) {
		return;
	}
	let result = "closed";
	try {
		coreCall(["kill", terminal]);
		coreCall(["rm", terminal]);
	} catch (error) {
		result =
			error instanceof Error && "kind" in error && error.kind === "not_found"
				? "already closed"
				: `failed (${error instanceof Error ? error.message : String(error)})`;
	}
	await appendFile(`${jobDir}/log`, `[limen ${new Date().toISOString()}] hc log close ${terminal}: ${result}\n`);
}

function coreCall(args: readonly string[]): Record<string, unknown> {
	const result = spawnSync("hc", ["--json", ...args], { encoding: "utf8", timeout: 10_000 });
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		const raw = result.stderr.trim() || result.stdout.trim() || "hc failed";
		let fault: { message?: string; kind?: string } = {};
		try {
			fault = JSON.parse(raw).error ?? {};
		} catch {}
		throw Object.assign(new Error(fault.message || raw), { kind: fault.kind });
	}
	return JSON.parse(result.stdout);
}
