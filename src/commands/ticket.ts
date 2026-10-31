import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readPicture } from "../picture/picture-build.ts";
import { ID_PATTERN } from "../picture/picture-model.ts";
import { currentBranch, limenRoot, repoRoot } from "../project/git.ts";
import { closeTickets } from "../project/lanes.ts";
import { plantSeries, readMark, seriesNext, setSeries, ticketCode, withNextTicketCode } from "../project/series.ts";
import { parseFlags } from "./flags.ts";
import { landTicketCheck } from "./land.ts";

const HELP = [
	'limen ticket new "what becomes true" [--lane planned|active] [--touches id,id]',
	"limen ticket check [BRANCH]  # the land gate for tickets BRANCH adds or changes against the plant branch; default: this checkout's branch",
	"limen ticket done FNNN [FNNN ...] [--on YYYY-MM-DD]  # landed without limen land: move the active ticket to done/ with its landed date (default today); NOW and PROVEN follow",
	"limen ticket series [NAME PLANT [PLANT ...]]  # the plants on this seat that take F numbers from one series; no arguments: this plant's series",
].join("\n");
const PLACE_ID = ID_PATTERN;

export async function ticketCommand(args: readonly string[], cwd: string): Promise<void> {
	if (args[0] === "check") {
		return ticketCheck(args.slice(1), cwd);
	}
	if (args[0] === "done") {
		return ticketDone(args.slice(1), cwd);
	}
	if (args[0] === "series") {
		return ticketSeries(args.slice(1), cwd);
	}
	const [mode, title, ...options] = args;
	if (mode !== "new" || !title || title.startsWith("--") || /[\r\n]/.test(title) || !title.trim()) {
		throw new Error(HELP);
	}
	const help = () => HELP;
	const { values } = parseFlags(options, { lane: { type: "string" }, touches: { type: "string" } } as const, {
		unknown: help,
		missing: help,
		repeated: help,
		positionals: false,
		endOfFlags: false,
	});
	if (values.lane !== undefined && values.lane !== "planned" && values.lane !== "active") {
		throw new Error(HELP);
	}
	const lane = values.lane ?? "planned";
	const touches = values.touches?.split(",") ?? [];
	if (!touches.every((id) => PLACE_ID.test(id)) || new Set(touches).size !== touches.length) {
		throw new Error(HELP);
	}
	const slug = title
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
	if (!slug) {
		throw new Error(HELP);
	}
	const root = repoRoot(cwd);
	const plant = process.env.LIMEN_CONTEXT_ROOT ?? root;
	if (touches.length) {
		const local = join(root, ".limen", "picture");
		const dir = existsSync(local) ? local : join(plant, ".limen", "picture");
		const map = await readPicture(dir);
		if (map.diagnostics.some((item) => item.level === "error")) {
			throw new Error(`the map at ${dir} has errors; run limen picture build --dir ${dir} --strict to see them`);
		}
		// The same places the strict check and the land gate accept: modules and the plant.
		const places = new Set(map.nodes.filter((node) => node.kind === "module").map((node) => node.id));
		if (map.project.rootId) {
			places.add(map.project.rootId);
		}
		const unknown = touches.find((id) => !places.has(id));
		if (unknown) {
			throw new Error(`unknown map place id "${unknown}"; choose the id: of a module or plant file in ${dir}/nodes/`);
		}
	}
	const base = join(root, "spec", "features");
	const now = new Date();
	const opened = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
	const normalizedTitle = title.trim();
	const outcome = /[.!?]$/.test(normalizedTitle) ? normalizedTitle : `${normalizedTitle}.`;
	const template = await readFile(join(base, "_template", "ticket.md"), "utf8").catch(
		(error: NodeJS.ErrnoException) => {
			if (error.code !== "ENOENT") {
				throw error;
			}
			return readFile(
				fileURLToPath(new URL("../../templates/spec/features/_template/ticket.md", import.meta.url)),
				"utf8",
			);
		},
	);
	const start = template.indexOf("## Outcome\n");
	if (start < 0) {
		throw new Error("ticket template needs an ## Outcome section");
	}
	// The folder exists before the series lock is released, so a plant that takes the next code sees this one.
	const path = withNextTicketCode(root, plant, (code) => {
		const path = join("spec", "features", lane, `${code}-${slug}`, "ticket.md");
		const text = `---\n${touches.length ? `touches:\n${touches.map((id) => `  - ${id}\n`).join("")}` : ""}opened: ${opened}\n---\n\n# ${code} · ${normalizedTitle}\n\n${template.slice(start).replace("## Outcome\n", `## Outcome\n\n${outcome}\n`)}`;
		mkdirSync(join(base, lane), { recursive: true });
		mkdirSync(join(root, dirname(path)));
		writeFileSync(join(root, path), text, { flag: "wx" });
		return path;
	});
	console.log(path);
}

