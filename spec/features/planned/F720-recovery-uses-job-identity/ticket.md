# F720 · Recovery uses job identity

## Outcome

Hosted-owner recovery no longer loads the spawn command to name an agent. The fallback name still matches the `agent-name` written at start and continue. Recovery no longer depends on CLI planning just to derive that name.

## Scope

- Start at recovery's import of `hostedAgentName` from the spawn command (`src/recovery.ts`).
- Move that pure namer off the spawn command so recovery does not pull worktree planning, Herdr tabs, or prune for job identity.
- Continue currently imports the same export; it must keep writing the same `agent-name`.
- Preserve the exact name: feature-in-label hoist, leading or trailing feature number, and a long slug that still keeps the hex suffix.
- Job-id minting stays in spawn (it needs `node:crypto`). The namer stays a pure function.

## Out of scope

- Changing the hosted-agent name algorithm or the feature-number hoist.
- Changing recovery's fresh Herdr probe, or the locate helper's return type.
- Raising the `src/` line budget, or adding `index.ts`, `types.ts`, or a helper bag.

## Acceptance

- `src/recovery.ts` does not import `src/commands/spawn.ts`.
- Existing hosted-name cases still pass after their import follows the namer.
- Existing recovery tests still wait rather than finalize when Herdr cannot provide a reliable answer.
- Recovery derives the unchanged fallback name from the job id when `agent-name` is absent.
- Continue still writes `agent-name` with that same function.
- `src/` stays within the size allowance recorded on the board without compressing logic to make room.

## Notes

The namer is job identity, not CLI planning. Put it where recovery can import it without loading spawn.
