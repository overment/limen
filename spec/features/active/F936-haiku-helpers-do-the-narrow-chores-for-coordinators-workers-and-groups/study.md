# Study: where Claude Haiku 5.5 fits in Limen

Study date 2026-10-10, at commit `f99ddac`. Sources: `templates/agents.md`, `templates/coordinator.md`, `templates/group-member.md`, `templates/judge.md`, `templates/keeper.md`, `templates/worker.md`, `templates/reviewer.md`, `docs/groups.md`, `src/runtime/engine.ts`, `src/runtime/stream.ts`, `src/job/wake-text.ts`, `src/project/picture-tick.ts`, `spec/build.md`. The probes ran on Adam's Mac, in `/tmp/haiku-probe`.

## Verdict

Use Haiku 5.5 only as a read-only helper. A helper collects evidence and hands it to the Opus or Sol lead. The lead decides and makes the change. Haiku must not decide what lands, write Adam's reports, or make the hard edit.

Haiku 5.5 does not run through the installed bridge today. `--model pi-claude/claude-haiku-5-5` exits 0, but it runs Haiku 4.5 and gives no warning. The Max plan does serve Haiku 5.5. A bridge copy with one more catalog entry ran Haiku 5.5 and made a correct read-only tool call. The fix is one catalog entry in the local OMP bridge port.

On the Max plan, a bridge call costs subscription quota, not money: OMP records `cost: 0` for every `pi-claude` turn. A helper saves only when the lead does less work. The pilot must count lead turns, tokens and wall time. The article's prices are only a reference.

## Findings

### 1. The installed bridge runs Haiku 4.5 when Haiku 5.5 is requested

- `omp models pi-claude --no-extensions -e ~/.omp/local/pi-claude-bridge` lists 18 models. `claude-haiku-4-5` is in the list and `claude-haiku-5-5` is not. The bridge registers `buildModels(getModels("anthropic"))` (`src/index.ts:145` in the bridge), which is the Anthropic catalog bundled with OMP 18.4.4. That catalog does not include Haiku 5.5.
- `omp --no-extensions --extension ~/.omp/local/pi-claude-bridge --model pi-claude/claude-haiku-5-5 --mode json -p "Reply with exactly: ok"` exited 0 and replied `ok`. The OMP message records `model: claude-haiku-4-5`. The Claude Code transcript (`~/.claude/projects/-private-tmp-haiku-probe/97a9ad03-….jsonl`) records `message.model: claude-haiku-4-5-20251001`. OMP matched the unknown id to the closest known id.
- This conflicts with the board rule "no silent model substitution". A Limen job started with that flag would run the old model and record `done`.

### 2. The Max plan serves Haiku 5.5, and the bridge works once it has the catalog entry

- `claude auth status`: `authMethod: claude.ai`, `subscriptionType: max`, and `ANTHROPIC_API_KEY` is not set. `claude -p --model claude-haiku-5-5 --output-format json "Reply with exactly: ok"` replied `ok`. Its `modelUsage` key and its transcript `message.model` are both `claude-haiku-5-5`.
- A throwaway copy of the bridge in `/tmp/haiku-probe/bridge` got one more catalog entry: the Haiku 4.5 entry copied with id `claude-haiku-5-5`. The installed bridge did not change. Through that copy:
  - `-p "Reply with exactly: ok"`: the reply was `ok`, and the transcript `message.model` was `claude-haiku-5-5`.
  - `--tools read,grep --thinking low`, with a request to read `/tmp/haiku-probe/fact.txt` and give the value of `secret_marker` and its line: Haiku made one `read` tool call and replied `violet-42, line 2`, which is correct. The transcript `message.model` was `claude-haiku-5-5`.
- Every bridge call has a fixed prompt cost. The first call wrote 15,262 tokens to the cache, and the tool run used 10,160 cache-read and 10,313 cache-write tokens. A very small chore still costs about 10 to 15 thousand prompt tokens. Combine small chores in one helper job.
- The copied entry gives Haiku 5.5 the Haiku 4.5 limits (200K context, 64K output). That is enough for a helper, because a helper input stays below 100K tokens. The bridge requests the bare 200K id for every model that is not measured (`MEASURED_ONE_M` in the bridge `src/models.ts`).

