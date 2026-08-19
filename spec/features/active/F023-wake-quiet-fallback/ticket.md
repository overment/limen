# F023-wake-quiet-fallback · A delivered completion never churns, and mute means mute

[2026-08-19] [🟠] [ACTIVE] [COORDINATOR] ACTIVE · F023-wake-quiet-fallback

## Outcome

An idle coordinator sitting on a cabinet of old jobs does no background work: jobs whose completion was already delivered are never re-attempted, the watcher does not feed on the wake's own bookkeeping, `/limen off` silences Herdr toasts too, and a coordinator started one directory down still wakes.

Observed cost today (2026-08-18 review, findings C2/M6/M2): for every terminal job this session is not subscribed to — after `/new`, that is every old job, since `delivered/` slots carry the previous session id — `sendCompletion` creates `notify/claims/_fallback` *before* evaluating eligibility, fails eligibility on the existing delivered slot, and removes the claim. That mkdir/rm pair fires the recursive watcher, which schedules another sweep after the 50 ms debounce, which churns again: a self-sustaining ~20 Hz filesystem loop per already-delivered job, forever, on an always-on seat. Separately, the terminal-state Herdr toast at `hook/wake.ts:180` runs before the `muted` gate, and the whole extension keys off `context.cwd`, so a coordinator launched in a subdirectory silently never wakes while `limen spawn` (which resolves the git root) works fine.

## Scope

- **Disqualify before claiming.** The fallback path checks the cheap, stateless facts first — any `delivered/` slot exists, session not idle, muted — and returns without touching `claims/`. A delivered job never re-enters the fallback path at all. The existing under-claim `eligible()` re-check stays; it is the race guard, not the filter.
- **The watcher ignores its own bookkeeping.** Events whose path falls under `notify/claims/` or `notify/delivered/` do not schedule a sweep; the 500 ms timer still covers everything.
- **Mute gates every surface.** The `notifyHerdr` call for terminal states moves behind the `muted` check, alongside the completion itself.
- **Root resolution.** On `session_start`, the wake walks up from `context.cwd` to the nearest directory containing `.agents/limen` and uses that as the project root for both the gate and `.limen/jobs`, matching what the CLI's `limenRoot` resolves. No git invocation inside the extension.

## Out of scope

- The claim/delivered rename protocol itself — its at-least-once semantics and 30 s recovery are correct and stay.
- Subscription and fallback routing policy (F004's design): who gets a wake does not change, only how cheaply "nobody needs one" is decided.
- The wake's message content (F017) and the reaper (F025).

## Acceptance

- A jobs directory holding a terminal job with a foreign `delivered/` slot, observed by a wake session with a different session id: repeated sweeps create zero entries under `notify/claims/` (assert by watching the directory across several sweep intervals).
- An undelivered old job still falls back exactly once to one idle coordinator (the existing F004 behavior, already covered by `test/wake-hook.test.ts`, still passes).
- With mute on, a job finishing produces no Herdr `notification show` call; unmuting delivers the queued completion as today.
- A wake session started in `<root>/src` with `.agents/limen` at `<root>` subscribes, shows status, and delivers wakes for jobs under `<root>/.limen/jobs`.
- `npm run check` green.

## Notes

Seams: `sendCompletion`, `observe`, `scheduleSweep`, the `watch` callback, and `herdrTarget`/`session_start` wiring in `hook/wake.ts`; mirror the root walk in `hook/steering.ts` only if it shares the problem (it reads `LIMEN_CONTEXT_ROOT` from the environment, so it should not). The churn is invisible in tests today because no test drives repeated sweeps over an already-delivered job — add exactly that. Keep the fix honest about ordering: the cheap checks are advisories; only the claim decides.
