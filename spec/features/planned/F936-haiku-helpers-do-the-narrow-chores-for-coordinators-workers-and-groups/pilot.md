# Pilot: lead-only compared with Haiku-scout-first

The pilot decides which helper chores to keep. It replays five past Limen tasks whose correct answer is known, each one run two ways:

- **Lead-only:** one lead job with the usual handoff.
- **Scout-first:** a Haiku helper job first, then one lead job with the same handoff plus the helper's packet.

The study (`study.md`) gives the packet format and the verification rule.

## Before the pilot

- Adam approves the pilot. This is the `needs-adam` line in `ticket.md`.
- The local OMP bridge has the `claude-haiku-5-5` catalog entry, and the acceptance probe in `ticket.md` shows `message.model: claude-haiku-5-5`. Without the entry, the helper runs Haiku 4.5 and the pilot measures the wrong model.
- After every helper run, check the served model in the helper session. Every assistant `model` must be `claude-haiku-5-5`. Until Limen shows the served model, do this check by hand.

## Fixed settings

| Setting | Value |
|---|---|
| Lead | `--engine omp --provider openai-codex --model gpt-6.1-sol --thinking high` (the board's ordinary choice). If Adam picks Opus, use Opus in both arms. |
| Helper | `--engine omp --model pi-claude/claude-haiku-5-5 --thinking medium --detached --timeout 15m` |
| Repository | One disposable clone for each task and arm, with history only up to the base commit. Future commits must not be in the clone, so that `git log --all` cannot show the answer. |
| Handoff | Identical in both arms, written before the helper runs. Scout-first adds one line, `Helper packet (leads, not facts):`, followed by the packet text. |
| Mode | `--detached` for every job, so each job has a timeout, a tool-call cap and a JSON transcript. |

Make the clone for one task and one arm:

```sh
git -C /Users/overment/.overment/limen branch pilot-base-F770 ea38ca4
git clone --no-local --single-branch --branch pilot-base-F770 /Users/overment/.overment/limen /tmp/f936-pilot/F770-lead
git -C /Users/overment/.overment/limen branch -D pilot-base-F770
```

Before the first run, confirm that `limen spawn` works in a clone like this one. If it does not, record the problem and stop. Do not run the pilot in the main checkout.

The helper task is the scout rules from `study.md` (the packet format, the 15-line limit, the verification rule, and the instruction to edit nothing and commit nothing) plus the question for that task.

## Tasks

| # | Task | Base | Chore | Oracle (the check that proves success) |
|---|---|---|---|---|
| 1 | A warm OMP coordinator counts as live for the doorbell (F770) | `ea38ca4`. The ticket text comes from `abf1e84:spec/features/active/F770-omp-coordinator-counts-as-live/ticket.md` and is passed with `--task-file`. | Scout before the spawn. The ticket already names the seam, so this task tests whether a scout adds anything when the seam is known. | Copy `test/github-doctor.test.ts` and `test/github-doorbell.test.ts` from `abf1e84` onto the candidate tip. Both must pass. |
| 2 | A hosted OMP job stays live when Herdr loses its agent row (F728) | `7cbce5c`. At this commit the reproduction test in `test/recovery.test.ts` fails. Ticket: `spec/features/active/F728-hosted-engine-liveness/ticket.md`. | Failure triage. The helper runs the failing test and writes the triage packet. The lead fixes the bug. | `test/recovery.test.ts` and `test/hosted-spawn.test.ts` from `88fd5ac` pass on the tip. Known answer: recovery accepted only a `pi` or `node` process. |
| 3 | The quiet mark waits longer during tests (F933) | `859ec6b`. Ticket: `spec/features/planned/F933-quiet-mark-waits-longer-during-tests/ticket.md`. The handoff says "Adam picked option B." | Scout before the spawn, on a small slice. | `test/u11-live-activity.test.ts` from `f7ad9fa` passes on the tip. |
| 4 | An issue comment rings the doorbell (F760) | `a4d9700`. Ticket: `spec/features/active/F760-issue-comment-rings-doorbell/ticket.md`. | Scout before the spawn, on a larger slice that can reuse the pull-request comment path. | `test/github-doorbell.test.ts` from `086aeb9` passes on the tip. |
| 5 | First review of the plant-skills candidate (F737) | Candidate `2554043`, parent `59578e9`. Ticket: `spec/features/active/F737-worker-skills-visible/ticket.md`. | Review pre-pass. The helper maps each acceptance line to the evidence for it. The lead is a `--review` job. | The verdict is `FAIL`, and it names the native-precedence collision from `spec/features/done/2026-09/F737-worker-skills-visible/review-1.md`: a legacy `.pi/skills` entry hides an `.omp/skills` entry with the same name. |

Run tasks 1 and 3 first, because they are the smallest. If both arms fail the oracle on the same task, the task is too hard for this lead setting. Record the failure and do not count the task.

## Measures, for each run

| Measure | Source |
|---|---|
| Oracle passed (yes or no) | The oracle command and its real output. |
| Wall time of the helper, the lead, and the total | `started-at` and `finished-at` in each job record. Record the gap between the helper's finish and the lead's start separately. |
| Lead turns and tokens (input, output, cache read, cache write) | The snippet below, run on the lead job. |
| Helper turns and tokens | The snippet below, run on the helper job. |
| Served model of the helper | The `model` column of the snippet. It must be `pi-claude/claude-haiku-5-5`. Also check the Claude Code transcript `message.model`. |
| Wrong findings | Packet findings whose path or symbol is not in the base, or whose claim is false when read. Mark whether the top finding was wrong. |
| `Verified:` line present and real | Yes, none, or false. False means the line claims a command or output that the helper transcript does not show. |
| Retries | Steers, continuations and respawns needed to reach the oracle. |
| Manual fixes | Coordinator edits made after the lead finished, so that the oracle passes. |
| Money equivalent (reference only) | Tokens times the published per-token rates on the pilot day. OMP records `cost: 0` for `pi-claude` turns, because they use the subscription. |

The usage snippet. It was tested on two real job records during the study:

```sh
node -e '
const fs = require("fs"), path = require("path");
for (const dir of process.argv.slice(1)) {
	const t = { turns: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, models = new Set();
	const session = path.join(dir, "session");
	for (const file of fs.readdirSync(session).filter((n) => n.endsWith(".jsonl"))) {
		for (const line of fs.readFileSync(path.join(session, file), "utf8").split("\n")) {
			let o;
			try { o = JSON.parse(line); } catch { continue; }
			const m = o.type === "message" && o.message;
			if (!m || m.role !== "assistant") continue;
			t.turns += 1;
			models.add(`${m.provider}/${m.model}`);
			for (const k of ["input", "output", "cacheRead", "cacheWrite"]) t[k] += m.usage?.[k] ?? 0;
		}
	}
	const read = (f) => { try { return fs.readFileSync(path.join(dir, f), "utf8").trim(); } catch { return ""; } };
	const seconds = Math.round((Date.parse(read("finished-at")) - Date.parse(read("started-at"))) / 1000);
	console.log([path.basename(dir), [...models].join("+"), seconds, t.turns, t.input, t.output, t.cacheRead, t.cacheWrite].join("\t"));
}' <clone>/.limen/jobs/<job-id> ...
```

The columns are: job, model, seconds, turns, input, output, cache read, cache write.

## Decision rule

Make one decision for each chore: the scout before a spawn (tasks 1, 3 and 4), triage (task 2), and the review pre-pass (task 5).

- **Keep** the chore when all of these are true for its tasks:
  - Scout-first passes the oracle at least as often as lead-only.
  - No wrong top finding caused a retry.
  - Total wall time is lower, or lead tokens are lower by at least 20 %, on most of the chore's tasks.
- **Drop** the chore when scout-first fails an oracle that lead-only passed, or when a false `Verified:` line reaches the lead.
- **Tie:** a difference of less than 20 % is noise. One run per arm is a pilot, not proof. When the result is a tie, run the tie tasks again with the same settings before deciding.

The pilot does not test the group helpers (team scout, cabinet digest, candidate table). Test them in one real group only after this pilot keeps the scout chore and Adam has answered the allowance question.

## Results

The results are not recorded yet. Add one row for each run:

| Task | Arm | Oracle | Helper s | Lead s | Total s | Lead turns | Lead tokens (in/out/read/write) | Helper tokens | Wrong findings (top?) | Verified | Retries | Manual fixes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
