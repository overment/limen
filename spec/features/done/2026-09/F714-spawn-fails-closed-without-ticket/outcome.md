# Outcome

Spawn with a `Ticket: spec/...` pointer now refuses unless that file is a blob in the job's base commit. The error names the path; no worktree, branch, or job directory is left behind. Untracked tickets on disk do not count. Resume checks the named branch tip, not the caller's dirty tree. Landed `d220b3b`. Worker native lane: TypeScript, Biome, and 401/401 tests passed. Workspace `Ticket:` expansion is unchanged. Adam reviews; no independent reviewer.
