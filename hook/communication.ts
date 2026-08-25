import { readdirSync } from "node:fs";
import { join } from "node:path";
import { formatDrift, inheritFile, listDrift, readOptional } from "./inherit.ts";

const CONTEXT_TYPE = "limen-project-context";
const MAX_CONTEXT_LINES = 1000;
const FEATURE_NAME = /^F\d+-[A-Za-z0-9][A-Za-z0-9._-]*$/;
const BOARD_FEATURE = /(?:^|[^A-Za-z0-9._-])(F\d+-[A-Za-z0-9][A-Za-z0-9._-]*)/g;

type Context = { readonly cwd: string };
type Message = { readonly customType: string; readonly content: string; readonly display: boolean };
type StartEvent = { readonly prompt?: string; readonly systemPrompt?: string };
type StartResult = { readonly message?: Message; readonly systemPrompt?: string };
type PiApi = {
	on(event: "before_agent_start", handler: (event: StartEvent, context: Context) => StartResult | undefined): void;
};

/** Attach project context after each user message. Append speech to the system prompt so it never appears in the thread. */
export default function limenCommunication(pi: PiApi): void {
	pi.on("before_agent_start", (event, context) => {
		const root = process.env.LIMEN_CONTEXT_ROOT ?? context.cwd;
		// Wakes are extension prompts that already carry the job record. Re-attaching vision/build
		// on every completion is noise; speech still appends so the reply keeps its register.
		const message = isWakePrompt(event.prompt) ? undefined : readProjectContext(root);
		const speech = readCommunication(root);
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

function readProjectContext(cwd: string): string {
	const sections = [
		readBoundedFile(cwd, "spec/vision.md", "Vision"),
		readBoundedFile(cwd, "spec/build.md", "Build board"),
		readBoundedFile(cwd, ".agents/limen/styleguide.md", "Styleguide"),
		readInheritedAgents(cwd),
		buildAdvisory(cwd),
		formatDrift(listDrift(cwd)),
	].filter((section): section is string => Boolean(section));
	if (!sections.length) return "";
	return [
		"<limen-project-context>",
		"Project-owned context attached to this user message. Follow the current human request and accepted ticket; use the vision for durable intent, the build board for current state, and the styleguide for how to write and organize code here.",
		...sections,
		"</limen-project-context>",
	].join("\n\n");
}

function readCommunication(cwd: string): string {
	const inherited = inheritFile(cwd, ".agents/limen/communication.md", "templates/communication.md");
	if (!inherited) return "";
	const body = boundText(inherited.text, inherited.path, "Communication");
	if (!body) return "";
	const audience = process.env.LIMEN_JOB === "1" ? "agent" : "human";
	return [
		"<limen-communication>",
		`Audience for this reply: ${audience}. Use that register. Switch only for the part another agent will execute.`,
		body,
		"</limen-communication>",
	].join("\n\n");
}

function readInheritedAgents(cwd: string): string {
	if (process.env.LIMEN_JOB === "1" || readOptional(join(cwd, "AGENTS.md")) !== undefined) return "";
	const inherited = inheritFile(cwd, "AGENTS.md", "templates/agents.md");
	return inherited ? boundText(inherited.text, inherited.path, "Shop manual") : "";
}

function readBoundedFile(cwd: string, path: string, label: string): string {
	const text = readOptional(join(cwd, path));
	if (text === undefined) return "";
	return boundText(text, path, label);
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
