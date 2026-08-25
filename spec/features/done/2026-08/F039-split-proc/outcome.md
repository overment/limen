# Outcome

`src/proc.ts` is gone. Process identity lives in `contain.ts`, the reaper in `reap.ts`, the detached wrapper in `wrapper.ts`, the hosted supervisor in `supervisor.ts`. Unused exports and `requireNodeMajor` are gone. `CONTRIBUTING.md` cites the 2750-line cap. Structure test and Biome passed on `main`. Merged `755457f` as a move — no independent review.
