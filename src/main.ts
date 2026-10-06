import { closeCommand } from "./commands/close.ts";
import { continueCommand } from "./commands/continue.ts";
import { diffCommand } from "./commands/diff.ts";
import { githubCommand } from "./commands/github.ts";
import { groupCommand } from "./commands/group.ts";
import { initCommand, workspaceCommand } from "./commands/init.ts";
import { jobsCommand } from "./commands/jobs.ts";
import { keeperCommand } from "./commands/keeper.ts";
import { landCommand } from "./commands/land.ts";
import { linearCommand } from "./commands/linear.ts";
import { openCommand } from "./commands/open.ts";
import { pictureCommand } from "./commands/picture.ts";
import { planningCommand } from "./commands/planning-source.ts";
import { pruneCommand } from "./commands/prune.ts";
import { spawnCommand } from "./commands/spawn.ts";
import { statusCommand } from "./commands/status.ts";
import { steerCommand } from "./commands/steer.ts";
import { stopCommand } from "./commands/stop.ts";
import { sweepCommand } from "./commands/sweep.ts";
import { ticketCommand } from "./commands/ticket.ts";
import { ticketAuthorCommand } from "./commands/ticket-author.ts";
import { waitCommand } from "./commands/wait.ts";
import { unwatchCommand, watchCommand } from "./commands/watch.ts";
import { webhookCommand } from "./commands/webhook.ts";
import { runHostedSupervisor } from "./runtime/supervisor.ts";
import { failInternalJob, runInternalJob } from "./runtime/wrapper.ts";

type Command = (args: readonly string[], cwd: string) => Promise<void>;
const COMMANDS = {
	init: initCommand,
	workspace: workspaceCommand,
	planning: planningCommand,
	github: githubCommand,
	group: groupCommand,
	spawn: spawnCommand,
	continue: continueCommand,
	diff: diffCommand,
	steer: steerCommand,
	stop: stopCommand,
	wait: waitCommand,
	land: landCommand,
	keeper: keeperCommand,
	jobs: jobsCommand,
	status: statusCommand,
	prune: pruneCommand,
	watch: watchCommand,
	unwatch: unwatchCommand,
	open: openCommand,
	picture: pictureCommand,
	close: closeCommand,
	sweep: sweepCommand,
	linear: linearCommand,
	"ticket-author": ticketAuthorCommand,
	ticket: ticketCommand,
	webhook: webhookCommand,
} as const satisfies Record<
	| "init"
	| "workspace"
	| "planning"
	| "spawn"
	| "continue"
	| "github"
	| "group"
	| "diff"
	| "steer"
	| "stop"
	| "wait"
	| "land"
	| "keeper"
	| "jobs"
	| "status"
	| "prune"
	| "watch"
	| "unwatch"
	| "open"
	| "picture"
	| "close"
	| "sweep"
	| "linear"
	| "ticket-author"
	| "ticket"
	| "webhook",
	Command
