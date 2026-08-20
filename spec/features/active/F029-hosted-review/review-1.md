# F029 review · coordinator PASS (independent review empty)

Independent review job `2026-08-20-f029-review-f7ab7309` ended `done` with stop-reason `error: Error Code null: The model is currently at capacity…`. No verdict, no commits. Human said proceed.

Coordinator inspected candidate `914bc4d41163706bef555491ed99cb6447730ccf` against `spec/features/active/F029-hosted-review/ticket.md`.

## Verdict

PASS. Three-line spawn latch matches the ticket. `--review` in Herdr is hosted; `--detached` stays a log tail; `--tab --review` no longer throws; no-Herdr `--tab --review` still requires Herdr. Git worktree for review stays `detached`. Shop-manual sentences that said reviews stay detached are gone.

## Checks

- `node --test test/hosted-spawn.test.ts test/spawn-command.test.ts`: F029 cases pass, including `spawn --review in Herdr is hosted; --detached keeps a watch tab`. One pre-existing flake: `independent jobs can run concurrently` (fake-pi race). Unrelated.
- Merge conflict in `test/hosted-spawn.test.ts` with F027: kept both tests and both imports.

Candidate commit: 914bc4d41163706bef555491ed99cb6447730ccf.
