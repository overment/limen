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