### 3. Pi has no Haiku 5.5 route for Limen jobs

- Pi 1.0.0 has a separate package, `@vanillagreen/pi-claude-bridge` 4.0.8, in `~/.pi/agent/settings.json` `packages`. Its `pi-claude` provider lists `claude-haiku-4-5` and does not list `claude-haiku-5-5`.
- Limen starts every job with `--no-extensions`. It adds the bridge only for OMP when the model starts with `pi-claude/` (`src/runtime/engine.ts:224`). `pi --no-extensions --list-models pi-claude` lists nothing. A Pi job can reach that package only through an explicit `--extension` path, which is a personal route.
- Pi's `anthropic` provider lists `claude-haiku-5-5`. That provider is the separate, rate-limited account, so Limen must not use it.
- Each job chooses its own engine. A Pi coordinator can spawn an OMP helper job, so helpers do not need Pi support.
- No Pi Claude call was made in this study.

### 4. Usage is already in every job's transcript, but no Limen view shows it

- Every assistant message in `.limen/jobs/<id>/session/*.jsonl` records `provider`, `model` and `usage` (`input`, `output`, `cacheRead`, `cacheWrite`). The stream parser in `src/runtime/stream.ts` drops those fields. `limen jobs` shows no tokens.
- The requested model goes to the wrapper only through `LIMEN_MODEL` (`src/commands/spawn.ts:507`). The job record has no file for it, so Limen cannot compare the requested model with the served model.
- The lead's cost is mostly cache reads, which grow with turns times context size. Two real jobs, counted with the snippet in `pilot.md`:

| Job | Model | Wall time | Turns | Output | Cache read |
|---|---|---|---|---|---|
| quiet-mark option B (F933) | Opus 5.5 | 279 s | 40 | 12,378 | 2,020,283 |
| live records panel (F934) | Opus 5.5 | 1,720 s | 164 | 103,937 | 27,344,948 |

A helper saves only when its packet removes lead turns. Ten fewer exploration turns at 150K context remove about 1.5M cache-read tokens.

### 5. Limen already has places for helpers

- **Completion wake.** A job's final message reaches the coordinator in the wake, cut to 15 lines and 1,200 characters (`handoffExcerpt` in `src/job/wake-text.ts`). A packet of 15 lines or fewer reaches the lead whole, with no extra read.
- **Built-in subagents in OMP.** OMP has `task.agentModelOverrides`, which sets the model for each built-in subagent (shown by `omp config list`). Limen already passes a per-job `--config` overlay to OMP (`prepareSkillConfig`, `src/runtime/engine.ts:134`). Today Limen writes that overlay only when the job has legacy skills. The overlay could route a worker's built-in `scout` to Haiku. Two conditions apply. First, the job must load the bridge, but Limen loads it only when the job's own model is `pi-claude/…`, so a Sol worker would not have it. Second, without the bridge, OMP's matching could pick `anthropic/claude-haiku-5-5`, which is the excluded account. The second condition was not tested.
- **Groups do not allow helpers today.** `group-member.md`: "Workers cannot launch jobs or built-in helper agents." `coordinator.md`: "There is no … helper-agent launch". `docs/groups.md`: "Built-in helper agents do not bypass the allowance." A group helper must therefore be a counted `limen spawn` from the team coordinator, or a lead-side job outside the roster. Any other route is a rule change, and only Adam can make it.
- **Board.** `spec/build.md` TRACK "Standing models" names Sol for ordinary work and Opus 5.5 for simple, cheap and UI work. Adam must approve before Haiku goes into that line.

## Model recommendation for each Limen step

Normal mode: the plant coordinator, its workers, and its reviewers.

