# F715 · Hosted tabs keep git on PATH and HERDR_ENV

## Outcome

A hosted Herdr worker can call `git` and sees `HERDR_ENV=1` the same way the coordinator that spawned it does. Spawn no longer flakes because the tab's environment omitted `/usr/bin` or dropped Herdr's marker. Operators should not have to wrap every hosted job with a custom PATH.

## Scope

- Hosted start, beginning at the env `startHosted` already passes into Herdr (`src/commands/spawn.ts` / `src/herdr.ts`).
- Guarantee `/usr/bin` is on PATH so `git` resolves, and `HERDR_ENV=1` is present in the hosted agent environment.
- Keep the change in Limen's Herdr integration. Do not redesign Herdr.
- Focused hosted-start tests. If the fix cannot land in Limen, write the Herdr-side ask in the feature notes and stop.

## Out of scope

- Detached wrapper PATH, finish webhooks, jobs filtering, or a land command.
- New Herdr CLI, pane layout, or agent-start protocol.
- Unusable-route refusal or remote-seat work.

## Acceptance

- A hosted start records an environment where `git` is found via PATH that includes `/usr/bin`, and `HERDR_ENV` is `1`.
- A spawn that previously would have failed for missing git or missing `HERDR_ENV` now starts, or the notes file names the Herdr-side gap and this slice stops without a fake pass.
- Detached jobs are unchanged.
- Focused hosted tests cover the PATH and `HERDR_ENV` contract.

## Notes

Tony hit this as a hosted flake, not a missing git install. Prefer prefixing a known-good PATH and passing `HERDR_ENV` through the existing env map over adding configuration.
