import { GITHUB_NOREPLY } from "../integrations/finish-receipt.ts";
import { ticketAuthor } from "../project/git.ts";

export async function ticketAuthorCommand(args: readonly string[], cwd: string): Promise<void> {
	const ticket = args[0];
	if (!ticket || args.length !== 1) {
		throw new Error("ticket-author requires one ticket path");
	}
	const author = ticketAuthor(cwd, ticket);
	const github = GITHUB_NOREPLY.exec(author.email)?.[1];
	console.log(`Ticket: ${author.path}\nAuthor: ${author.name} <${author.email}>`);
	if (github) {
		console.log(`GitHub: @${github} (from recorded noreply email)`);
	}
	console.log(
		`Creation commit: ${author.commit}\nSource: creation author in HEAD history, following renames; not verified human identity.`,
	);
}