| Step | Model | Why |
|---|---|---|
| Choose work, reconcile the board, talk to Adam | Lead | Priority and product judgment. The human register is easy to get wrong. |
| Write a ticket or a board line | Lead | A ticket is product judgment, and a board line is one clause. Checking a draft costs about as much as writing it. |
| Scout the repository before a spawn | **Haiku** | Read-only, with a clear end: the seam file and symbol, the tests that cover it and what they miss, and the unknowns. The coordinator puts the seam in the handoff as a lead, not as a map. |
| Implement a slice or repair | Lead | This is the hard change. |
| Scout inside a worker's turn (OMP built-in `scout`) | **Haiku, after the pilot** | This is the cheapest path, through OMP's per-subagent setting. It needs the bridge in every helper-using job and protection against matching to `anthropic/`. |
| Triage a failing test or log | **Haiku** | First failing assertion, the related test, and the code path. It separates the first failure from follow-on failures and from known unstable tests, in eight lines or fewer. Limen has known unstable timing tests (F740, F728, F760 outcomes). |
| Triage a failed or stopped job | **Haiku** | It reads the stop reason, the log tail, the last tool and the worktree status. It says whether edits reached the seam. The lead decides to resume, steer or stop. |
| Summarize a job that finished `done` | Lead | The worker's final message is already the summary, and the wake carries it. Another layer adds a hop and nothing else. |
| Inspect a candidate and decide to land | Lead | Landing is the expensive decision. |
| Review pre-pass | **Haiku, checklist only** | It maps each acceptance line to a diff hunk and to a check with real output, and it lists the lines with no evidence. It can add questions but cannot clear anything. The reviewer of record stays Opus or Sol. |
| Review of record | Lead | Blast-radius work: process control, wakes and notification routing. |
| Locate merge conflicts | Haiku, low priority | It lists the conflicting hunks and the intent of each side from commit messages. The lead resolves. Conflicts are rare because worktrees isolate the work. |
| Triage stale jobs and worktrees | No model | `limen status`, `limen jobs` and `limen prune --dry-run` already answer this without a model. |
| Digest finish pings for a wave | Haiku as a fact table only | One row per job: state, commits, the checks named, the failures. The lead writes the report to Adam. |
| Spec keeper | Lead for now | It commits on the landing branch. The strict check does not check the board line. A later pilot can try it. |
| Refresh the picture | Lead | The picture is held to the human register, and the tick already filters by cited files. |
| Research reports and the judge | Lead | The value is in independent opinions and in the divergence between them. |
| Quality pass | Lead | Judgment against the vision and the styleguide. |
| `ticket check`, `picture build`, tests | No model | These are deterministic. |

Group mode: the lead pane, team coordinators, workers, the cabinet, the judge and the keeper.

| Step | Model | Why |
|---|---|---|
| Lead: brief, team notes, synthesis, landing | Lead | The lead is the only landing owner, and synthesis is judgment. |
| Team coordinator: initial hypothesis | Lead | The independence of each approach is the reason groups exist. A cheap hypothesis anchors the team. |
| Team scout before workers start | **Haiku** | It runs after the team coordinator publishes the hypothesis. Each team has its own scout, and its input is that team's approach note. The packet seeds that team's worker handoffs. Scouts are never shared across teams. Today a scout uses a launch slot. |
| Team workers | Lead | This is the hard change. |
| Respond to peer findings | Lead | The contract asks for "a check, not agreement by default". |
| Cabinet digest for the lead | **Haiku** | A lead-side helper reads `limen group status <id> --json` and the publications. It writes one row per claim: team, claim, commit or artifact link, check run (yes or no), uncertainty, and conflicts with other teams. The digest must not rank teams or pick a winner. Group messages carry at most eight events and 8,000 characters, so four teams produce much reading. |
| Compare candidates | **Haiku** | A table with one row per team: SHA, files changed, checks named with output, and the acceptance lines covered, taken from Git and final messages. The lead chooses. |
| Judge pre-filter (research) | **Haiku, evidence check only** | For each report, it lists the claims that have no fetched source. The judge still names where the reports diverged. |
| Judge | Lead | Divergence is the deliverable. |
| Keeper spec-diff summary | No | The keeper already reads only the spec diff, and its job is short. |

### Top five places

1. Repository scout before a spawn. A team scout before workers start is the same chore.
2. Triage of failing tests, logs and failed jobs.
3. Cabinet digest and candidate comparison table for a group lead.
4. Review and judge pre-pass that checks evidence completeness only.
5. A worker's built-in OMP `scout`, routed to Haiku, after the pilot proves items 1 and 2.

