# Code clarity assessment

## Intent

The owner asked for independent code-quality lenses that improve clarity without overengineering. This is research, not implementation authorization. Both reports examine repository revision `a1ebcf2`; later commits only file research. The board's quota override required both researchers and the judge to use `xai/grok-4.6` with `xhigh` thinking.

## Questions for judgment

- Distinguish essential safety differences from accidental complexity. Existing structure tests and the line budget are constraints, not evidence that a design is readable; recommend policy changes separately rather than silently violating them.
- Report 1 proposes `string | "unknown" | undefined` to clarify a `string | undefined` return. The literal is already included in `string`; that proposal does not add type safety. Decide whether documentation suffices or a stronger representation is worth its cost.
- Report 2 identifies cleanup of in-flight spawn records. Check both the job directory and worktree lifetime: protecting a directory with `task.md` alone might miss the interval before a job record exists.
- Claims that existing lifecycle logic is one-shot or safe under races require evidence, not just a sequential terminal-state guard.
- Neither report ran tests. Do not upgrade source observations or missing tests into demonstrated runtime failures.

## Launch observation

The coordinator launched the two research spawns concurrently. Both exited 1 with `git is not on PATH`, before any matching job record existed. A subsequent shell lookup found `/usr/bin/git`, and `git --version` succeeded. Retrying the launches sequentially succeeded; the researchers then ran concurrently. No controlled reproduction established the cause. The source's Git helper maps `ENOENT` to that message, so a missing working directory is also worth considering. Treat this observation as supporting investigation, not as proof of the cleanup race.

## Deliverable

A short ranked recommendation: accepted findings, rejected or corrected suggestions, behavior that must remain, smallest coherent changes and their tests, and unresolved correctness questions. No code edits, new abstractions for their own sake, or automatic implementation.