>;
const HELP = `limen — isolated coding jobs with files and git
usage:
  limen init
  limen init --drop-leftovers
  limen workspace init
  limen planning [committed|private]                # inspect or persist the project planning source; default committed
  limen group start FEATURE --teams N --workers-per-team N --timeout D --worker-timeout D --engine E --provider P --model M --thinking T --worker-thinking T [--team-model team-N=provider/model] [--extension PATH ...] [--team-extension team-N=PATH ...; Pi only] [--detached|--tab] [--new-run]
  limen group status [GROUP-ID] [--json]  # short roster by default; --json keeps the full record
  limen group publish [GROUP-ID] [--team team-N] "finding"  # members inherit verified membership; lead supplies ID
  limen group wait [GROUP-ID] [--timeout D]
  limen group stop|close [GROUP-ID]
  limen spawn --engine <engine> --provider <provider> --model <model> --thinking <level> "Implement FNNN: <outcome>. Start by writing <slice>. Ticket: spec/features/active/FNNN-slug/ticket.md" [--label L] [--branch B] [--role NAME] [--timeout 20m; default 90m] [--task-file F|-] [--prepare CMD] [--extension PATH ...; Pi only]
  limen spawn --engine <engine> --provider <provider> --model <model> --thinking <level> "Short title" --task-file F|-  # the file is the task; the positional words become the label
  limen spawn --engine <engine> --provider <provider> --model <model> --thinking <level> "…" [--label L]  # selected engine's flags; in Herdr: hosted, else detached
  limen spawn --engine <engine> --provider <provider> --model <model> --thinking <level> --tab "…"  # force hosted (requires Herdr; no --timeout)
  limen spawn --engine <engine> --provider <provider> --model <model> --thinking <level> --detached "…"  # force background worker + log-tail tab
  limen spawn --engine <engine> --provider <provider> --model <model> --thinking <level> --repo R "Implement FNNN: <outcome>. Ticket: spec/features/active/FNNN-slug/ticket.md" [--label L]
  limen spawn --engine <engine> --provider <provider> --model <model> --thinking <level> --review --detached --branch B --label L [--base SHA] [--head SHA] "Review the FNNN candidate against spec/features/active/FNNN-slug/ticket.md"
  limen continue <id|suffix|label> "follow-up instruction" [--review] [--label L] [--engine pi|omp] [--provider P] [--model X] [--thinking T] [--tab|--detached] [--extension PATH ...; replaces ordinary Pi list, group list stays fixed]
                                  # resume a finished job in its own engine session — full context, same worktree; Herdr default is hosted
  limen steer <id|suffix|label> | --running "correction"
  limen diff <id|suffix|label>
  limen wait <id|suffix|label>
  limen land <id|suffix|label> [--onto BRANCH] [--yes]  # merge a done job onto the current branch
  limen keeper <ticket-path> (--job ID [--job ID ...] | --group GROUP-ID) [--candidate BRANCH] --engine E --provider P --model M --thinking T [--timeout D]  # after the work: a short job fixes ticket, board and map links on its own branch
  limen stop <id|suffix|label> [reason]
  limen jobs [--running|--active|--all|--label PREFIX|<id|suffix|label>]
  limen status [--all]                          # plant inbox: running, candidates to inspect, needs a decision (last 7 days), coordinator tabs
  limen prune [--retire [--dry-run]]           # --retire deletes finished, failed, or stopped job records whose branch is landed (ancestor or cherry-pick) or deleted
  limen watch <id|suffix|label> | --running
  limen unwatch <id|suffix|label> | --all
  limen open <id|suffix|label>
  limen close <FNNN>
  limen ticket-author <ticket-path>                 # creation-commit author, following Git renames
  limen ticket new "what becomes true" [--lane planned|active] [--touches id,id]  # next unused F number across lanes, limen/* branches and job labels
  limen ticket check [BRANCH]                    # land gate on demand: tickets BRANCH adds or changes; run before a hand git merge
  limen sweep [--install|--uninstall]
  limen webhook test                             # send one test ping to this plant's finish webhook targets
  limen linear [on [--team T --project P]|off|status]   # Linear mirror toggle — renames spec/linear.md ↔ .off; --team/--project write a fresh config
  limen github connect|disconnect|status|doctor  # bind projects and diagnose seat safety
  limen github ensure [registered-root]       # require a live registered Herdr coordinator
  limen github poll                           # run one polling pass as the isolated App user
  limen github deliver <root> <claim-id> <handoff-nonce>  # poller only: hand one claim to the live coordinator
  limen github review <root> <claim-id> --engine E --provider P --model M --thinking T  # hosted review for one doorbell claim
  limen github work <root> <claim-id> --engine E --provider P --model M --thinking T --task "…"  # hosted task for one doorbell claim
  limen github resolve <root> <claim-id> <handoff-nonce> "answer"  # explicit no-job answer for one doorbell claim
  limen picture build [--dir D] [--out F] [--json F] [--strict]  # local offline architecture map, no model call
  limen picture tick [--dir D] [--branch B] [--dry-run] --engine E --provider P --model M --thinking T  # quiet one-tip pass
  limen picture watch [off | on [--branch B] [--dir D] --engine E --provider P --model M --thinking T]  # per-project, off by default: one tick when the top branch moves
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
		const flags = rest.slice(0, rest.includes("--") ? rest.indexOf("--") : undefined);
		if (flags.includes("--help") || flags.includes("-h")) {
			console.log(commandHelp(name));
			return;
		}
		await COMMANDS[name as keyof typeof COMMANDS](rest, cwd);
	} catch (error) {
		if (process.env.LIMEN_INTERNAL_RUN === "1" || process.env.LIMEN_INTERNAL_HOSTED === "1") await failInternalJob(error);
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}

// One command's usage: its `limen <command>` lines from HELP, with their indented comment lines.
function commandHelp(name: string): string {
	const lines = ["usage:"];
	let inside = false;
	for (const line of HELP.split("\n")) {
		if (line.startsWith("  limen ")) inside = line === `  limen ${name}` || line.startsWith(`  limen ${name} `);
		else if (!/^\s+#/.test(line)) inside = false;
		if (inside) lines.push(line);
	}
	return lines.join("\n");
}