/** Names the plants of a series, or shows the series this plant takes numbers from. */
function ticketSeries(args: readonly string[], cwd: string): void {
	const [name, ...plants] = args;
	if (args.some((arg) => arg.startsWith("-")) || (name !== undefined && plants.length === 0)) {
		throw new Error(HELP);
	}
	const plant = process.env.LIMEN_CONTEXT_ROOT ?? repoRoot(cwd);
	const roots = plants.map((each) => resolve(cwd, each));
	const series = name ? setSeries(name, roots) : plantSeries(plant);
	if (!series) {
		console.log(`no series names ${plant}; ticket new numbers it alone`);
		return;
	}
	const mark = readMark(series);
	const plantLines = series.plants.map((each) => `plant ${each}`).join("\n");
	console.log(`series ${series.name}\n${plantLines}\nmark ${mark ? ticketCode(mark) : "none"}`);
	console.log(`next ${ticketCode(seriesNext(series))}`);
}

/** The close `limen land` makes, for work that landed by a hand merge or needed no code. */
async function ticketDone(args: readonly string[], cwd: string): Promise<void> {
	const help = () => HELP;
	const { values, positionals: codes } = parseFlags(args, { on: { type: "string" } } as const, {
		unknown: help,
		missing: help,
		repeated: help,
		endOfFlags: false,
	});
	const on = values.on;
	if (codes.length === 0 || !codes.every((code) => /^F\d+$/i.test(code)) || (on && !/^\d{4}-\d\d-\d\d$/.test(on))) {
		throw new Error(HELP);
	}
	const root = limenRoot(cwd);
	const closed = await (on ? closeTickets(root, codes, `landed ${on}`, on) : closeTickets(root, codes, "landed"));
	const missing = codes.filter((code) => !closed.moved.some((path) => path.includes(`/${code.toUpperCase()}-`)));
	for (const path of closed.moved) {
		console.log(`closed ${path}${closed.commit ? ` in ${closed.commit}` : ""}`);
	}
	if (missing.length) {
		throw new Error(`no active ticket for ${missing.join(", ")} in ${root}/spec/features/active/`);
	}
}

/** The land gate on demand, so a hand merge or a keeper can check a branch before it reaches the plant branch. */
async function ticketCheck(args: readonly string[], cwd: string): Promise<void> {
	if (args.length > 1 || args[0]?.startsWith("-")) {
		throw new Error(HELP);
	}
	const repository = repoRoot(cwd);
	const plant = process.env.LIMEN_CONTEXT_ROOT ?? limenRoot(cwd);
	const target = currentBranch(plant);
	const branch = args[0] ?? currentBranch(repository);
	if (branch === target) {
		throw new Error(
			`ticket check compares a branch with ${target}; name the branch to check: limen ticket check BRANCH`,
		);
	}
	const job =
		branch.startsWith("limen/") && existsSync(join(plant, ".limen", "jobs", branch.slice("limen/".length)))
			? branch.slice("limen/".length)
			: "<id>";
	const gate = await landTicketCheck(repository, plant, branch, target, job);
	for (const line of gate.lines) {
		(gate.ok ? console.log : console.error)(line);
	}
	if (!gate.ok) {
		process.exitCode = 1;
	} else {
		console.log(
			`ticket check: ${gate.tickets.length} changed ticket${gate.tickets.length === 1 ? "" : "s"} on ${branch} pass against ${target}`,
		);
	}
}
