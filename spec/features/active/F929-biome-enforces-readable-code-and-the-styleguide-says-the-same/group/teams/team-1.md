# Team 1 · the shared flag module and the smaller command parsers

The repo-wide reformat that Adam assigned to this team is already on `main`: the lead ran it before the group started, so no team rebases across 104 reformatted files. This team takes the parser work that the reformat freed up.

Test line budget: 60 lines.

## First candidate: the shared flag module (land it within about an hour)

- One file, one job: parse a command's flags with `node:util` `parseArgs` and keep Limen's own error messages. Start from the keeper command (`src/commands/keeper.ts`): its `FLAGS` table and its `rejectBadFlags` first pass over `parseArgs` tokens. Pick a unique basename (`test/structure.test.ts`).
- Move the keeper command onto it, and one small command, so the API has two real callers.
- Team 4 will use the module for `spawn`, `continue` and `group start`: repeated flags, list values such as `--team-extension`, and a flag whose value starts with `-`. Publish the API (one paragraph and the type) before your candidate and wait for Team 4's answer or 15 minutes, whichever comes first.
- Team 2 uses it for `github` and `status`.

## Then the smaller commands, one small candidate each

`land.ts`, `picture.ts`, `ticket.ts`, `linear.ts`, `steer.ts`, `sweep.ts`, `init.ts`, and the dispatch in `src/main.ts`. `jobs.ts` belongs to Team 2.

- Keep every message. A command that takes free text after its flags, such as `limen steer --running <message>`, may read text that starts with `--`. If `parseArgs` would change what such a command accepts, leave its loop and say why in `notes.md`.
- `parseArgs` also accepts `--flag=value`. Accepting that form is fine; rejecting input that worked before is not.
- Show the behavior did not change: run the same argument list through the command on `main` and on your branch (a throwaway script outside the repository is enough) and put the result in the candidate message.

## Done

No hand-written `--flag` comparison loop is left in your files, or `notes.md` names the loop and the reason it stays.
