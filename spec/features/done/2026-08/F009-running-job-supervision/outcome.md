# Outcome

## Result

Landed. `limen steer <id> "text"` writes `.limen/jobs/<id>/steer/inbox/NNNN`. The worker extension claims each file once, delivers it with `sendUserMessage({ deliverAs: "steer" })`, parks the claim at `steer/delivered/NNNN/`, and appends `steered: …` to the job log. Finished jobs and workers whose extension never loaded are refused without writing.

The leftover “watch tab” is operating advice, not a command: a coordinator inside Herdr can already open a sibling pane and `tail -f` the job log. That line is now in `AGENTS.md`. Hosting the worker itself in a pane remains F010.

Independently reviewed at `57f6c96`. PASS. Coordinator ran `tsc`, biome, and the 12 steer/structure/init tests before review; the reviewer re-ran those plus spawn/stop/jobs/wait (32), communication+wake with `LIMEN_*` stripped (20), workspace/migrate/job/stream/watch (19). Mid-tool-call survival is unverified in-repo and rests on Pi’s documented `deliverAs: "steer"` queue — the same seam wake already uses.

Existing projects need `limen init` and a commit of `.pi/extensions/limen-steering.ts` before a new worktree loads the watcher.

## Date

2026-08-15

## References

- Reviewed commit: `57f6c96`
- Feature commit: `c7df26d`
- Review job: `2026-08-15-f009-review-b3d1cc3a`
- `src/commands/steer.ts`, `hook/steering.ts`
- `test/steer-command.test.ts`, `test/steering-hook.test.ts`
