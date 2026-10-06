import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

export type EngineId = "pi" | "omp";
export type EngineProfile = {
	readonly id: EngineId;
	readonly binaryEnv: "LIMEN_PI" | "LIMEN_OMP";
	readonly binaryDefault: EngineId;
	readonly herdrKind: EngineId;
	readonly projectTrust: boolean;
	readonly toolYolo: boolean;
	readonly sessionName: boolean;
	readonly noTitle: boolean;
	readonly authCheck: boolean;
};
export type EngineArgv = {
	readonly jsonMode: boolean;
	readonly skillConfig?: string;
	readonly jobDir: string;
	readonly label: string;
	readonly preamble: string;
	readonly extensions: readonly string[];
	readonly provider?: string;
	readonly model?: string;
	readonly thinking?: string;
	readonly continueValue?: string;
	readonly taskFile?: string;
};
export const ENGINES: { readonly [K in EngineId]: EngineProfile } = {
	pi: {
		id: "pi",
		binaryEnv: "LIMEN_PI",
		binaryDefault: "pi",
		herdrKind: "pi",
		projectTrust: true,
		toolYolo: false,
		sessionName: true,
		noTitle: false,
		authCheck: true,
	},
	omp: {
		id: "omp",
		binaryEnv: "LIMEN_OMP",
		binaryDefault: "omp",
		herdrKind: "omp",
		projectTrust: false,
		toolYolo: true,
		sessionName: false,
		noTitle: true,
		authCheck: false,
	},
};
export function engineProfile(id: string): EngineProfile {
	if (id === "pi" || id === "omp") {
		return ENGINES[id];
	}
	throw new Error(`unknown engine ${id}`);
}
export function resolveSpawnEngine(flag?: string): EngineProfile {
	const raw = (flag ?? process.env.LIMEN_ENGINE)?.trim() || "omp";
	if (raw === "pi" || raw === "omp") {
		return ENGINES[raw];
	}
	throw new Error("--engine must be pi or omp");
}
export function engineBinary(profile: EngineProfile): string {
	return process.env[profile.binaryEnv] ?? profile.binaryDefault;
}
export async function jobProfile(jobDir: string): Promise<EngineProfile> {
	return engineProfile((await readFile(`${jobDir}/engine`, "utf8").catch(() => "pi")).trim() || "pi");
}
// Package fallback when neither --model nor the role's environment variable names a model.
export function defaultModel(review: boolean): string {
	return process.env[review ? "LIMEN_REVIEWER_MODEL" : "LIMEN_WORKER_MODEL"]?.trim() || "openai-codex/gpt-6-astra:high";
}
export function preflightEngine(profile: EngineProfile, model?: string, provider?: string): void {
	if (!(process.env.PATH ?? "").split(":").some((dir) => dir && existsSync(`${dir}/${profile.binaryDefault}`))) {
		throw new Error(
			`${profile.binaryDefault} is not on PATH; install it, or pass --engine ${profile.id === "omp" ? "pi" : "omp"}`,
		);
	}
	if (!profile.authCheck || process.env.LIMEN_PREFLIGHT !== "auth") {
		return;
	}
	const result = spawnSync(
		engineBinary(profile),
		["auth", "check", ...(provider ? ["--provider", provider] : []), ...(model ? ["--model", model] : [])],
		{
			encoding: "utf8",
		},
	);
	if (result.status !== 0) {
		throw new Error(
			(result.stderr || result.stdout || result.error?.message || "pi auth check failed").trim() ||
				"pi auth check failed",
		);
	}
}
// Keep Pi's source tree untouched. Rebuild the job-local view on each launch
// so resumed branches and newly added legacy skills get a fresh inventory.
export async function prepareSkillConfig(worktree: string, jobDir: string): Promise<string | undefined> {
	const legacy = join(worktree, ".pi/skills");
	const entries = await readdir(legacy).catch((error: NodeJS.ErrnoException) => {
		if (error.code === "ENOENT") {
			return [];
		}
		throw error;
	});
	const skills: { name: string; source: string; flat: boolean }[] = [];
	for (const entry of entries) {
		const source = join(legacy, entry);
		const info = await stat(source).catch(() => undefined);
		if (!info) {
			continue;
		}
		const flat = info.isFile() && entry.endsWith(".md");
		const name = flat ? basename(entry, ".md") : entry;
		if (!name) {
			continue;
		}
		if (!flat) {
			if (!info.isDirectory()) {
				continue;
			}
			const skillFile = await stat(join(source, "SKILL.md")).catch(() => undefined);
			if (!skillFile?.isFile()) {
				continue;
			}
		}
		if (
			(await stat(join(worktree, ".agents/skills", name, "SKILL.md")).catch(() => undefined))?.isFile() ||
			(await stat(join(worktree, ".omp/skills", name, "SKILL.md")).catch(() => undefined))?.isFile()
		) {
			continue;
		}
		// A directory skill carries its supporting files and takes priority over a flat duplicate.
		if (skills.some((skill) => skill.name === name && !skill.flat)) {
			continue;
		}
		const index = skills.findIndex((skill) => skill.name === name);
		if (index !== -1) {
			skills.splice(index, 1);
		}
		skills.push({ name, source, flat });
	}
	const view = join(jobDir, "skills");
	await rm(view, { recursive: true, force: true });
	if (!skills.length) {
		return;
	}
	await mkdir(view);
	for (const skill of skills) {
		const target = join(view, skill.name);
		if (skill.flat) {
			await mkdir(target);
			await symlink(skill.source, join(target, "SKILL.md"));
		} else {
			await symlink(skill.source, target);
		}
	}
	const configured = spawnSync(engineBinary(ENGINES.omp), ["config", "get", "skills.customDirectories", "--json"], {
		cwd: worktree,
		encoding: "utf8",
	});
	if (configured.error || configured.status !== 0) {
		throw new Error(
			`could not read OMP skill config: ${configured.stderr || configured.error?.message || configured.status}`,
		);
	}
	const parsed: unknown = configured.stdout.trim() ? JSON.parse(configured.stdout) : { value: [] };
	if (
		!parsed ||
		typeof parsed !== "object" ||
		!("value" in parsed) ||
		!Array.isArray(parsed.value) ||
		!parsed.value.every((path) => typeof path === "string")
	) {
		throw new Error("invalid OMP skills.customDirectories");
	}
	const config = join(jobDir, "skills-config.yml");
	await writeFile(
		config,
		`skills:\n  customDirectories:\n${[...parsed.value, view].map((path) => `    - ${JSON.stringify(path)}\n`).join("")}`,
	);
	return config;
}

