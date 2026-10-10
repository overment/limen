# Build

## TRACK

- **Pi/OMP engines (Adam 2026-09-22):** one flag, one profile table, one wrapper, one unchanged parser; separate auth stores and same-engine continuation. This VPS plant coordinator owns the board and authorized main landings/pushes; Adam retains review ownership, with no independent reviewer. Live hosted OMP proof, doorbell, unusable-route, and restoring Claude were outside the engine slice.
- **Standing engine (Adam 2026-09-23):** new jobs default to OMP at runtime; `--engine` overrides `LIMEN_ENGINE`. Use `--engine pi` or `LIMEN_ENGINE=pi` only when Pi is required; continuation keeps the recorded engine, and old records without one remain Pi.
- **Standing models (Adam):** ordinary work, coordination, research, and quality use `openai-codex/gpt-6.1-sol` on OMP; simple / cheap tasks and UI-related work use `anthropic/claude-opus-5-5` on OMP. Pass engine/provider/model/reasoning explicitly; this supersedes the earlier GPT-6-Sol and Grok model choices.
- **Scout model (Adam 2026-10-10):** `pi-claude/claude-haiku-5-5` on OMP at `medium` (`--role scout --detached`) runs the read-only scout before a spawn, kept on trial by the Haiku helper pilot (F936). Never for edits, landing, review of record, group hypotheses, synthesis, or owner-facing text.
- **Ops remediation lock 2026-09-10 (Adam):** two unsuccessful automatic wake attempts then deliberate recovery; park-and-preserve on quota — no silent model substitution. Named-job `limen watch <id>` for takeovers — not `watch --running`.
- **Finish proof (Adam):** HTTP ≠ bot turn. VPS-first, Johnny-only automatic finish proof is sufficient; an export hold is unobserved evidence, never absence of an actual turn; no Tony coordination.
- **Review and reasoning (Adam):** Adam reviews; no independent reviewer unless asked. Retain `xhigh` for coordination/research/quality and `high` for ordinary jobs. Research uses the research model above for both independent opinions; judge and picture use the ordinary model.
- **Collaborative groups (Adam 2026-09-29):** spec review by OMP `anthropic/claude-opus-5-5` at `xhigh` before implementation; ordinary model for implementation and one two-team live proof; commit and push only after native checks and observed collaboration pass, preserving work on quota failure.
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
- `F936-haiku-helpers-do-the-narrow-chores-for-coordinators-workers-and-groups` (🟠 ACTIVE): the Haiku steering page is filed (`haiku-steering.html`, `notes.md`): rule in `agents.md` prose, a scout role, a truthful completion wake, no automatic routing; waits for Adam to approve the pilot and pick the team-scout allowance.
- `F926-fleet-leads-start-reviews-wait-and-land-without-workarounds` (🟠 ACTIVE): a starting review lists as starting, `--head` takes a short SHA, a coordinator's wait names its command, and land merges beside another session's edits.
- `F925-test-reset-decision` (🟠 ACTIVE): Adam gets one verdict on resetting Limen's tests to the few seams that matter; read-only group, `test/` unchanged.
- `F783-spec-structure-and-keeper` (🟠 ACTIVE): agents get linked-ticket guidance and a spec keeper fixes ticket, board, and map links before landing.

- `F777-hosted-pane-shows-true-agent-state` (🟠 ACTIVE): hosted Pi/OMP panes load Herdr's own state extension so the tab icon shows working/blocked/idle truthfully instead of green while the agent works.
- `F775-picture-merge-broad-digdown` (🟠 ACTIVE): four-team group merges live picture broad atlas/overview with F774 dig-down clarity; deliverable one polished merged HTML at `/Users/overment/Downloads/limen-picture-merged.html`; all-Sol (Opus still rate-limited); vscreen-only preview; no land unless synthesis asks park vs land.

- `F774-picture-endgoal-layout` (🟠 ACTIVE): four-team group designs the target limen picture/dashboard layout from F768+F769 lessons; deliverable one polished endgoal HTML at `/Users/overment/Downloads/limen-picture-endgoal.html`; Sol-first (Opus rate-limited); no land unless synthesis asks park vs land.
- `F773-styleguide-quality-scan` (🟠 ACTIVE): four-team read-only group scans Limen against the styleguide, vision, and speech register; lead writes one ordered P0/P1/P2 spec list; anthropic/claude-opus-5-5 only; no code lands, no team branch lands.
- `F759-graph-shows-what-to-decide` (🟠 ACTIVE): four-team group keeps the graph, mixes in time, removes side panels, and shows only what the owner must decide under 200+ changes; no landing, no live map edits.
- `F757-feature-timeline` (🟠 ACTIVE): two-team group cuts the F756 panel to a timeline graph with detail one click away; screenshots justify each cut; no live map edits, no code landing.
- `F729-continuation-publication` (🟠 ACTIVE): publish continuation records safely against concurrent prune without adding workflow state.

## NEXT


## PARKED

