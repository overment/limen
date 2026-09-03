# Outcome

A hosted worker that delivered a response and left a clean worktree now reaches terminal state after the idle bound even when its ordinary turn used tools. Dirty, active, errored, blocked, and response-less jobs stay open. The recorded reason is `closed a clean idle session`, not a false claim that the session had already ended.

Landed `12d533a`. Review PASS of `76e0895`. The complete check later exposed unrelated timing and source-budget failures that remain pre-push work.
