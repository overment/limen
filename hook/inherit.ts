import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

export type Drift =
	| { readonly path: string; readonly kind: "leftover" | "overlay" }
	| { readonly path: string; readonly kind: "stale"; readonly matchedAt: string; readonly changedAt: string };

export function packageRoot(): string {
	return process.env.LIMEN_PACKAGE?.trim() || fileURLToPath(new URL("..", import.meta.url));
}

const TRACKED = [
	["AGENTS.md", "templates/agents.md"],
	[".agents/limen/worker.md", "templates/worker.md"],
	[".agents/limen/reviewer.md", "templates/reviewer.md"],
	[".agents/limen/communication.md", "templates/communication.md"],
] as const;

const HOOK_COPIES = [".pi/extensions/limen-wake.ts", ".pi/extensions/limen-communication.ts", ".pi/extensions/limen-steering.ts"] as const;

type Revision = { readonly hash: string; readonly date: string };

const revisionCache = new Map<string, readonly Revision[]>();

export function removeHookCopies(root: string): readonly string[] {
	const removed: string[] = [];
	for (const path of HOOK_COPIES) {
		try {
			unlinkSync(join(root, path));
			removed.push(path);
		} catch {
			// Absent is the desired state.
		}
	}
	return removed;
}

export function inheritFile(root: string, projectPath: string, packagedPath: string): { readonly path: string; readonly text: string } | undefined {
	const project = readOptional(join(root, projectPath));
	if (project !== undefined) return { path: projectPath, text: project };
	const text = readOptional(join(packageRoot(), packagedPath));
	if (text === undefined) return;
	return { path: `limen/${packagedPath}`, text };
}

export function listDrift(root: string): readonly Drift[] {
	const packaged = packageRoot();
	const found: Drift[] = [];
	for (const [path, source] of TRACKED) {
		const project = readOptional(join(root, path));
		if (project === undefined) continue;
		const expected = readOptional(join(packaged, source));
		if (expected !== undefined && project === expected) {
			found.push({ path, kind: "leftover" });
			continue;
		}
		const revisions = templateRevisions(packaged, source);
		const match = revisions.find((item) => item.hash === digest(project));
		const latest = revisions[0];
		if (match && latest) found.push({ path, kind: "stale", matchedAt: match.date, changedAt: latest.date });
		else found.push({ path, kind: "overlay" });
	}
	return found;
}

export function formatDrift(drifts: readonly Drift[]): string {
	if (!drifts.length) return "";
	const leftovers = drifts.filter((item) => item.kind === "leftover").map((item) => item.path);
	const overlays = drifts.filter((item) => item.kind === "overlay").map((item) => item.path);
	const lines = [
		"## Guidance drift",
		"These project files copy or replace a Limen package default. Ask whether to delete leftovers and stale copies (inherit the package) or keep overlays. Do not overwrite an overlay. `limen init --drop-leftovers` deletes only byte-identical leftovers.",
	];
	if (leftovers.length) lines.push(`leftover (identical; delete to inherit): ${leftovers.join(", ")}`);
	for (const item of drifts) {
		if (item.kind !== "stale") continue;
		lines.push(`stale (package text as of ${item.matchedAt}; package changed ${item.changedAt}): ${item.path}`);
	}
	if (overlays.length) lines.push(`overlay (differs; keep, drop, or edit): ${overlays.join(", ")}`);
	return lines.join("\n");
}

export function readOptional(path: string): string | undefined {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
}

/** Git log/show when the package has a clone; otherwise the shipped `templates/.history/<file>` list. Cached per process. */
export function templateHistoryText(source: string): string {
	return serializeRevisions(templateRevisions(packageRoot(), source));
}

function templateRevisions(packaged: string, source: string): readonly Revision[] {
	const key = `${packaged}\0${source}`;
	const cached = revisionCache.get(key);
	if (cached) return cached;
	const shipped = parseRevisions(readOptional(join(packaged, "templates/.history", basename(source))) ?? "");
	const tracked = existsSync(join(packaged, ".git")) ? gitRevisions(packaged, source) : [];
	// A shallow clone has `.git` and almost no history; the shipped list is then the fuller record.
	const loaded = tracked.length >= shipped.length ? tracked : shipped;
	revisionCache.set(key, loaded);
	return loaded;
}

function gitRevisions(packaged: string, source: string): readonly Revision[] {
	const log = git(packaged, ["log", "--format=%H %cs", "--", source]);
	if (log === undefined) return [];
	const seen = new Set<string>();
	const revisions: Revision[] = [];
	for (const line of log.split("\n")) {
		if (!line) continue;
		const split = line.indexOf(" ");
		if (split === -1) continue;
		const text = git(packaged, ["show", `${line.slice(0, split)}:${source}`]);
		if (text === undefined) continue;
		const hash = digest(text);
		if (seen.has(hash)) continue;
		seen.add(hash);
		revisions.push({ hash, date: line.slice(split + 1) });
	}
	return revisions;
}

function parseRevisions(text: string): readonly Revision[] {
	const revisions: Revision[] = [];
	for (const line of text.split("\n")) {
		if (!line || line.startsWith("#")) continue;
		const split = line.indexOf(" ");
		if (split === -1) continue;
		revisions.push({ hash: line.slice(0, split), date: line.slice(split + 1) });
	}
	return revisions;
}

function serializeRevisions(revisions: readonly Revision[]): string {
	return `${revisions.map((item) => `${item.hash} ${item.date}`).join("\n")}${revisions.length ? "\n" : ""}`;
}

function digest(text: string): string {
	return createHash("sha256").update(text, "utf8").digest("hex");
}

function git(cwd: string, args: readonly string[]): string | undefined {
	const result = spawnSync("git", args, { cwd, encoding: "utf8" });
	if (result.error || result.status !== 0) return;
	return result.stdout ?? "";
}
