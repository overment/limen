import { closeCommand } from "./commands/close.ts";
import { continueCommand } from "./commands/continue.ts";
import { diffCommand } from "./commands/diff.ts";
import { initCommand, workspaceCommand } from "./commands/init.ts";
import { jobsCommand } from "./commands/jobs.ts";
import { linearCommand } from "./commands/linear.ts";
import { openCommand } from "./commands/open.ts";
import { pruneCommand } from "./commands/prune.ts";
import { spawnCommand } from "./commands/spawn.ts";
import { steerCommand } from "./commands/steer.ts";
import { stopCommand } from "./commands/stop.ts";
import { sweepCommand } from "./commands/sweep.ts";
import { waitCommand } from "./commands/wait.ts";
import { unwatchCommand, watchCommand } from "./commands/watch.ts";
import { runHostedSupervisor } from "./supervisor.ts";
import { failInternalJob, runInternalJob } from "./wrapper.ts";

type Command = (args: readonly string[], cwd: string) => Promise<void>;
const COMMANDS = {
	init: initCommand,
	workspace: workspaceCommand,
	spawn: spawnCommand,
	continue: continueCommand,
	diff: diffCommand,
	steer: steerCommand,
	stop: stopCommand,
	wait: waitCommand,
	jobs: jobsCommand,
	prune: pruneCommand,
	watch: watchCommand,
	unwatch: unwatchCommand,
	open: openCommand,
	close: closeCommand,
	sweep: sweepCommand,
	linear: linearCommand,
} as const satisfies Record<
	"init" | "workspace" | "spawn" | "continue" | "diff" | "steer" | "stop" | "wait" | "jobs" | "prune" | "watch" | "unwatch" | "open" | "close" | "sweep" | "linear",
	Command
>;
const HELP = `limen — isolated coding jobs with files and git
usage:
  limen init
  limen init --drop-leftovers
  limen workspace init
  limen spawn "Implement FNNN: <outcome>. Start by writing <slice>. Ticket: spec/features/active/FNNN-slug/ticket.md" [--label L] [--model X] [--branch B] [--timeout 20m; default 90m] [--task-file F|-] [--prepare CMD]
  limen spawn "…" [--label L] [--model X]          # in Herdr: hosted interactive tab; else detached
  limen spawn --tab "…"                            # force hosted (requires Herdr; no --timeout)
  limen spawn --detached "…"                       # force background worker + log-tail tab
  limen spawn --repo R "Implement FNNN: <outcome>. Ticket: spec/features/active/FNNN-slug/ticket.md" [--label L] [--model X]
  limen spawn --review --branch B --label L "Review the FNNN candidate against spec/features/active/FNNN-slug/ticket.md"
  limen continue <id|suffix|label> "follow-up instruction" [--review] [--label L] [--model X] [--tab|--detached]
                                  # resume a finished job in its own pi session — full context, same worktree; Herdr default is hosted
  limen steer <id|suffix|label> "correction"
  limen diff <id|suffix|label>
  limen wait <id|suffix|label>
  limen stop <id|suffix|label> [reason]
  limen jobs [--running|--active|--all|<id|suffix|label>]
  limen prune
  limen watch <id|suffix|label> | --running
  limen unwatch <id|suffix|label> | --all
  limen open <id|suffix|label>
  limen close <FNNN>
  limen sweep [--install|--uninstall]
  limen linear [on [--team T --project P]|off|status]   # Linear mirror toggle — renames spec/linear.md ↔ .off; --team/--project write a fresh config
Pass a short coordinator instruction, not $(cat ticket.md). The ticket is a pointer, not the prompt.`;
export async function main(args: readonly string[], cwd = process.cwd()): Promise<void> {
	try {
		if (process.env.LIMEN_INTERNAL_RUN === "1") {
			await runInternalJob();
			return;
		}
		if (process.env.LIMEN_INTERNAL_HOSTED === "1") {
			await runHostedSupervisor();
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
		if (process.env.LIMEN_INTERNAL_RUN === "1" || process.env.LIMEN_INTERNAL_HOSTED === "1") await failInternalJob(error);
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
