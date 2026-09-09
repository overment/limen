# Ticket authorship: map and implementation boundary

The requested ticket, `spec/features/active/F-multi-author-ticket-identity/ticket.md`, is absent from this worktree. No findings file was supplied. This slice follows Adam's instruction to resolve ticket filers for collaborators, without changing the one-coordinator job model in `spec/vision.md`.

## Phase 1: map

- Tickets are ordinary versioned files. `src/commands/init.ts` installs their template; the coordinator commits them before spawning (`README.md`). There is no ticket registry or filing command.
- `src/main.ts` dispatches commands. A read-only `limen ticket-author <ticket-path>` command can expose authorship without parsing Markdown or adding workflow state.
- `src/git.ts` owns local Git access. The ticket's creation commit records its author separately from the committer. Git rename history can preserve that attribution when a ticket moves between lanes.
- Identity should come from the creation commit, not the latest editor, current `git config`, or authenticated GitHub account. Return the recorded name and email with the source commit. Recognized GitHub noreply email forms can additionally expose a login; ordinary emails need no network lookup.
- Untracked tickets and incomplete history must not be assigned to the current operator. Report unavailable evidence explicitly. Git records who authored the filing commit, not necessarily the human who requested an agent to write it; the command must state that boundary.

## Phase 2: bounded delivery

Implement the read-only command, document its evidence and limits, and test with real Git repositories: two authors, a different committer, later edits, lane moves, and unavailable history. No author field in Markdown, identity registry, GitHub API, job ownership change, or edits to ticket/board/outcome files.

The discriminating check is that a ticket moved and edited by a second collaborator still resolves to its creation author, while a second ticket resolves to its own author. No broader multi-coordinator scheduling work belongs here.

## Reviewer map and evidence

- `limen ticket-author <ticket-path>` is dispatched in `src/main.ts`; output and GitHub noreply extraction live in `src/commands/ticket-author.ts`; Git evidence lives in `src/git.ts`. The README documents the command and its identity limits.
- `git log --follow` also follows copies. The copied-template regression initially returned the template author's identity. Stopping at `--diff-filter=AC` rather than `A` fixes that misattribution without losing lane renames. The command stops at the latest creation/copy for the current path history, so deleting and recreating a path records the new filer.
- All shallow repositories are refused conservatively, even when a recent creation might be visible. Missing/uncommitted paths are refused against `HEAD`; paths are literal, bounded to the current repository, and relative to the caller. No fallback reads current identity. Raw `%an`/`%ae` intentionally preserve recorded identity rather than applying a local mailmap.
- `test/ticket-author-command.test.ts` uses real repositories and the CLI. Six tests cover separate filers/committer, edits/moves, copied templates, both GitHub noreply forms, normal email, uncommitted/staged/missing/directory/outside paths, shallow history, literal/subdirectory/absolute/worktree paths, branch isolation, recreation, mailmap independence, and unchanged working files.
- Initial discriminating run: failed with unknown command. Implemented run: passed. First structure run: 22/23 passed; the new command exceeded the estimated line allowance after formatting. The final allowance is the measured 3685 source lines (44 above baseline, including the now-wrapped command union). The rerun passed before edge-case expansion.
- Reviewer artifacts are retained outside this worktree at `/home/overment/limen/.limen/jobs/2026-09-09-multi-author-ticket-identity-d563589e/ticket-authorship-evidence/`. `candidate.txt` identifies the committed code under check; `focused.log`, `native-check.log`, and `check-results.txt` carry actual results.
- `spec/build.md` has no board line for this request, and the referenced ticket remains missing. Neither was edited. Adam owns review per the board; no independent review or merge was attempted.
- There is no `finish-webhook-env`, `finish-webhook`, or `finish-webhook-attempt` in this job cabinet, no project finish env file, and no `TONY_*` environment override. Tony HTTP delivery is not configured here; the coordinator must provide an authorized configuration before a deliberate send. No private config or credentials were searched for.

## Remaining boundary

This resolves the author of the filing commit, not a human requester hidden behind shared bot credentials. GitHub logins are extracted from recorded emails, not authenticated or refreshed. Git-unrecognized moves, squash commits, and rewritten history can erase original attribution. A distinct requester field or shared-agent identity policy would be a separate product decision, not something inferred from the current operator. The missing ticket must be supplied if its acceptance requires more than this Git-backed lookup.
