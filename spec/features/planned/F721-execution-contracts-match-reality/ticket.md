# F721 · Execution contracts match reality

## Outcome

A worker reading its preamble sees how it is actually running. An operator reading `done` sees every clean hosted exit the runtime already records. Recovery documentation names uncertainty instead of calling it gone, and a test pins that boundary.

## Scope

- Start at the run-mode lines in `templates/worker.md`: in Herdr, detached is not the default.
- Extend the README `done` sentence so it names the hosted terminals the supervisor already finalizes, without changing them.
- Document all `locateHostedAgent` outcomes in `src/herdr.ts`, including the conservative uncertainty result of its concrete recovery probe.

## Out of scope

- Changing when spawn hosts versus detaches, or forcing `--review` to detach.
- Changing a closed tab from `done` to `stopped`.
- Editing the hosted-job note written by spawn, pulse comments, or unread hook files.
- Changing the locate helper's return type or reap behavior.

## Acceptance

- The worker preamble says detached is `--detached`, not the default; packaged `templates/.history/worker.md` matches the new bytes.
- README `done` names a hosted session ended, a hosted agent ended because the tab is gone, a clean idle close, and a `done:` stop, alongside Pi exited 0; it still says `done` is not proof the ticket is finished.
- The locate helper documents a resolved target, an unresolved lookup (`undefined`), and a concrete lookup whose uncertainty returns `"unknown"`; it does not equate unavailable evidence with confirmed absence.
- A direct test shows a concrete lookup returns `"unknown"` when Herdr cannot supply a reliable answer.
- A direct test distinguishes confirmed absence from an uncertain concrete lookup.
- Existing recovery waits and hosted finish/tab-close tests pass without changing when a job becomes terminal.

## Notes

No runtime behavior changes. Documentation and one test are the slice.
