# Verdict: FAIL

Checkout matched `c064d3e7cc07e6f060c650f8f9fcd674894412bf` and remained clean.

## Blocking findings

1. **Proven — idle and done stalls still lack a stalled state label.**  
   `src/herdr.ts:207` publishes only `blocked=⚠ stalled …`, while `noteHostedIdle` escalates `idle`, `done`, and `blocked`. Herdr selects visible state labels by the current agent status, so an idle worker—the primary acceptance case—has no `state_labels.idle` stalled label. This only partially resolves prior finding 1. Publish mappings for all escalated statuses and make the fake assert them.

2. **Proven — `npm run check` cannot be green because the changed test is misformatted.**  
   `test/hosted-spawn.test.ts:83-141` has incorrect callback-body indentation. The exact locked Biome 2.5.8 reports a formatter error and exits 1. This violates the ticket’s explicit check acceptance.

## Prior blocking findings

- The invalid `stalled` state key was replaced with a Herdr-valid key, and the fake now rejects invalid labels. A real Herdr 0.8.2 probe accepted `blocked` while still rejecting `stalled`.
- The inherited-role test failure is resolved. The test saves, sets, and restores `LIMEN_ROLE`, and covers both worker and reviewer restoration.

## Unverified acceptance

- The required live prove with a stalled worker and no coordinator was not run.
- The complete `npm run check` suite could not execute because this checkout lacks dependencies; it stopped at `tsc: command not found`. Running the matching tools from the adjacent root checkout independently proved the formatting failure.

## Checks run

- `git rev-parse HEAD` — matched the requested candidate.
- `git status --short --branch` — clean detached checkout.
- `git merge-base --is-ancestor 43c1473 HEAD` — passed.
- `git diff --check 43c1473..HEAD` and `git diff --check 6c467dc..HEAD` — passed.
- Real Herdr 0.8.2 probes — `blocked` parsed successfully; `stalled` exited 2 as invalid. Stored probe metadata was cleared afterward.
- Exact new test under inherited reviewer environment — passed, 1/1.
- All `noteHostedIdle` tests — passed, 5/5.
- `node --test ... test/hosted-spawn.test.ts` — passed, 27/27.
- Matching TypeScript 5.9 `tsc --noEmit` — passed.
- Matching Biome 2.5.8 `biome check .` — failed on `test/hosted-spawn.test.ts` formatting.
- `npm run check` — failed before validation with `tsc: command not found`, exit 127.

Candidate commit: c064d3e7cc07e6f060c650f8f9fcd674894412bf.
