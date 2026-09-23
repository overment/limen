import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

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
	if (id === "pi" || id === "omp") return ENGINES[id];
	throw new Error(`unknown engine ${id}`);
}
export function resolveSpawnEngine(flag?: string): EngineProfile {
	const raw = (flag ?? process.env.LIMEN_ENGINE)?.trim() || "omp";
	if (raw === "pi" || raw === "omp") return ENGINES[raw];
	throw new Error("--engine must be pi or omp");
}
export function engineBinary(profile: EngineProfile): string {
	return process.env[profile.binaryEnv] ?? profile.binaryDefault;
}
export async function jobProfile(jobDir: string): Promise<EngineProfile> {
	return engineProfile((await readFile(`${jobDir}/engine`, "utf8").catch(() => "pi")).trim() || "pi");
}
export function preflightEngine(profile: EngineProfile, model?: string, provider?: string): void {
	if (!(process.env.PATH ?? "").split(":").some((dir) => dir && existsSync(`${dir}/${profile.binaryDefault}`))) throw new Error(`${profile.binaryDefault} is not on PATH`);
	if (!profile.authCheck || process.env.LIMEN_PREFLIGHT !== "auth") return;
	const result = spawnSync(engineBinary(profile), ["auth", "check", ...(provider ? ["--provider", provider] : []), ...(model ? ["--model", model] : [])], {
		encoding: "utf8",
	});
	if (result.status !== 0) throw new Error((result.stderr || result.stdout || result.error?.message || "pi auth check failed").trim() || "pi auth check failed");
}
export function argvFor(profile: EngineProfile, slots: EngineArgv): string[] {
	const args: string[] = [];
	if (slots.jsonMode) args.push("--mode", "json");
	if (profile.projectTrust) args.push("--approve");
	if (profile.toolYolo) args.push("--auto-approve");
	args.push("--no-extensions", "--session-dir", `${slots.jobDir}/session`);
	if (profile.sessionName) args.push("--name", `limen: ${slots.label}`);
	if (profile.noTitle) args.push("--no-title");
	args.push("--append-system-prompt", slots.preamble);
	for (const path of slots.extensions) args.push("--extension", path);
	if (slots.provider) args.push("--provider", slots.provider);
	if (slots.model) args.push("--model", slots.model);
	if (slots.thinking) args.push("--thinking", slots.thinking);
	if (slots.continueValue !== undefined) args.push("--continue", slots.continueValue);
	else args.push(`@${slots.taskFile}`);
	return args;
}
