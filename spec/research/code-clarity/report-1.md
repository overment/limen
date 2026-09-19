Limen is already easy to change in the way the styleguide wants. The next gains are a few boundary repairs, not a redesign.

**Tradeoff that decides it.** Every extra helper or file split either fights the `src/` line cap (already exact at 4160) or risks collapsing a distinction that exists so a live worker is not killed, a wake is not double-delivered, or HTTP 2xx is not treated as a bot turn. Prefer one moved name function, honest types, and one preamble wording fix over factories, shared claim engines, or splitting the wake closure.

**Source.** Repository `a1ebcf2` (`docs: README matches the shop-manual coordinator layout`). Read: `src/`, `hook/`, `templates/`, `README.md`, `test/structure.test.ts` plus the tests named under coverage, `spec/vision.md`, `.agents/limen/styleguide.md`, `spec/build.md`. No code changes. Tests were read, not run.

## Preserve

- **Capability vs judgment.** Runtime in `src/`; prose in `templates/` and project Markdown. `hook/communication.ts` injects shop manual, register, vision, styleguide; it does not own them. `package.json` has `"dependencies": {}`. `test/structure.test.ts:14-16` locks that, unique basenames, and no `index.ts`/`types.ts`/`utils.ts`.
- **One pulse function, caller-supplied liveness.** `derivePulse` in `src/job.ts:63-67` is the only pulse law (`test/structure.test.ts` “pulse law is one function”; `test/job.test.ts:56-61`). `src/job.ts` has no `node:` imports.
- **Job files are truth.** Spawn writes the table; `jobs` reads it; the footer is a hint (`templates/agents.md` jobs loop). Structure test `test/structure.test.ts:81-108` greps `spawn.ts` and `continue.ts` for those filenames — extraction of a writer helper would fail that test without rewriting it.
- **Process and notification distinctions (safety, not style).** Do not collapse: hosted vs detached (`HOSTED_NOTE` at `src/commands/spawn.ts:51-52`; wrapper timeout/cap/containment vs supervisor); Herdr `idle`/`done` vs `missing` (`src/herdr.ts:139-144`, `src/supervisor.ts:70`); cached `hostedAgentStatus` vs `fresh`/`concrete` (`src/recovery.ts:50-61`); notify claims vs delivered vs two unconfirmed then stop (`hook/wake.ts` `claimDelivery` / `recordUnconfirmed`); steer claims (confirm on send, `hook/steering.ts:77-107`) vs wake claims (confirm on `agent_settled`); finish HTTP acceptance vs bot-turn (`src/finish-turn.ts:5`, `src/finish-webhook.ts:25-26`); escaped-descendant snapshot before TERM (`src/contain.ts:59-70`, `src/commands/stop.ts:40-44`). Inform, do not gate: `--review` is hosted in Herdr unless the coordinator passes `--detached` (`templates/agents.md`; no runtime force in `spawn.ts:74`).
- **Local `text()` copies.** Same trim-or-empty helper in many command files. Styleguide: duplicating a short function beats a helper bag.
- **Wake as one session closure.** `hook/wake.ts` (980 lines, outside the `src/` budget) owns display, delivery, and reap trigger for one coordinator session. Splitting it requires a context object.

## Actionable findings

**1. Recovery loads the spawn command (demonstrated).**
`src/recovery.ts:4` imports `hostedAgentName` from `src/commands/spawn.ts`. That closes a cycle `spawn.ts` → `reap.ts` → `recovery.ts` → `spawn.ts`. Recovery then loads worktree planning, Herdr tabs, prune, and hunk lookup for a 12-line namer (`src/commands/spawn.ts:421-428`).
- **Cost.** A naming tweak in spawn can break hosted owner recovery; readers cannot treat `commands/` as the CLI edge.
- **Smallest correction.** Move `hostedAgentName` to `src/job.ts` (pure string identity). Delete the spawn export. Keep `makeJobId` in spawn (needs `node:crypto`).
- **Must remain.** Fallback name matches `agent-name` written at spawn (`spawn.ts:149`, `continue.ts:102`); `recoveryTarget` still uses a fresh Herdr answer (`recovery.ts:50-61`).
- **Tests.** `test/hosted-spawn.test.ts` `hostedAgentName` cases (~1143); recovery uncertain/missing paths (`test/recovery.test.ts:255-280`). Net `src/` lines must stay ≤ 4160 (`test/structure.test.ts:18-24`).

**2. `locateHostedAgent` return type and comment lie (demonstrated).**
Signature and JSDoc at `src/herdr.ts:144-145` say `string | undefined` and “Undefined means genuinely gone.” With `concrete === true` it returns `"unknown"` (`herdr.ts:147`, `:150`, `:176`). Callers already special-case that (`recovery.ts:58-61`).
- **Cost.** A future `if (located)` treats uncertainty as success; a future `if (!located)` treats uncertainty as missing and can finalize a live hosted job (`reap.ts` only recovers when target is not `"unknown"`).
- **Smallest correction.** Return type `string | "unknown" | undefined`; one sentence that `undefined` is gone only when `concrete` is false, and `"unknown"` means do not reap.
- **Must remain.** Visibility (`concrete` false) may reuse last good status (`herdr.ts:205-235` `lastHostedStatus`); recovery must not.
- **Tests.** `test/recovery.test.ts` unknown-status / list-outage waits. Coverage gap: no direct unit test that `locateHostedAgent(target, name, true)` returns `"unknown"`.

