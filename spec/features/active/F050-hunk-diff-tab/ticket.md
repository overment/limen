# F050-hunk-diff-tab · Look at the branch in a review UI

[2026-09-02] [🟠] [ACTIVE] [COORDINATOR] ACTIVE · F050-hunk-diff-tab

Limen's trust boundary is "look at the branch before you merge," and today that moment is raw `git diff` text. [hunk](https://hunk.dev) is a review-first terminal diff viewer built for agent-authored changesets — a multi-file review stream, sidebar, split/stack layouts, watch mode. The job record already carries its inputs: `base`, `branch`, `worktree`. One law governs the integration: hunk is an environment, not a dependency — exactly Herdr's status. Detected, used, recorded; never required, never gated on. Independent of F048/F049; schedule at will.

## Outcome

At the merge decision the human runs (or the coordinator opens for them) `limen diff <id|suffix|label>` and reviews the job's whole changeset in hunk — in a named Herdr tab when Herdr hosts the session, in the current terminal otherwise. Without hunk on PATH the command prints the exact `git diff` invocation instead. Nothing else in limen changes behavior based on hunk's presence.

## Scope

- A `limen diff` command resolving jobs like `jobs`/`stop`/`open` do. Finished job (worktree usually pruned): review exactly `base...branch` from the job record, piping the patch when hunk needs one. Running job with a live worktree: review the job's changes in that worktree, following them live where hunk's watch supports it.
- In a Herdr environment, open the review in a named tab following F012 conventions and record the place like `limen open` does, so a second `limen diff` focuses instead of duplicating and `limen close FNNN` sweeps it with the feature's other tabs.
- Outside Herdr with a TTY, run hunk in place — this is the seat-over-SSH path and composes with F013. With no TTY (a coordinator's Bash tool), never launch a TUI: print the fallback `git diff` command and exit cleanly. Inform, don't gate.
- Detection mirrors Herdr's: hunk found on PATH, `LIMEN_HUNK` overriding the binary, `LIMEN_HUNK=0` disabling. Absent hunk is the same clean fallback as absent Herdr, not an error.
- Record the hunk version beside pi and Herdr in the job's `versions` file when present (F026 pattern: recorded, not a runtime gate).
- One sentence in `templates/agents.md` at the merge-decision step: the coordinator may open the human's review with `limen diff <id>`; the coordinator itself keeps reading text diffs — the UI is for human eyes.

## Out of scope

- Hunk's agent-session features: inline agent annotations, `--agent-context`, skills, STML notes. The reviewer flow (F018) stands; annotating a live hunk session is a later experiment against an API hunk itself marks experimental.
- Changing the running-job watch tab default (the log tail answers "what is it doing"; this command answers "what has it made").
- Pager integration, hunk config management, or installing hunk for the user.
- Any behavior change in spawn, wake, reap, review, or merge when hunk is absent — which must remain the fully supported path.

## Acceptance

- Finished job, worktree pruned, hunk present, Herdr env: `limen diff <id>` opens a named tab showing exactly the `base...branch` changeset; running it again focuses the existing tab; `limen close FNNN` closes it.
- Running job: the review shows the job's changes against its recorded base and picks up new commits where hunk's watch allows; the job itself is untouched.
- hunk absent (or `LIMEN_HUNK=0`): the command prints a copy-pasteable `git diff <base>...<branch>` line and exits 0.
- No TTY and no Herdr: same printed fallback, no TUI launched — safe when a coordinator types it.
- `versions` on a fresh job names the hunk version when installed and omits it silently when not; no code path reads it back.
- The full spawn → review → merge flow passes untouched on a machine with no hunk installed.

## Notes

hunk invocation details (patch pipe vs in-repo range, watch flags) are the worker's to pin against the installed hunk's actual CLI — record what was tested, mirror `versions`, and prefer the invocation that survives hunk's own releases. hunk 0.20.0 is current at writing.