export function argvFor(profile: EngineProfile, slots: EngineArgv): string[] {
	const args: string[] = [];
	if (slots.jsonMode) {
		args.push("--mode", "json");
	}
	if (profile.projectTrust) {
		args.push("--approve");
	}
	if (profile.toolYolo) {
		args.push("--auto-approve");
	}
	args.push("--no-extensions", "--session-dir", `${slots.jobDir}/session`);
	if (profile.sessionName) {
		args.push("--name", `limen: ${slots.label}`);
	}
	if (profile.noTitle) {
		args.push("--no-title");
	}
	if (profile.id === "omp" && slots.skillConfig) {
		args.push("--config", slots.skillConfig);
	}
	args.push("--append-system-prompt", slots.preamble);
	// OMP serves `pi-claude/…` models from a local bridge extension. The model id alone selects it:
	// OMP rejects `--provider pi-claude`, so the provider stays in the job record but not on argv.
	const bridged = profile.id === "omp" && !!slots.model?.startsWith("pi-claude/");
	const named = [
		...slots.extensions,
		...(bridged ? bridgeExtensions() : []),
		...(slots.jsonMode ? [] : herdrStateExtensions(profile)),
	];
	const seen = new Set<string>();
	for (const path of named) {
		const key = profile.id === "pi" && existsSync(path) ? realpathSync(path) : path;
		if (profile.id === "pi" && seen.has(key)) {
			continue;
		}
		seen.add(key);
		args.push("--extension", path);
	}
	if (slots.provider && !bridged) {
		args.push("--provider", slots.provider);
	}
	if (slots.model) {
		args.push("--model", slots.model);
	}
	if (slots.thinking) {
		args.push("--thinking", slots.thinking);
	}
	if (slots.continueValue !== undefined) {
		args.push("--continue", slots.continueValue);
	} else {
		args.push(`@${slots.taskFile}`);
	}
	return args;
}

// `--no-extensions` hides the bridge. Name it explicitly so the model resolves while other user
// extensions stay off.
function bridgeExtensions(): string[] {
	const bridge = join(homedir(), ".omp", "local", "pi-claude-bridge");
	return existsSync(bridge) ? [realpathSync(bridge)] : [];
}

// `--no-extensions` also hides Herdr's state extension, so a hosted pane falls back to screen
// detection and reads the working agent as idle. Name the Herdr-managed file by its marker.
function herdrStateExtensions(profile: EngineProfile): string[] {
	const dir = join(homedir(), `.${profile.id}`, "agent", "extensions");
	const files = existsSync(dir)
		? readdirSync(dir)
				.filter((name) => name.endsWith(".ts"))
				.sort()
		: [];
	const marker = new RegExp(`^// HERDR_INTEGRATION_ID=${profile.herdrKind}$`, "m");
	return files.map((name) => join(dir, name)).filter((path) => marker.test(readFileSync(path, "utf8")));
}
