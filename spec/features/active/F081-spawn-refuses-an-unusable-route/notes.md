# Repair note

- Blocking: the candidate says an auth-ready batch-only model still passes preflight. That contradicts the outcome and acceptance requiring an unusable route to fail with the provider's reason; `pi auth check --model` proves credentials, not routability.
- Keep the check before job-directory and worktree creation, and preserve the usable-model path. Do not weaken the ticket or substitute a fake auth failure for an auth-ready unusable route.
- If Pi exposes no cheap route probe that avoids a generated turn, commit the safe partial work and write the precise cost or interface question instead of claiming acceptance.
