import { readdirSync } from "node:fs";
import { join } from "node:path";
import { formatDrift, inheritFile, listDrift, readOptional } from "./inherit.ts";
import { registerSpeak, type SpeakPiApi } from "./speak.ts";

const CONTEXT_TYPE = "limen-project-context";
const MAX_CONTEXT_LINES = 1000;
const FEATURE_NAME = /^F\d+-[A-Za-z0-9][A-Za-z0-9._-]*$/;
const BOARD_FEATURE = /(?:^|[^A-Za-z0-9._-])(F\d+-[A-Za-z0-9][A-Za-z0-9._-]*)/g;

type Context = { readonly cwd: string };
type Message = { readonly customType: string; readonly content: string; readonly display: boolean };
type StartEvent = { readonly prompt?: string; readonly systemPrompt?: string };
type StartResult = { readonly message?: Message; readonly systemPrompt?: string };
type PiApi = SpeakPiApi & {
	on(event: "before_agent_start", handler: (event: StartEvent, context: Context) => StartResult | undefined): void;
};

/** Attach a governing-files note after each user message; bodies stay on disk. Append speech to the system prompt so it never appears in the thread. */
export default function limenCommunication(pi: PiApi): void {
	registerSpeak(pi);
	pi.on("before_agent_start", (event, context) => {
		const root = process.env.LIMEN_CONTEXT_ROOT ?? context.cwd;
		// Wakes are extension prompts that already carry the job record. Re-attaching vision/build
		// on every completion is noise; speech still appends, and names the wake so the reply opens with what the job did.
		const message = isWakePrompt(event.prompt) ? undefined : readProjectContext(root);
		const speech = readCommunication(root, isWakePrompt(event.prompt));
		if (!message && !speech) return;
		return {
			...(message ? { message: { customType: CONTEXT_TYPE, content: message, display: false } } : {}),
			...(speech ? { systemPrompt: `${event.systemPrompt ?? ""}\n\n${speech}` } : {}),
		};
	});
}

function isWakePrompt(prompt: string | undefined): boolean {
	return typeof prompt === "string" && prompt.startsWith("Limen job ");
}

const GOVERNING_FILES = [
	["spec/vision.md", "durable intent. Keep it present in the interaction at all times; load it before any touch of the feature specifications."],
	["spec/build.md", "the current state of work (TRACK / NOW / NEXT / PROVEN). Consult it before selecting, starting, or reporting work, and keep it aligned as work moves."],
	[".agents/limen/styleguide.md", "project coding practice. Load it before writing or modifying feature specifications, and have it in context whenever you modify files."],
] as const;

function readProjectContext(cwd: string): string {
	const sections = [governingFileNotes(cwd), readInheritedAgents(cwd), buildAdvisory(cwd), formatDrift(listDrift(cwd))].filter((section): section is string => Boolean(section));
	if (!sections.length) return "";
	return [
		"<limen-project-context>",
		"Important note: the project files below govern this work and are referenced, not attached. This note rides on every user message; the file bodies do not. Having their current contents in context is your responsibility — read them with your tools, and re-read them after compaction or when work has landed since your last read. Follow the current human request and the accepted ticket.",
		...sections,
		"</limen-project-context>",
	].join("\n\n");
}

function governingFileNotes(cwd: string): string {
	const lines = GOVERNING_FILES.filter(([path]) => readOptional(join(cwd, path)) !== undefined).map(([path, rule]) => `- \`${path}\` — ${rule}`);
	return lines.length ? `## Governing files\n${lines.join("\n")}` : "";
}

function readCommunication(cwd: string, wake: boolean): string {
	const inherited = inheritFile(cwd, ".agents/limen/communication.md", "templates/communication.md");
	if (!inherited) return "";
	const body = boundText(inherited.text, inherited.path, "Communication");
	if (!body) return "";
	const audience = process.env.LIMEN_JOB === "1" ? "agent" : "human";
	const situation = wake
		? " This turn was opened by a job wake, not by the human. They have not seen the job's work or its state: say which job it was and what it did before what comes next."
		: "";
	return [
		"<limen-communication>",
		`Audience for this reply: ${audience}. Use that register.${situation} Switch only for the part another agent will execute.`,
		body,
		"</limen-communication>",
	].join("\n\n");
}

function readInheritedAgents(cwd: string): string {
	if (process.env.LIMEN_JOB === "1" || readOptional(join(cwd, "AGENTS.md")) !== undefined) return "";
	const inherited = inheritFile(cwd, "AGENTS.md", "templates/agents.md");
	return inherited ? boundText(inherited.text, inherited.path, "Shop manual") : "";
}

function boundText(text: string, path: string, label: string): string {
	const lines = trimmedLines(text);
	if (!lines.length) return "";
	const content = lines.slice(0, MAX_CONTEXT_LINES).join("\n");
	const notice = lines.length > MAX_CONTEXT_LINES ? `\n\n[${path} truncated to ${MAX_CONTEXT_LINES} of ${lines.length} lines; read the file for remaining context.]` : "";
	return `## ${label} (${path})\n${content}${notice}`;
}

function buildAdvisory(cwd: string): string {
	const board = readOptional(join(cwd, "spec/build.md"));
	if (board === undefined) return "## Build-board advisory\n`spec/build.md` is unavailable. Reconcile the board before proceeding; this is an advisory, not a gate.";
	const boardFeatures = new Set(Array.from(board.matchAll(BOARD_FEATURE), (match) => match[1]));
	const missing = ["active", "planned"].flatMap((lane) =>
		featureNames(cwd, lane)
			.filter((feature) => !boardFeatures.has(feature))
			.map((feature) => `${lane}: ${feature}`),
	);
	if (!missing.length) return "";
	return `## Build-board advisory\nThese feature folders are not referenced by \`spec/build.md\`: ${missing.join(", ")}. Reconcile the board before proceeding; this is an advisory, not a gate.`;
}

function featureNames(cwd: string, lane: string): readonly string[] {
	try {
		return readdirSync(join(cwd, "spec/features", lane), { withFileTypes: true })
			.filter((entry) => entry.isDirectory() && FEATURE_NAME.test(entry.name))
			.map((entry) => entry.name);
	} catch {
		return [];
	}
}

function trimmedLines(text: string): readonly string[] {
	const lines = text.replaceAll("\r\n", "\n").split("\n");
	while (lines[0]?.trim() === "") lines.shift();
	while (lines.at(-1)?.trim() === "") lines.pop();
	return lines;
}
