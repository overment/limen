# F734 · A stalled child stops claiming RUNNING

## Outcome

A job that waits indefinitely in a silent, CPU-idle child process is marked failed in bounded time, instead of showing a healthy RUNNING pulse until a coordinator notices. The diagnosis names the stalled tool and preserves the worktree, transcript and cleanup evidence. A live, CPU-active build or model turn is not mistaken for a hang.

## Scope

- Start at the detached wrapper and hosted supervisor, which currently disagree on lifetime limits; observe their actual OMP and Pi transcript/tool boundaries.
- Watch a pending tool and its process tree with a bounded time and CPU-progress window; distinguish a dead child from a slow but active child.
- On confirmed stall, stop the owned engine/job tree safely and finalize failed with an explicit reason. On uncertain process ownership, report an advisory rather than killing an unrelated PID.
- Preserve real state and wake delivery for both hosted and detached jobs, including reaped supervisor recovery.

## Out of scope

- A generic model-thought timeout or killing an idle interactive hosted pane with no active tool.
- Changing Alice/mega tests, Herdr itself or the job-history retention policy.

## Acceptance

- A hosted OMP and hosted Pi tool stuck in an idle child do not stay RUNNING past the configured confirmation window; the result is failed, with no orphan child owned by the job.
- Detached OMP and Pi obey the same stall diagnosis rather than waiting for the 90-minute outer deadline.
- A CPU-progressing long build and a silent model turn are not failed for lack of log lines.
- After termination, `limen jobs` and the subscribed completion wake identify the failure and retained worktree; an uncertain process observation never asserts a confirmed stall.
