import { resolve } from "node:path";
import type { ParseArgsOptionsConfig } from "node:util";
import { buildPicture } from "../picture/picture-build.ts";
import { headCommit, repoRoot } from "../project/git.ts";
import { firstPictureHint, pictureTick } from "../project/picture-tick.ts";
import { pictureWatch } from "../project/picture-watch.ts";
import { parseFlags } from "./flags.ts";

const HELP =
	"limen picture build [--dir D] [--out F] [--json F] [--strict]\nlimen picture tick [--dir D] [--branch B] [--dry-run] --engine E --provider P --model M --thinking T\nlimen picture watch [off | on [--branch B] [--dir D] --engine E --provider P --model M --thinking T]";
const MODEL_FLAGS = ["--engine", "--provider", "--model", "--thinking"];
const VALUE = { type: "string" } as const;
const SWITCH = { type: "boolean" } as const;
const ROUTE = { dir: VALUE, branch: VALUE, engine: VALUE, provider: VALUE, model: VALUE, thinking: VALUE };
const TABLES: Record<"build" | "tick" | "on" | "off" | "status", ParseArgsOptionsConfig> = {
	build: { dir: VALUE, out: VALUE, json: VALUE, strict: SWITCH },
	tick: { ...ROUTE, "dry-run": SWITCH },
	on: ROUTE,
	off: {},
	status: {},
};

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: split pending: picture subcommand dispatch
export async function pictureCommand(args: readonly string[], cwd: string): Promise<void> {
	const [mode, ...options] = args;
	if (mode !== "build" && mode !== "tick" && mode !== "watch") {
		throw new Error(HELP);
	}
	let watch: "on" | "off" | "status" | undefined;
	if (mode === "watch") {
		watch = options[0] === "on" || options[0] === "off" ? options[0] : "status";
	}
	const rest = watch === "on" || watch === "off" ? options.slice(1) : options;
	const table = mode === "watch" ? TABLES[watch ?? "status"] : TABLES[mode];
	const invalid = (word: string) => `invalid picture option ${word}\n${HELP}`;
	const parsed = parseFlags(rest, table, {
		unknown: invalid,
		missing: invalid,
		repeated: (flag) => (table[flag.slice(2)]?.type === "string" ? invalid(flag) : undefined),
		positionals: false,
		endOfFlags: false,
	});
	const values = new Map<string, string>();
	for (const [name, value] of Object.entries(parsed.values)) {
		if (typeof value === "string") {
			values.set(`--${name}`, value);
		}
	}
	const strict = parsed.values.strict === true;
	const dryRun = parsed.values["dry-run"] === true;
	const dir = values.get("--dir");
	if (watch) {
		if (watch === "on" && MODEL_FLAGS.some((flag) => !values.has(flag))) {
			throw new Error(`picture watch on needs --engine --provider --model --thinking\n${HELP}`);
		}
		await pictureWatch(
			cwd,
			watch,
			dir && resolve(cwd, dir),
			values.get("--branch"),
			MODEL_FLAGS.flatMap((flag) => [flag, values.get(flag) ?? ""]),
		);
		return;
	}
	const root = repoRoot(cwd);
	const picture = resolve(cwd, dir ?? `${root}/.limen/picture`);
	if (mode === "tick") {
		await pictureTick(root, picture, values, dryRun);
		return;
	}
	const out = resolve(cwd, values.get("--out") ?? `${picture}/map.html`);
	const json = values.get("--json");
	const model = await buildPicture(picture, out, json ? resolve(cwd, json) : undefined, headCommit(root), root).catch(
		(error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT" && error.path === picture) {
				throw new Error(firstPictureHint(picture));
			}
			throw error;
		},
	);
	for (const d of model.diagnostics) {
		console.error(
			`${d.level} ${d.code}${d.source ? ` ${d.source}${d.line === null ? "" : `:${d.line}`}` : ""}: ${d.message}`,
		);
	}
	console.log(`picture: ${model.nodes.length} places, ${model.edges.length} edges; wrote ${out}`);
	if (strict && model.diagnostics.some((d) => d.level === "error")) {
		process.exitCode = 1;
	}
}
