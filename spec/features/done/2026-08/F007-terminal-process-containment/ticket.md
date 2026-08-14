# F007-terminal-process-containment · Truthful terminal cleanup for escaped job processes

[2026-08-14] [🟢] [PROVEN] [COORDINATOR] PROVEN · F007-terminal-process-containment

## Outcome

Stopping or timing out a Limen job leaves no silently surviving job-started process, or — when termination cannot be confirmed — leaves a durable, human-readable record naming what survived. A coordinator can trust that `stopped`/`failed` describes the whole job, not just the wrapper's process group.

## Scope

- Reproduce the escape first: a test with a fake Pi whose child detaches from the wrapper's process group (`setsid` or equivalent) and keeps running. Prove that today `limen stop` and `--timeout` leave it alive with no trace in the job record. Commit that reproduction as its own commit before any fix.
- Track job descendants beyond the initial process group and make `stop` and timeout termination best-effort against them (TERM, wait, KILL), scoped strictly to processes started by that job — never a broad pattern kill.
- When any process cannot be confirmed dead, write a durable note in the job directory (for example `cleanup`) naming the surviving PIDs and commands, and surface it in `limen jobs` detail. Advisory only: it must never block state transitions, spawns, or merges.
- Add one reviewer-template rule: a failed or unclean runtime setup is a finding to report, not a harness to repair; return the verdict with that check marked unverified.
- Target macOS. A macOS-native process identity mechanism may be used when it keeps cleanup scoped to a job; Linux behavior is out of scope for this feature.

## Out of scope

- Sandboxing, containers, or cgroup-style guaranteed containment.
- Killing processes not started by the job (shared dev servers, user processes).
- Gating job completion, review, or merge on clean termination.
- Changing how projects write their own launcher scripts.

## Acceptance

- A test proves an escaped-group child survives today's stop path (committed first, then updated to assert the fix).
- After the fix: `limen stop` and `--timeout` terminate a deliberately escaping child, or the job record contains a cleanup note naming it; the test covers both branches.
- `limen jobs <id>` shows the cleanup note when present.
- Existing stop/timeout tests still pass; `npm run check` is green.
- On macOS, cleanup uses the native microsecond birth identity, rejects an observed PID replacement before signaling it, and writes an advisory warning whenever identity cannot be confirmed. It remains best-effort: macOS exposes no atomic verify-and-signal handle.
- `templates/reviewer.md` carries the runtime-setup finding rule.

## Notes

Motivating incident: the F001 Easy review's bounded Pages smoke test launched wrangler/workerd, which escaped the process group; `limen stop` marked the job stopped while workerd survived and the review lost its verdict. Investigation record: agent cf3662de, 2026-08-14.

[2026-08-14] Human decision: narrow F007 to macOS so cleanup can use a trustworthy platform process identity rather than claim portable PID safety. Survey: `macos-process-identity.md` documents the `proc_pidinfo` birth-identity boundary; this is best-effort, not sandbox-grade containment.