**3. Worker preamble says detached is the default; spawn does not (demonstrated).**
`templates/worker.md:9`: “Detached (default)”. `templates/agents.md` and `README.md`: in Herdr, spawn is hosted unless `--detached`. Code: `src/commands/spawn.ts:74` `tab = parsed.detached ? false : parsed.tab || herdr`. Same file’s `HOSTED_NOTE` and `templates/agents.md:69` say “no F007 process containment” with a bare feature number.
- **Cost.** A hosted worker can wait for steer/exit instead of `finish`; operators see an identifier without meaning.
- **Smallest correction.** Worker line: “Detached (`--detached`)”. HOSTED_NOTE / shop-manual: “no process-group containment of escaped descendants”. Update `templates/.history/worker.md` and `agents.md` hashes (`test/structure.test.ts` history check).
- **Must remain.** Hosted `finish` tool (`hook/hosted.ts:66-80`); detached timeout/cap/containment (`src/wrapper.ts:13-15`, `runInternalJob`); closing a hosted tab still ends the agent (`herdr.ts:326`).

**4. Pulse inputs differ between footer and `limen jobs` (demonstrated code; bug is a hypothesis).**
Both call `derivePulse`. `jobs` treats a hosted job as alive if the Herdr agent is not `missing` **or** the supervisor pid is live (`src/commands/jobs.ts:151-155`). Wake footer uses only `processGroupAlive(pid)` (`hook/wake.ts:675-682`). Shop manual: pulse is observed; footer is a hint.
- **Cost.** After a dead supervisor with a live agent (the recovery window in `reap.ts:63-69`), the footer can show `dead` / “needs attention” (`hook/wake.ts:961`) while `limen jobs` shows `think`/`tool`/`wait`.
- **Smallest correction.** Comment on `pulseOf` that footer liveness is the owner pid, not the hosted agent, so the 500ms sweep does not call Herdr. Do not add `hostedAgentStatus` to wake without measuring that path.
- **Must remain.** Jobs must not use `agentStatus === "working"` as pulse (`test/structure.test.ts`; `test/jobs-command.test.ts:215-253` “hosted jobs pulse follows activity, not Herdr unseen-idle”).
- **Coverage gap.** No test that footer pulse matches jobs pulse when supervisor is dead and the agent is not `missing`.

**5. Duplicate `git` ENOENT retry (demonstrated, tiny).**
`src/git.ts:129-131` runs `gitBin || "git"` twice on `ENOENT` before PATH fallbacks.
- **Smallest correction.** Delete the second identical `run`.
- **Must remain.** `--no-optional-locks` status does not refresh the index (`test/git-status.test.ts`). Coverage gap: no test for git missing from PATH then `/usr/bin/git`.

**6. `src/` is at the structure cap (demonstrated).**
`test/structure.test.ts:18-24` requires ≤ 4160 lines; counted 4160. This is a constraint, not a target. A net-zero move still fails if new import lines are not paid for. Do not raise the number to make room for helpers.

## Tempting refactors to reject

- **Split `hook/wake.ts` or `src/herdr.ts`.** Wake’s closure is the session; Herdr is one adapter. A `WakeContext` / `herdr-agent.ts` split is ceremony.
- **One claim/delivery helper for wake and steer.** Different confirmations (turn vs send) and slot prefixes (`_fallback` vs `_advisory.*`). Mixing them is the expensive failure.
- **Unify `sendCompletion` and `sendAdvisory`.** Near-duplicate (`hook/wake.ts` ~226-340) but slot and eligibility isolation is the safety. Leave both.
- **`writeJobFiles` / `JobFactory` for spawn and continue.** Structure test requires those names in both command sources. Continue already reuses `startHosted` from spawn; that sibling import is the right reuse.
- **Shared `text()`, `delay()`, `asRecord()`, session-id regex, `requiredEnvironment`.** Copies are local. The five identical `PI_SESSION_ID` checks (`spawn.ts:432`, `watch.ts:39`, `steer.ts:39`, `stop.ts:66`, `wake.ts:436`) are per-boundary gates; a `types.ts` is forbidden.
- **Break `wrapper` ↔ `contain` / `finish-webhook` cycles by adding `src/files.ts`.** Real 2-cycles (`contain.ts:3` ↔ `wrapper.ts:4`; `finish-webhook.ts:8` ↔ `wrapper.ts:5`). A third file costs cap room. Optional: pass `atomicWrite`/`appendLimenLog` on `ContainmentDependencies` (already has `query`/`signal`) — only if a later slice is already in those files.
- **Make `--review` force `--detached`.** Shop manual asks coordinators to pass it; runtime remains inform-don’t-gate.
- **Rewrite to a model’s default taste, or set an arbitrary per-file line target.** Vision quality bar is subtraction; styleguide forbids both.

## Coverage gaps (tests read, not run)

| Area | What exists | What does not |
|---|---|---|
| Pulse | `derivePulse` unit tests; jobs hosted activity vs Herdr idle | Footer vs jobs when supervisor dead, agent live |
| `locateHostedAgent` | Recovery waits on unknown | Direct `"unknown"` return |
| `hostedAgentName` | Naming tests via spawn import | Import graph / cycle |
| Git PATH fallback | Index-lock status | ENOENT then `/usr/bin/git` |
| Worker default mode | Spawn hosted-when-Herdr | Preamble vs runtime wording |
| Wake delivery | Large `test/wake-hook.test.ts` (claims, fallback, footer death) | Cross-check that advisory slots never confirm as completion |

**Hypothesis, not a finding.** `steer.ts:32` keys on supervisor `processGroupAlive` only; a hosted agent with a dead owner in the recovery window is refused. May be intended (no owner, no steer). No steer test covers that window.