### Where Haiku hurts quality

- Initial hypotheses in groups, synthesis, choosing a candidate, and naming where reports diverged.
- Any decision to land, any review of record, and any change in blast-radius areas.
- Text that Adam reads. The human register needs judgment about what the reader already knows.
- Commits on the landing path: implementation, keeper, picture.

## Evidence packet format

The helper's final message, 15 lines or fewer, so that the completion wake carries it whole:

```
Packet: <the question, one line>
Base: <commit>
1. <path>:<line or symbol> — <why it matters> — observed|guessed
2. … (at most 5)
Checks: <existing test or command> covers <what>; misses <what>
Unknowns: <what the helper could not settle>
Verified: <command or read that reaches the behavior> -> <real output line> | none
```

Failure triage uses the same header and at most 8 body lines:

```
First failure: <test file> › <test name> — <assertion line, verbatim>
Code path: <path>:<symbol>
Follow-on: <failures caused by the first> | none
Independent: <other failures and their first lines> | none
Known unstable: <test, with the outcome or board line that names it> | none
Command: <exact command>; exit <code>
```

## Verification rule

- "Observed" means the helper read that line at `Base`. "Guessed" means the helper inferred it. A finding with no label counts as guessed.
- A packet without a real `Verified:` line is unverified, and the lead treats every finding in it as guessed. `Verified: none` is allowed, but the helper must write it.
- Before the lead acts on a packet, it reads the top finding once. A wrong top finding is a pilot failure for that run.
- Run the helper with `--thinking medium` or higher. The article reports that Haiku at low or medium effort sometimes says "done" without a check. The `Verified:` line makes a missing check visible.

## What Limen must add

In order of dependency:

1. **Bridge catalog entry.** Add `claude-haiku-5-5` in the local OMP port (`~/.omp/local/pi-claude-bridge`, branch `omp`), as the bridge update (F771) did. This is outside the Limen repository. When an OMP update ships the model in its catalog, remove the entry.
2. **Served-model check.** Record the requested model in the job record. `limen jobs <id>` compares it with the model of the first assistant message in the session and shows both when they are different. This informs and does not block.
3. **Usage line.** `limen jobs <id>` shows turns and the input, output, cache-read and cache-write totals, read from the session files. No new state file.
4. **Scout role.** Add `templates/scout.md` with the packet, the triage format and the verification rule. It runs `--detached`, with a short timeout, no edits and no commits. The model comes from the board and is passed explicitly. Do not add a package default model.
5. **Group helpers**, only after the pilot and Adam's answer. A team scout spawned by the team coordinator uses one launch slot. The cabinet digest and the candidate table are ordinary lead-side helper jobs. Changing the "no helper agents" lines in `group-member.md` and `coordinator.md` is part of this step.
6. **Worker-internal scout**, only after the pilot. Load the bridge when any helper route names `pi-claude/`. Write `task.agentModelOverrides` in the per-job overlay.

The pilot in `pilot.md` needs only items 1 and 4. Item 4 can be a task file that carries the packet rules, so no Limen code is needed to start the pilot.

## Risks

- **Silent substitution.** This was proven above. Until item 2 lands, check the helper transcript's `message.model` after each pilot run.
- **A wrong seam sends the worker the wrong way.** Mitigations: observed or guessed labels, the lead reads the top finding, and the handoff gives the seam as a lead.
- **A false "done" or "no issue".** A pre-pass can only add questions. It never clears an acceptance line.
- **Fewer different approaches in a group.** Each team has its own scout, and the scout runs after the team's initial hypothesis.
- **Allowance pressure.** A team scout uses a slot that a worker could use. This needs Adam's decision.
- **Quota.** Helpers and Opus use the same Max plan. The study did not check whether Haiku uses the Opus limit.
- **Overhead.** Each helper job adds a worktree, a cold start, about 10 to 15 thousand fixed prompt tokens, and a wake round trip. On small slices, lead-only can be faster. The pilot measures this.
- **Bridge upkeep.** A local catalog entry can go out of date when OMP updates. Repeat the probe after each OMP update.