- `F081-spawn-refuses-an-unusable-route` (🔴 PLANNED): still waiting for a Pi-supported non-generating route probe. Rechecked installed Pi 0.84.2 on 2026-09-19: `auth check` still proves credentials only; model runtime has stream/complete, no exact-route validation. Failing candidate `b14b5fe` stays locked; no auth/catalog substitution. Hosted continuation file transport already landed.

## DROPPED

- `F724-handoff-policy-has-one-home` (⚪ DROPPED): speech register already has no second handoff length or constraint rule; shop manual owns the full handoff. No code change.
- `F046-optional-speech-command` (⚪ DROPPED): optional `/speak` shipped, then removed at owner request. Removal `d45fed2`.

## PROVEN

- `F935-a-real-group-shows-as-one-tree-on-the-live-picture` (🟢 PROVEN): a real 2×2 `limen group` shows as one tree with counts matching `group status`; a group worker counts on its group's feature, the lead line shows time left, the strip fits nine lines. Code `6287b2f`; u11 6/6.
- `F934-live-records-panel` (🟢 PROVEN): a live job on the picture shows a hover card and opens in the side panel; a coordinator's workers nest under it by `spawned-by`; a group shows lead, teams, and workers as one tree with live counts.
- `F933-quiet-mark-waits-longer-during-tests` (🟢 PROVEN): the live picture marks a running job quiet after 5 min with no event, or 15 min while it runs a test or check; not responding is unchanged; the legend states the rule (Adam picked B).
- `F771-omp-claude-bridge-follows-upstream` (🟢 PROVEN): OMP pi-claude bridge is now upstream pi-claude-bridge v0.9.1 plus OMP commits; Limen argv unchanged; dated backup kept. Merge `59dc42f`.
- `F772-seat-guide-from-live-cold-run` (🟢 PROVEN): seat guide encodes the nine limen-test cold-run snags, with a phase map and who/where labels; pins unchanged; docs only. Merge `a5d858e`.
- `F770-omp-coordinator-counts-as-live` (🟢 PROVEN): a warm OMP coordinator counts as live when Herdr omits `interactive_ready`; explicit false stays not live; one rule for ensure, poller, and doctor. Landed `abf1e84`; focused tests 19/19.
- `F762-private-planning-reads-clearly` (🟢 PROVEN): PR #4 private planning code reads top-down with plain docs; same behavior (smoke diff empty); no pre-PR test changed. Landed `130cf0c`; focused tests 110/110.
- `F761-issue-body-rings-doorbell` (🟢 PROVEN): `@limen` in an open issue body rings the doorbell once per issue with its own cursor and `issue-<n>` claim; title, closed issues, and PR bodies never count. Landed `211efee`; live Alice bot needs `/opt/limen` upgraded.
- `F760-issue-comment-rings-doorbell` (🟢 PROVEN): an authorized issue conversation comment rings the doorbell like a PR comment; review refuses an issue claim; PR behavior unchanged. Landed `086aeb9`; live Alice bot needs `/opt/limen` upgraded.
- `F758-lead-group-step-rings-finish` (🟢 PROVEN): a lead turn that writes group synthesis or closes a group sends the finish webhook once; no "land it" for a no-land feature. 166/166 focused tests; live send not yet observed.
- `F756-feature-decision-spec` (🟢 PROVEN): decision fields belong in the map feature file front matter (`decision`, `touches`, `open`, evidence); group closed, branches kept unmerged.
- `F755-herdr-shows-running-and-finished` (🟢 PROVEN): finished job tabs close with a logged result; running tabs read `· running`; coordinator title shows running and finished counts. Full check 568/568; live tab closed 1.8 s after finish.
- `F754-picture-sees-what-it-cites` (🟢 PROVEN): tick counts feature and journey sources; dry-run always prints; build warns `source.missing`; place panel lists touching features and journeys. Load-only timing failures passed alone on main and merge.
- `F753-readme-is-scannable` (🟢 PROVEN): README has a contents list, headings, tables, steps, and a grouped command reference; facts and commands unchanged.
- `F752-first-map-starts-interactive` (🟢 PROVEN): the first map job starts with `--tab`; `--detached` only when the interactive start fails. Tick refreshes stay detached.
- `F740-collaborative-groups` (🟢 PROVEN): `limen group` released — bounded teams on one feature, peer findings delivered, lead is sole landing owner; full two-team sssnark trial kept. Landed on Adam's order. Full check on `02731ba`: 559/563; three load-sensitive tests passed on a quiet rerun, and the stale template history was regenerated after the merge.
- `F751-done-job-names-the-next-step` (🟢 PROVEN): a done job's finish message says the job is done and names the next step: land it, or name the check that blocks landing. No surface says "merge not ready".
- `F728-hosted-engine-liveness` (🟢 PROVEN): a hosted OMP job stays running when Herdr loses its agent row but `omp` is still on the pane; reproduced on `main` first. Merged `a1f9e4f`. The long-labels hosted test is unstable before and after.
- `F749-finish-guide-without-open-proof` (🟢 PROVEN): the finish guide drops the finished proof steps and links the F091 record.
- `F748-map-is-a-local-file` (🟢 PROVEN): the map is described as a local file, not in Git, not a live feature list, and not refreshed by a board-only change; the vision note matches.
- `F747-setup-guides-match-the-seat` (🟢 PROVEN): seat guides say the seat owns the project copy and job files; new jobs use OMP; Linux identity is current; the old VPS walkthrough is an old record.
- `F746-status-guide-uses-command-names` (🟢 PROVEN): guides use `status` and `Candidates to inspect`; the README command reference lists every command, split into coordinator and operator actions.
- `F750-maps-light-features-by-touch-lines` (🟢 PROVEN): the Limen map lists 15 features and 5 journeys with explicit touch lines; the Alice map has no feature edges, and its 14 features light only their touched places. Both strict builds are clean; the datasets are local, not in Git.
- `F741-omp-finish-wakes-herdr-coord` (🟢 PROVEN): a finished job wakes the OMP Herdr coordinator that started it as an observed turn; `limen wait` refuses under `LIMEN_COORDINATOR=1`. Code `39ec81b`; live hosted OMP proof 2026-10-03 woke pane `wYN:p1` in 0.38 s; wake and wait tests 8/8.
- `F014-github-doorbell` (🟢 PROVEN): an authorized PR mention reaches Alice's registered Herdr coordinator through an isolated App key; one hosted review and one start/finish receipt observed. Adam closed it with one repository on one seat (2026-10-03).
- `F743-living-architecture-picture` (🟢 PROVEN): Limen ships a reusable local architecture map — contract, offline `picture build`, explicit `touches`/`steps` overlay, and a one-pass `tick` that calls no model without a structural or cited code change. Landed `07a9c6b` / `cf68cd4`; check 531/531; live tick started one refresh, quiet tick spent nothing.
- `F731-seat-bell-once` (🟢 PROVEN): each unheard terminal job or hosted-stall advisory gets one seat bell; exclusive receipt before transport prevents restart/concurrent double-rings, and ambiguous notify failures are not retried. Launchd sweep stays paused (no live notify proof). Landed `5117a92` / `47e0d77` via merge `39a9756`.
- `F744-role-spaces-match-project-roots` (🟢 PROVEN): Herdr role spaces qualify by canonical project root so same-basename projects stay separate; legacy spaces untouched and recorded tabs still reopen. Landed `78a21a1`.
- `F730-job-guidance-matches-engines` (🟢 PROVEN): setup docs and job finish labels follow the board's engine choices; OMP jobs log `done: <engine> exited 0` (not hard-coded pi), and launch examples put the outcome first with the ticket last. Landed `f0d1ec4`.
- `F745-status-names-the-work` (🟢 PROVEN): `limen status` names coordinators subject-first (tab label · handle · status · ids) and lists cleanly ended unlanded work under Candidates to inspect, not ready-to-land. Landed `8f83a81`.
- `F742-feature-identities-stay-unique` (🟢 PROVEN): feature numbers name one thing — parked field-guide proposal filed as F743; landed F050 diff viewer history untouched. Landed `7328a16`.
- `F739-doorbell-dedupe` (🟢 PROVEN): the finish ping claims once per job and final state, so jobs at the same commit each ring; a sender timeout gets one retry inside a 4 s budget. Landed `16939e1` with test-env fix `cf273fd`; focused 57/57 under `LIMEN_JOB=1`; live receiver turn unobserved.
- `F738-plate-inbox` (🟢 PROVEN): `limen status` is a one-screen inbox — Running, Ready to land, Needs a decision, older behind `--all`; ancestry or patch-id counts as landed, shared with `prune --retire`. Landed `39a22e1`; synthetic 2,000-record cabinet 1.7 s (was 64.9 s); live plate 4.7 s with Herdr.
- `F737-worker-skills-visible` (🟢 PROVEN): OMP workers discover portable and legacy plant skills without hand links; native skills win collisions. Landed `f40ac5b`; live hosted/detached/continue OMP and focused checks passed.
- 2026-09: 77 folded landings. A plant status command shows running work, unmerged branches, and working coordinators (F736); finished workers hand off to the landing owner (F735), stalled tool children fail their job (F734), authorized PR mentions reach one warm coordinator through a doctored seat (F732, F733), and Pi and OMP became interchangeable engines (F727) after a Pi-only interval (F726). Earlier, stale intent prose was matched to landed reality (F725), tests stopped owning prompt prose (F723), wake sweep collection became private (F722), and coordinator status became static (F721), alongside overlapping-worktree retention, owner-routed finish wakes, explicit seat recovery, job retention, native checks, engine defaults, and evidence-backed role handoffs. Details and outcomes: spec/features/done/2026-09/
- 2026-08: 44 landed. Hosted jobs run in a named tab; wakes retry; the process tree is contained. spec/features/done/2026-08/
