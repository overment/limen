# Outcome

A running job line now shows how many files its worktree has changed beside the tool count. A clean worktree shows zero, while a missing or unreadable worktree omits the count; the signal never steers or gates the job. Landed `a98fa51` after rebasing over the concurrent steer work. Coordinator inspection, TypeScript, Biome, three focused behavior checks, and 19 structure checks passed; the repository-wide worker run timed out with unrelated hosted and spawn flakes.
