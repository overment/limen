import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { appendLimenLog } from "./proc.ts";

export type HerdrPlace = { readonly workspace: string; readonly tab: string; readonly pane: string; readonly mode: "watch" };

export async function openWatchTab(input: { readonly jobDir: string; readonly label: string; readonly cwd: string; readonly logPath: string }): Promise<HerdrPlace | undefined> {
	if (process.env.HERDR_ENV !== "1") return;
	const herdr = herdrBinary();
	if (!herdr) {
		await appendLimenLog(input.jobDir, "herdr skipped: herdr is not available");
		return;
	}
	try {
		const workspace = ensureWorkspace(herdr, input.cwd);
		const created = call(herdr, ["tab", "create", "--workspace", workspace, "--label", input.label, "--cwd", input.cwd, "--no-focus"]);
		const place: HerdrPlace = { workspace, tab: id(created, "tab", "tab_id"), pane: id(created, "root_pane", "pane_id"), mode: "watch" };
		await recordPlace(input.jobDir, place);
		call(herdr, ["pane", "run", place.pane, "tail", "-f", input.logPath]);
		return place;
	} catch (error) {
		await appendLimenLog(input.jobDir, `herdr skipped: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function herdrBinary(): string | undefined {
	const override = process.env.LIMEN_HERDR?.trim();
	if (override === "0") return;
	if (override) return existsSync(override) ? override : undefined;
	for (const dir of (process.env.PATH ?? "").split(":")) {
		const candidate = `${dir}/herdr`;
		if (dir && existsSync(candidate)) return candidate;
	}
}

function ensureWorkspace(herdr: string, cwd: string): string {
	const name = basename(cwd);
	const listed = asRecord(call(herdr, ["workspace", "list"])).workspaces;
	if (Array.isArray(listed)) {
		for (const item of listed) {
			const row = asRecord(item);
			if (row.label === name && typeof row.workspace_id === "string") return row.workspace_id;
		}
	}
	return id(call(herdr, ["workspace", "create", "--cwd", cwd, "--label", name, "--no-focus"]), "workspace", "workspace_id");
}

function call(herdr: string, args: readonly string[]): unknown {
	const result = spawnSync(herdr, args, { encoding: "utf8", timeout: 5_000 });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || `herdr ${args[0]} failed`);
	const parsed: unknown = JSON.parse(result.stdout || "{}");
	const envelope = asRecord(parsed);
	return envelope.result ?? parsed;
}

function id(result: unknown, object: string, field: string): string {
	const value = asRecord(asRecord(result)[object])[field];
	if (typeof value !== "string" || !value) throw new Error(`herdr response missing ${object}.${field}`);
	return value;
}

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

async function recordPlace(jobDir: string, place: HerdrPlace): Promise<void> {
	await mkdir(`${jobDir}/herdr`, { recursive: true });
	await Promise.all((["workspace", "tab", "pane", "mode"] as const).map((name) => writeFile(`${jobDir}/herdr/${name}`, `${place[name]}\n`)));
}
