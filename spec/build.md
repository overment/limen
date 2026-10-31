# Build

## TRACK

- **Coordinator session (F958, F959, Adam 2026-10-30):** a coordinator session is a Pi session with `LIMEN_COORDINATOR=1` and the Limen hooks; a Herdr pane is one way to reach it, not a second harness. The switch alone decides who counts as a coordinator; a Herdr pane alone is not enough (Adam 2026-10-30). No Limen code, doc or message names the app that hosts a session. No mode registry, no second wake for one event, no new gate. Leave `limen github connect` and the GitHub doorbell alone.
- **Idle coordinator lag (F944, Adam 2026-10-25):** slice 1 landed in `74c8596` after the Pi `openai-codex/gpt-6.1-sol` review PASS at `5246ca5`: a finished job that owes a coordinator nothing stays settled, a rolling 30 s refresh replaces the full reopen, and a busy job's watch events start at most one wake sweep a second. All five acceptance lines are proven; the gone-pid check already held since `645ab02`. The ticket stays open because the `finishedJobs` job-line pass still reads every record every 30 s with a synchronous `git` call, and the session-start sweep still reads every record once.
- **Assessment handoff (F954, Adam 2026-10-24 20:44 Warsaw):** Johnny owns the one POST of the merged proposed record under the prior YES; this coordinator must not POST, review the assessment further or start more F954 rounds, and stays on F955.
- **Full final messages (F955, failed exact-tip proof):** priority 1; Pi `pi-claude/claude-opus-5-5` xhigh repairs UTF-8 report decoding and separates rule-fixture phases, without a production rule change, 200m; keep the 1 MiB Herdr limit; require Pi `openai-codex/gpt-6.1-sol` xhigh PASS and full native/live Herdr/wait-and-every-job-end proof at the same exact tip before landing and pushing main with a `[skip ci]` tip.
- **Open-note evidence repair (F953, Adam decision 115, 2026-10-24):** repair 4 landed as it is with review 4's quoted-source edge case accepted in the done ticket Notes; no further strict-command-proof reviews or follow-up ticket; full-message work remains separate.
- **Task-note implementation (F950, Adam 2026-10-23 16:03):** implement the approved `group/prompt.txt` as written with one Pi `pi-claude/claude-opus-5-5` worker at `xhigh`, then an independent Pi `openai-codex/gpt-6.1-sol` review at `xhigh`, then land on main and push using local evidence only; no GitHub Actions, no repair or masking of the old wake and structure-scan failures.
- **Pi/OMP engines (Adam 2026-09-22):** one flag, one profile table, one wrapper, one unchanged parser; separate auth stores and same-engine continuation. This VPS plant coordinator owns the board and authorized main landings/pushes; Adam retains review ownership, with no independent reviewer. Live hosted OMP proof, doorbell, unusable-route, and restoring Claude were outside the engine slice.
- **Standing engine (Adam 2026-10-23):** new jobs default to Pi at runtime; `--engine` overrides `LIMEN_ENGINE`. Use `--engine omp` or `LIMEN_ENGINE=omp` when OMP is required; continuation keeps the recorded engine, and old records without one remain Pi. This replaces the 2026-09-23 OMP default.
- **Standing models (Adam):** ordinary work, coordination, research, and quality use `openai-codex/gpt-6.1-sol` on Pi (`--engine pi --provider openai-codex --model gpt-6.1-sol`); simple / cheap tasks and UI-related work use `pi-claude/claude-opus-5-5` on Pi (`--engine pi --provider pi-claude --model claude-opus-5-5`: Claude Max through Pi's Claude Code bridge; never `anthropic/`). On OMP the Opus route is `--engine omp --provider pi-claude --model pi-claude/claude-opus-5-5`. Pass engine/provider/model/reasoning explicitly; this supersedes the earlier GPT-6-Sol and Grok model choices.
- **Scout model (Adam 2026-10-10):** `pi-claude/claude-haiku-5-5` stays on OMP (`--engine omp`) at `medium` (`--role scout --detached`), where the Haiku helper pilot (F936) proved it, and runs the read-only scout before a spawn. Never for edits, landing, review of record, group hypotheses, synthesis, or owner-facing text.
- **Ops remediation lock 2026-09-10 (Adam):** two unsuccessful automatic wake attempts then deliberate recovery; park-and-preserve on quota — no silent model substitution. Named-job `limen watch <id>` for takeovers — not `watch --running`.
- **Finish proof (Adam):** HTTP ≠ bot turn. VPS-first, Johnny-only automatic finish proof is sufficient; an export hold is unobserved evidence, never absence of an actual turn; no Tony coordination.
- **Review and reasoning (Adam):** Adam reviews; no independent reviewer unless asked. Retain `xhigh` for coordination/research/quality and `high` for ordinary jobs. Research uses the research model above for both independent opinions; judge and picture use the ordinary model.
- **Collaborative groups (Adam 2026-09-29):** spec review by `pi-claude/claude-opus-5-5` on Pi at `xhigh` before implementation; ordinary model for implementation and one two-team live proof; commit and push only after native checks and observed collaboration pass, preserving work on quota failure.
- **Group boundary:** opt-in per feature, one owner-facing lead and landing owner, fixed team/total-worker allowances, separate candidate branches and informational peer messages; no recursive coordinators, cross-seat routing, automatic merge, or unrelated plant changes.
- **Group recovery:** bounded event waits and deadlines, no coordinator continuation or automatic roster repair, and stop preserves recovery work until explicit close.
- Reliable in-flight control on one seat; a laptop is a window; the GitHub App rings Alice's registered coordinator, and one repository on one seat is enough (Adam 2026-10-03).
- Settled Herdr panes keep RUNNING jobs and stall warnings visible; external finish delivery remains per-project opt-in.
- Coordinator CPU is repaired without deleting history; job-history retention remains a separate operator decision.
- **Ops wave (Adam 2026-09-27, Johnny coordinating), in this order:** plate as inbox (F738) and doorbell dedupe on job + final state (F739) in parallel; then owner + land policy on the job with a non-blocking end-of-job spec nudge; then OMP finish wakes with `limen wait` refused under `LIMEN_COORDINATOR=1`; then quiet liveness. OMP only, never pi-claude; land each slice onto `main` when done, no extra review; never edit Alice `alice/` or `api/`.
- **Ergonomics wave (Adam 2026-10-02):** implement policy-accurate setup examples and naming, unique feature identities, root-aware Herdr role spaces, and subject-first status; finish existing reliability slices without rebuilding landed wakes or touching group branches.
- **Ergonomics boundary:** preserve the vision and owner review policy; no global Pi/OMP/Herdr configuration changes, external-service operations, or unrelated plant edits; context deduplication is explanation only.
- **Feature identity:** the parked application field-guide proposal is F743 (formerly misfiled as F050; see its former-address.md); F050 is the landed diff viewer.
- **Scope lock (Adam 2026-10-03), in this order; land each slice on `main` when green:** status names (F746); setup text (F747); map wording (F748); finish guide (F749); OMP wake proof (F741) and a reproduction of the hosted OMP fallback gap before any recovery change (F728); Limen and Alice map touch lines (F750). Then release collaborative groups (F740) without shrinking the trial.
- **Finish wording (Adam 2026-10-03):** a done job says it is done and names the next step; never "merge not ready" when landing is the only step left. Landed before groups.
- **First map (Adam 2026-10-03):** start the first picture job interactive (`--tab`); `--detached` only when the interactive start fails.
- **Scope lock boundary:** no second-seat GitHub proof, no new Sol model policy, no Changes-list highlight on the map.

## NOW

<!-- Generated from spec/features/active/ by limen land, limen ticket done and limen board --write. Edit the tickets, not these lines. -->

- `F957-first-principles-cut-of-limen-architecture-new-graph-marks-unvaluable-parts` (🟠 ACTIVE): First-principles cut of Limen architecture; the original graph marks unvaluable parts
- `F954-a-private-assessment-combines-verified-collaboration-counts-from-both-session-stores` (🟠 ACTIVE): A private assessment combines verified collaboration counts from both session stores
- `F952-agents-learn-adam-s-principles-from-work-and-decisions` (🟠 ACTIVE): Agents learn Adam’s principles from work and decisions; needs Adam since 2026-10-25: Answer choices 1 to 4 at the end of ~/Downloads/limen-learning-system.html (revision 3) before a pilot; no implementation or pilot is authorized.
- `F936-haiku-helpers-do-the-narrow-chores-for-coordinators-workers-and-groups` (🟠 ACTIVE): Haiku helpers do the narrow chores for coordinators, workers and groups
- `F778-coordinator-and-lead-finish-signal` (🟠 ACTIVE): The shepherd learns when coordinators and group leads finish, block or stall
- `F777-hosted-pane-shows-true-agent-state` (🟠 ACTIVE): A hosted job's Herdr tab shows the agent's true state; wrong since 2026-10-05: Hosted panes show green while the agent is visibly working.
- `F774-picture-endgoal-layout` (🟠 ACTIVE): Adam can click the target picture dashboard as one polished end-goal HTML
- `F766-remote-agent-setup-guide` (🟠 ACTIVE): An agent can set up a Limen seat, GitHub App, and integrations from one short document
- `F765-picture-ui-style` (🟠 ACTIVE): The picture has one visual language that is minimal and appealing
- `F764-picture-log-methods` (🟠 ACTIVE): Proven methods make picture logs clearer and stay simple
- `F763-picture-log-clarity` (🟠 ACTIVE): Picture logs that a person can skim and an agent can read cheaply
- `F759-graph-shows-what-to-decide` (🟠 ACTIVE): The graph shows only what the owner must decide, under high change volume; needs Adam since 2026-10-04: Count each place's code changes when the map refreshes, or read them from Git at every build?
- `F729-continuation-publication` (🟠 ACTIVE): Continuation survives concurrent pruning

## NEXT

- `F958-seat-wide-rules-reach-every-coordinator-session` (🔴 PLANNED): seat-wide rule pings reach each coordinator session; a person proves the session wake first.
- `F959-docs-and-messages-describe-a-coordinator-as-a-session` (🔴 PLANNED): docs and messages describe a coordinator as a session, with Herdr as one way to reach it.

## PARKED

- `F081-spawn-refuses-an-unusable-route` (🔴 PLANNED): still waiting for a Pi-supported non-generating route probe. Rechecked installed Pi 0.84.2 on 2026-09-19: `auth check` still proves credentials only; model runtime has stream/complete, no exact-route validation. Failing candidate `b14b5fe` stays locked; no auth/catalog substitution. Hosted continuation file transport already landed.

## DROPPED

- `F724-handoff-policy-has-one-home` (⚪ DROPPED): speech register already has no second handoff length or constraint rule; shop manual owns the full handoff. No code change.
- `F046-optional-speech-command` (⚪ DROPPED): optional `/speak` shipped, then removed at owner request. Removal `d45fed2`.

## PROVEN

<!-- Generated from spec/features/done/ by limen land, limen ticket done and limen board --write. Edit the tickets, not these lines. -->

- `F960-plants-that-share-a-ticket-number-series-never-hand-out-the-same-number-and-an-archived-number-never-comes-back` (🟢 PROVEN): Plants that share a ticket-number series never hand out the same number, and an archived number never comes back; landed 2026-10-31
- `F956-one-switch-marks-what-limen-added-in-herdr-and-on-the-map` (🟢 PROVEN): One switch marks what Limen added in Herdr and on the map; landed 2026-10-25
- `F955-coordinators-receive-every-agent-s-full-final-message` (🟢 PROVEN): Coordinators receive every agent’s full final message; landed 2026-10-25
- `F953-a-done-job-with-open-note-checks-tells-the-coordinator-and-is-not-a-plain-done` (🟢 PROVEN): A done job with open note checks tells the coordinator and is not a plain done; landed 2026-10-24
- `F951-limen-starts-queued-jobs-by-priority-and-tells-every-coordinator-each-rule` (🟢 PROVEN): Limen starts queued jobs by priority and tells every coordinator each rule; landed 2026-10-23
- `F950-task-notes-state-the-end-checks-and-the-rule-most-likely-to-be-missed` (🟢 PROVEN): Task notes state the end checks and the rule most likely to be missed; landed 2026-10-23
- `F949-a-limen-job-can-run-as-a-devin-cloud-session-and-return-its-commits` (🟢 PROVEN): A limen job can run as a Devin cloud session and return its commits; landed 2026-10-20
- `F948-every-agent-knows-it-works-inside-a-highly-capable-agent-system` (🟢 PROVEN): Every agent knows it works inside a highly capable agent system; landed 2026-10-17
- `F947-a-coordinator-s-end-of-turn-always-sends-one-ping` (🟢 PROVEN): A coordinator's end of turn always sends one ping; landed 2026-10-17
- `F946-a-finish-stall-or-ask-ping-is-never-lost-under-load` (🟢 PROVEN): A finish, stall or Ask ping is never lost under load; landed 2026-10-16
- 2026-10: 59 landed. spec/features/done/2026-10/
- 2026-09: 70 landed. spec/features/done/2026-09/
- 2026-08: 43 landed. spec/features/done/2026-08/
