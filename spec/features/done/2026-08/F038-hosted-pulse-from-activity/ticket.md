# F038-hosted-pulse-from-activity · Hosted pulse follows activity, not an unfocused tab

[2026-08-25] [🟢] [PROVEN] [COORDINATOR] PROVEN · F038-hosted-pulse-from-activity

## Outcome

A hosted job that is generating in a background tab reads `think` (or `tool`) in both `limen jobs` and the coordinator footer. Herdr `idle`/`done` stays what it already is: unseen, not finished, not waiting.

## Scope

- Delete the hosted-only pulse ternary in `src/commands/jobs.ts`. Hosted and detached both go through `derivePulse` in `src/job.ts`, keyed off the job's `activity` file and whether the worker is alive.
- `hook/wake.ts` `pulseOf` calls that same function (it already imports `../src/proc.ts`; `job.ts` is node-free). Drop the local `processGroupAlive` copy.
- Replace the lockstep test in `test/structure.test.ts` — today's `copied pulse law stays in lockstep` asserts the wake copy *exists*, so it fails the moment the copy is deleted. The new shape: `hook/wake.ts` imports `derivePulse`, and `src/commands/jobs.ts` never maps `agentStatus` onto a pulse word. It must fail if a third hosted mapping lands.
- Alive for a hosted job in `jobs` stays "supervisor group or hosted agent still present" — `hostedAgentStatus` keeps that one duty. The footer keeps its cheaper `processGroupAlive(pid)`; do not call `hostedAgentStatus` inside the 500 ms sweep. `derivePulse` takes `alive` as an input, so callers may differ on how they compute aliveness — never on the words. Pulse words stay observations of `activity`, not of Herdr tab focus.

## Out of scope

- Changing what Herdr `idle`/`done` mean for finalize or stall (F017 / F020 / F027 / F030).
- A new `pulse.ts`, a helper bag, or merging the twelve `text()` copies.
- Footer animation, mute, or wake routing.

## Acceptance

- Fake hosted job with `activity=think` and Herdr status `idle` or `done`: `limen jobs` prints `think`, not `wait`.
- Same job with `activity=tool` prints `tool`. After `turn_end` writes `wait`, both `jobs` and the footer path report `wait`.
- `pulseOf` / `derivePulse` / `jobs` cannot disagree on the five pulse words for the same `(pid, alive, activity)` input.
- A hosted job whose `pid` handshake has not landed reads `starting` — the current ternary says `dead` for that window. Intended, not a regression.
- `npm run check` green.

## Notes

Found in the 2026-08-25 source review. Shop manual: a long model turn can stay on `think`. F027 already treats Herdr idle as not-a-stall while `activity !== wait`. `noteHostedIdle` in `src/proc.ts` obeys that; `renderJobDirectory` does not — it maps `agentStatus === "working" ? "think" : "wait"` whenever activity is not already `tool`/`wait`. Unfocused hosted tabs are Herdr `idle`/`done`, so a live generation reads `wait` in `jobs` and `think` in the footer.

Do this before F039 (a `proc.ts` split). No dependency on F032's live prove.
