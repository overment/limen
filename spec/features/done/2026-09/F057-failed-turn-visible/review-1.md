PASS 85206330e03fe254b3d5a9f9d7e427a802d7f8ec

HEAD matches the named candidate (`git rev-parse HEAD`). The tree at that SHA includes the F057 implementation (`a7d02fa` feat: say a failed model turn out loud, plus the template-history and src-budget follow-ups). No blocking acceptance break.

Acceptance is met in product terms: a previous assistant `stopReason: error` (or `aborted`) is remembered in `hook/communication.ts` and the next per-turn cue carries the error text; a successful previous turn gets none. `templates/communication.md` has the failed-turn sentence. A hosted session jsonl whose last assistant message is an error, past the idle window, writes `advisory` beginning `errored:` and does not finalize; the wake toast and body say the last turn failed, not that the job is idle.

**Notes (plausible, not blocking)**

- `notifyHerdr` in `hook/wake.ts` still interpolates `limen: ${label} is ${kind}`, so the Herdr notification for this path is `is errored`. The injected wake and `session.ui.notify` already say last turn failed; that is what acceptance names.
- Hosted `noteHostedIdle` treats only `error` / `error: …` as errored. An `aborted` last turn still takes the old idle / clean-worktree path. Ticket supervisor scope is `error` only; the coordinator cue does handle `aborted`.
- `lastFailure` is in-process. A coordinator reload before the next turn drops the cue. Ticket says the hook only has to keep the text until the next turn.
- After the idle threshold, `lastHostedAssistant` rereads the newest session jsonl on every supervisor tick, not only when arming the advisory.

**Checks**

- `git rev-parse HEAD` → `85206330e03fe254b3d5a9f9d7e427a802d7f8ec` (match).
- `npm ci` from `package-lock.json` → 12 packages, 0 vulnerabilities.
- `node --test --test-concurrency=1 --test-timeout=60000 test/communication-hook.test.ts` → all tests in that file passed, including `an errored previous assistant turn puts the error on the next cue, a successful one does not`.
- Same runner on `test/hosted-spawn.test.ts` → F057 case `noteHostedIdle writes an errored advisory when the last assistant turn failed` passed; neighboring idle/result/stop-reason tests through `hosted stop with a done: reason records done` also passed. The file did not finish: the wrapper hit 120s before `hosted stop leaves running when the agent ignores interrupts`, `hosted stop finalizes when the supervisor is gone and the agent is missing`, and `two long hosted labels keep distinct agent names`. Those three are unverified, not failed.
- `node --test --test-concurrency=1 --test-timeout=60000 test/wake-hook.test.ts test/structure.test.ts` → 38 pass, 0 fail, including `an errored advisory wake says the last turn failed` and the src-budget / template-hash checks.

Feature-folder notes are outside the diff and were not judged.
