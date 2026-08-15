import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CONTEXT_TYPE = "limen-project-context";
const COMMUNICATION_TYPE = "limen-communication";
const MAX_CONTEXT_LINES = 1000;
const FEATURE_NAME = /^F\d+-[A-Za-z0-9][A-Za-z0-9._-]*$/;
const BOARD_FEATURE = /(?:^|[^A-Za-z0-9._-])(F\d+-[A-Za-z0-9][A-Za-z0-9._-]*)/g;

type Context = { readonly cwd: string };
type Message = { readonly customType: string; readonly content: string; readonly display: boolean };
type ContextMessage = { readonly role?: string; readonly customType?: string; readonly content?: unknown; readonly display?: boolean };
type PiApi = {
	on(event: "before_agent_start", handler: (event: unknown, context: Context) => { readonly message: Message } | undefined): void;
	on(event: "context", handler: (event: { readonly messages: ContextMessage[] }, context: Context) => { readonly messages: ContextMessage[] } | undefined): void;
};

/** Attach project coding context after each user message; restack speech registers before every LLM call. */
export default function limenCommunication(pi: PiApi): void {
	pi.on("before_agent_start", (_event, context) => {
		const content = readProjectContext(projectRoot(context));
		return content ? { message: { customType: CONTEXT_TYPE, content, display: false } } : undefined;
	});
	pi.on("context", (event, context) => {
		const content = readCommunication(projectRoot(context));
		if (!content) return;
		const messages = event.messages.filter((message) => message.customType !== COMMUNICATION_TYPE);
		messages.push({ role: "custom", customType: COMMUNICATION_TYPE, content, display: false });
		return { messages };
	});
}

function projectRoot(context: Context): string {
	return process.env.LIMEN_CONTEXT_ROOT ?? context.cwd;
}

function readProjectContext(cwd: string): string {
	const sections = [
		readBoundedFile(cwd, "spec/vision.md", "Vision"),
		readBoundedFile(cwd, "spec/build.md", "Build board"),
		readBoundedFile(cwd, ".agents/limen/styleguide.md", "Styleguide"),
		buildAdvisory(cwd),
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
	const body = readBoundedFile(cwd, ".agents/limen/communication.md", "Communication");
	if (!body) return "";
	const audience = process.env.LIMEN_JOB === "1" ? "agent" : "human";
	return [
		"<limen-communication>",
		`Audience for this reply: ${audience}. Use that register. Switch only for the part another agent will execute.`,
		body,
		"</limen-communication>",
	].join("\n\n");
}

function readBoundedFile(cwd: string, path: string, label: string): string {
	const text = readText(join(cwd, path));
	if (text === undefined) return "";
	const lines = trimmedLines(text);
	if (!lines.length) return "";
	const content = lines.slice(0, MAX_CONTEXT_LINES).join("\n");
	const notice = lines.length > MAX_CONTEXT_LINES ? `\n\n[${path} truncated to ${MAX_CONTEXT_LINES} of ${lines.length} lines; read the file for remaining context.]` : "";
	return `## ${label} (${path})\n${content}${notice}`;
}

function buildAdvisory(cwd: string): string {
	const board = readText(join(cwd, "spec/build.md"));
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

function readText(path: string): string | undefined {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
}

function trimmedLines(text: string): readonly string[] {
	const lines = text.replaceAll("\r\n", "\n").split("\n");
	while (lines[0]?.trim() === "") lines.shift();
	while (lines.at(-1)?.trim() === "") lines.pop();
	return lines;
}
