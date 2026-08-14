import { initCommand, workspaceCommand } from "./commands/init.ts";
import { jobsCommand } from "./commands/jobs.ts";
import { migrateCommand } from "./commands/migrate.ts";
import { spawnCommand } from "./commands/spawn.ts";
import { stopCommand } from "./commands/stop.ts";
import { waitCommand } from "./commands/wait.ts";
import { unwatchCommand, watchCommand } from "./commands/watch.ts";
import { failInternalJob, runInternalJob } from "./proc.ts";

type Command = (args: readonly string[], cwd: string) => Promise<void>;
const COMMANDS = {
	init: initCommand,
	workspace: workspaceCommand,
	migrate: migrateCommand,
	spawn: spawnCommand,
	stop: stopCommand,
	wait: waitCommand,
	jobs: jobsCommand,
	watch: watchCommand,
	unwatch: unwatchCommand,
} as const satisfies Record<"init" | "workspace" | "migrate" | "spawn" | "stop" | "wait" | "jobs" | "watch" | "unwatch", Command>;
const HELP = `limen — isolated coding jobs with files and git
usage:
  limen init
  limen workspace init
  limen migrate
  limen spawn "Implement FNNN: <outcome>. Start by writing <slice>. Ticket: spec/features/active/FNNN-slug/ticket.md" [--label L] [--model X] [--branch B] [--timeout 20m; default 90m]
  limen spawn --repo R "Implement FNNN: <outcome>. Ticket: spec/features/active/FNNN-slug/ticket.md" [--label L] [--model X]
  limen spawn --review --branch B --label L "Review the FNNN candidate against spec/features/active/FNNN-slug/ticket.md"
  limen wait <id|suffix|label>
  limen stop <id|suffix|label> [reason]
  limen jobs [--running|--active|--all|<id|suffix|label>]
  limen watch <id|suffix|label> | --running
  limen unwatch <id|suffix|label> | --all
Pass a short coordinator instruction, not $(cat ticket.md). The ticket is a pointer, not the prompt.`;
export async function main(args: readonly string[], cwd = process.cwd()): Promise<void> {
	try {
		if (process.env.LIMEN_INTERNAL_RUN === "1") {
			await runInternalJob();
			return;
		}
		const [name, ...rest] = args;
		if (!name || name === "--help" || name === "-h" || name === "help") {
			console.log(HELP);
			return;
		}
		if (!(name in COMMANDS)) throw new Error(`unknown command ${JSON.stringify(name)}\n\n${HELP}`);
		await COMMANDS[name as keyof typeof COMMANDS](rest, cwd);
	} catch (error) {
		if (process.env.LIMEN_INTERNAL_RUN === "1") await failInternalJob(error);
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
