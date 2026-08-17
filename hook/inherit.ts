import { readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export type Drift = { readonly path: string; readonly kind: "leftover" | "overlay" };

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
		found.push({ path, kind: expected !== undefined && project === expected ? "leftover" : "overlay" });
	}
	return found;
}

export function formatDrift(drifts: readonly Drift[]): string {
	if (!drifts.length) return "";
	const leftovers = drifts.filter((item) => item.kind === "leftover").map((item) => item.path);
	const overlays = drifts.filter((item) => item.kind === "overlay").map((item) => item.path);
	const lines = [
		"## Guidance drift",
		"These project files copy or replace a Limen package default. Ask whether to delete leftovers (inherit the package) or keep overlays. Do not overwrite an overlay. `limen init --drop-leftovers` deletes only byte-identical leftovers.",
	];
	if (leftovers.length) lines.push(`leftover (identical; delete to inherit): ${leftovers.join(", ")}`);
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
