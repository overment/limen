import { initCommand } from "./commands/init.ts";
import { jobsCommand } from "./commands/jobs.ts";
import { spawnCommand } from "./commands/spawn.ts";
import { stopCommand } from "./commands/stop.ts";
import { waitCommand } from "./commands/wait.ts";
import { failInternalJob, runInternalJob } from "./proc.ts";

type Command = (args: readonly string[], cwd: string) => Promise<void>;
const COMMANDS = {
	init: initCommand,
	spawn: spawnCommand,
	stop: stopCommand,
	wait: waitCommand,
	jobs: jobsCommand,
} as const satisfies Record<"init" | "spawn" | "stop" | "wait" | "jobs", Command>;

const HELP = `control — isolated coding jobs with files and git

usage:
  control init
  control spawn "task text" [--label L] [--model X] [--branch B] [--timeout 20m]
  control spawn --review --branch B --label L "review task"
  control wait <id|suffix|label>
  control stop <id|suffix|label> [reason]
  control jobs`;

export async function main(args: readonly string[], cwd = process.cwd()): Promise<void> {
	try {
		if (process.env.CONTROL_INTERNAL_RUN === "1") {
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
		if (process.env.CONTROL_INTERNAL_RUN === "1") await failInternalJob(error);
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
