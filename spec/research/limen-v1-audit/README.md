# Limen v1.0 — clearer handoffs, less steering

Limen has the right basic separation of responsibilities, but the audited implementation is not reliable enough to call v1-stable. I would keep its small, file-based architecture and fix the boundaries where it guesses about delivery, ownership, or completion. I would also loosen instructions that send ordinary engineering decisions back to the coordinator.

Two independent research sessions and a fresh judge examined the integration. The judgment retained **15 technical findings with explicit limitations** and classified the remaining finding as a **review-policy choice**, not a runtime bug. All three used `openai-codex/gpt-6-astra:xhigh` as requested; this was independent task scrutiny, not cross-model consensus. No production code or feature state was changed by this audit.

The interactive presentation is on the Desktop: [Limen-v1.0.html](file:///Users/overment/Desktop/Limen-v1.0.html). It is a proposal and explanation, not a shipped product or a live dashboard.

## What I would keep

The division between Limen, Pi, and Herdr is useful:

- **Limen owns intent and evidence:** tickets, work boundaries, job records, subscriptions, candidate commits, and filed judgments.
- **Pi owns agent execution:** sessions, model calls, tools, input queues, retries, and extension events.
- **Herdr owns terminals and layout:** workspaces, tabs, panes, agent presentation, and terminal control.

A Herdr `done` indicator means unseen idle. A Limen `done` record means a run ended cleanly. Neither means the candidate is safe or the feature is proven. Keeping those distinctions is more important than adding another status word.

The intended handoff remains simple:

```text
Human outcome → coordinator → committed ticket + bounded instruction
                              ↓
                     isolated worker → candidate + retained evidence
                              ↓
                     subscribed wake → consumed message → settled response
                              ↓
                     coordinator inspects → fresh review when warranted
                              ↓
                     ordinary Git integration → outcome + board
```

Steering is a correction to a running job, not a new product charter. Researchers advise; a judge examines their reports. Reviewers judge a candidate without repairing it. Quality and picture jobs inform future work without becoming merge gates. The coordinator remains the human's one conversation and owns integration decisions.

## What prevents trust today

The important findings are not stylistic preferences:

- **Launch and continuation do not consistently preserve isolation.** Two synchronized real CLI launches deleted each other's unpublished worktrees. Two sequential continuations started in the same checkout. The coordinator independently reproduced both. Stop automatically deleting resources whose ownership is unknown; establish one checkout owner across launch, continuation, and pruning.
- **A message submission is mistaken for delivery.** Pi's extension API returns `void` and reports asynchronous rejection elsewhere. Limen can move a steer to delivered with zero model calls, or keep a rejected wake claimed indefinitely. A promise-returning mock hid this mismatch. Adding `await` does not repair a void API.
- **Lifecycle events are conflated.** Reloading a hosted session writes a terminal marker even though that session can keep answering. Wake handling can repeat an already recovered response or resubmit an `aborted` result. Session replacement needs an explicit meaning; it must not accidentally mean successful completion.
- **Control can target stale identity.** Relocation updates the pane but leaves an old tab available for focus and closure. A stale PID record can make stop signal a process with a mismatched birth identity. These were safe adapter or fixture probes, not observations of unrelated live work being destroyed.
- **Terminal evidence can contradict itself.** Competing finalizers can publish both failure and success. A successful hosted transcript can retain an earlier advisory answer and error. Explicit finish handoffs and provisional transcript snapshots need different treatment.

These are counterexamples to correctness. They do not establish incident frequency, natural PID-reuse rates, or the precise cause of the failed live launches encountered during this audit. The full [judgment](judgment.md) preserves the narrower claim for every finding.

## Use the existing APIs more accurately before replacing them

| Boundary | Small direction | Important limit |
|---|---|---|
| Pi message injection | Observe corresponding message consumption and the final settled response; retain pending evidence until then. | Neither proves the coordinator reviewed or acted on the result. |
| Pi wake identity | Prefer structured machine identity to exact-text matching. | Custom messages are still fire-and-forget and bypass prompt preparation; preserve stable guidance on a wake-first session. |
| Pi finish | Return the supported `terminate: true` with the shutdown request. | This suppresses the ordinary continuation only for a terminating tool batch; queued input can still continue. |
| Pi retries | Let Pi own provider retries; evaluate its settled outcome. | Synthetic abort reproduction is not a live Escape-key test. |
| Herdr observation | Keep one full observation, including current location and verified identity, and reuse it within the pass. | Do not assume upstream fields and behavior are installed-server guarantees. |
| Herdr command transport | Quote one shell command for `pane run`. | Do not apply shell encoding to an argv-preserving `agent start` contract. |

I would **not** begin with an embedded Pi SDK rewrite, a direct Herdr socket client, or a new workflow engine. The current CLI/process boundary provides useful separation and recovery. First remove redundant work and correct the adapter contracts. A direct protocol client would also make Limen responsible for protocol compatibility; that cost needs a measured benefit.

The version distinction is concrete: the installed Herdr **0.8.2 client** negotiated protocol **20** in a scratch socket fixture; the cloned upstream declares **22**. The installed server was not interrogated by that probe. Upstream's background-start tests suggest a future way to avoid focus theft, not permission to delete the installed compatibility path today.

## Organization and naming

The current distinction between subject-oriented conversation names and outcome-oriented job names is worth keeping. A conversation can be `chat settings`; a job can be `inline model setup in chat · F422`; its review adds the round. Feature numbers stay attached to their meaning.

But names should remain presentation. A feature number identifies durable intent; a job ID identifies one run; a live agent name can locate a current occupant; a pane or tab is a mutable place. None should silently substitute for verified process or terminal ownership.

Role workspaces are helpful visual grouping, not repository identity. The adapter currently reuses a workspace by `${basename(root)} ${role}s`. Equal basenames can co-locate distinct projects, and concurrent list-then-create can duplicate spaces. These are source-derived risks, not reproduced live failures. Reuse should respect canonical project root and role while labels stay readable. Explicit display plurals would also avoid names such as `qualitys`; this is presentation cleanup, not a reason for another registry.

## Loosen the prose, not the evidence standards

The worker prompt treats a named seam as both a starting lead and a reason to stop. I would make the **outcome and explicit boundary** authoritative: follow necessary dependencies within that boundary, and ask only when scope or product intent actually changes. File-count thresholds and “ten reads means edit” can be useful reminders, but should not force premature edits or unnecessary handoffs.

The review rubric is a policy choice. A reviewer can currently investigate a proven regression yet leave PASS because it does not violate an acceptance bullet. My earlier description of this as a contradiction was too strong; the judge correctly noted that regressions can remain notes. I recommend defining PASS more broadly so proven, candidate-caused contract or security regressions may block, including ones introduced during repair. Keep plausible concerns nonblocking, re-review bounded, and the coordinator responsible for the merge.

Other changes should subtract misleading text: detached is not the default inside Herdr; review examples need the intended detached flag; a failed streamed response may have been partly visible. Correct canonical prose and examples rather than adding repeated reminders or phrase-checking machinery.

## Performance and the order I would choose

One measurement is especially actionable: **50 synthetic streamed updates caused 51 Git status calls** through the actual detached wrapper. Sample changed files at useful boundaries or a bounded cadence and coalesce unchanged activity. Likewise, reuse Herdr observations and publish metadata only when it changes. This is avoidable amplification, not proof of a particular live CPU percentage.

My order would be:

1. **Protect work and control:** eliminate unpublished-resource deletion, concurrent checkout ownership, unsafe signaling, stale UI control, and competing terminal publication.
2. **Make handoffs truthful:** fix injection acknowledgement, reload semantics, retry/abort handling, and stale evidence; use native finish termination where applicable.
3. **Reduce overhead and prompt friction:** coalesce observation work, validate installed compatibility, and simplify the role contracts and documentation.

Do not answer every race with a new lock. Removing unsafe automatic cleanup or Limen's second retry loop may be smaller. Where a mechanical reservation is necessary, make interruption recoverable and ownership inspectable. Do not turn tickets into parsed state machines or make the runtime decide product acceptance.

Existing work on hosted startup, route preflight, and lost-supervisor recovery already owns nearby boundaries. History retirement is not the repair for deleting an unpublished worktree. This assessment does not create new tickets or reprioritize another coordinator's jobs.

A v1 claim should come from explicit failure-path tests and measured spawn/notification latency, idle cost, and scaling with live jobs—not “flawless” as an adjective. Add real Pi binding tests alongside unit mocks, and isolated installed-Herdr compatibility probes. No finite audit can establish the absence of all bugs.

## Evidence and coverage

The audit covered all Limen runtime and command files, hooks, top-level role templates, matching tests, and relevant Pi/Herdr integration implementations and documentation. It did **not** read every unrelated subsystem or vendored dependency in the two upstream repositories. Pinned revisions, installed versions, and temporary clone locations are in [sources.md](sources.md).

Actual results:

- Independent focused tests: **77/77 hook tests** and **8/8 runtime tests** passed.
- Coordinator `npm run check`: TypeScript completed; Biome then failed on Git-ignored runtime evidence and did not reach tests. Runtime artifacts should be excluded from source formatting.
- Coordinator `npm test`: **66 passing and six failing test lines** before the 600-second tool deadline; no final suite verdict. A separate researcher runtime attempt recorded **24 passed, three failed, 17 cancelled**. The deadline failures remain unattributed.
- The coordinator reran the four-case runtime probe and the installed-Pi integration fixture; both exited **0**, reproducing the reported counterexamples. Pi responses/authentication were synthetic; there was no provider traffic.
- The judge independently compared eight installed Pi source-map files to the pinned source, all matching. It inspected retained evidence rather than rerunning behavioral probes.
- No full upstream build, real TUI teardown test, installed-server pane-move test, remote-seat prove, or comprehensive compatibility certification was completed.

Read the [Pi report](report-1.md), [runtime/Herdr report](report-2.md), [judge's dispositions](judgment.md), and [retained evidence guide](evidence/README.md). The Desktop presentation visualizes these conclusions while keeping facts, fixture limits, and proposals separate.
