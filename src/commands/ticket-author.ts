import { ticketAuthor } from "../git.ts";

export async function ticketAuthorCommand(args: readonly string[], cwd: string): Promise<void> {
	const ticket = args[0];
	if (!ticket || args.length !== 1) throw new Error("ticket-author requires one ticket path");
	const author = ticketAuthor(cwd, ticket);
	const github = /^(?:\d+\+)?([a-z\d](?:[a-z\d-]{0,37}[a-z\d])?)@users\.noreply\.github\.com$/i.exec(author.email)?.[1];
	console.log(`Ticket: ${author.path}\nAuthor: ${author.name} <${author.email}>`);
	if (github) console.log(`GitHub: @${github} (from recorded noreply email)`);
	console.log(`Creation commit: ${author.commit}\nSource: Git author at HEAD, following renames; not verified human identity.`);
}
