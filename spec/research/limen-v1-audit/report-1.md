Limen’s Pi hooks have reproducible delivery and lifecycle defects; the passing hook tests do not establish v1.0 readiness.

The deciding tradeoff is reliability without more workflow machinery. Keep the filesystem handoff and coordinator judgment, but distinguish **submission, message consumption, completed response, and session teardown**. The present hooks sometimes treat these as the same event.

## Sources and verification

Citation roots:

- **L** — Limen revision `5a00065c92d86cd2039149273095e4e470898418`, inspected in `/tmp/limen-hooks-audit.BqRlq2/pinned`.
- **P** — https://github.com/earendil-works/pi.git, revision `da840b6216578c2a571d0374ac6a2091a83f9d91`.
- **I** — installed Pi `0.85.1`, under `/Users/overment/.nvm/versions/node/v24.1.0/lib/node_modules/@earendil-works/pi-coding-agent`.

Installed source maps matched **15 relevant coding-agent files byte-for-byte**, plus `packages/agent/src/agent.ts` and `agent-loop.ts`. This establishes parity for the cited integration paths, not the entire installed release.

After `npm ci --ignore-scripts --no-audit --no-fund`, the targeted communication, inheritance, hosted, steering, speech, wake, and wake-sweep tests passed: **77 passed, 0 failed**. Log: `/tmp/limen-hooks-audit.BqRlq2/hook-tests.log`.

A separate fixture used installed Pi’s actual `AgentSession`, extension loader, runner, and agent loop, with synthetic provider responses and temporary cabinets:

```bash
PI_OFFLINE=1 node /tmp/limen-hooks-audit.BqRlq2/repro.mjs
```

Final execution exited **0**. Results are in the adjacent `repro.log`. No production edits, commits, board changes, report files, live-job control, or paid model calls were made.

## Findings

### 1. High — asynchronous rejection produces false steering receipts and stuck wake claims

**Trigger:** Pi rejects an injected message before starting a turn—for example, missing authentication or manual compaction.

Pi’s extension API declares `sendUserMessage(...): void`. Its runtime catches the underlying asynchronous rejection and emits an extension error; it does not return that promise to Limen. Consequently, wrapping the return in `Promise.resolve()` does not establish acceptance.

- **Steering reproduction:** Pi reported `send_user_message: No API key found`. There were **zero model calls**, but `steer/inbox/0001` was deleted and `steer/delivered/0001` existed.
- **Wake reproduction:** The same rejection left `accepted=true`, `delivered=false`, and **zero model calls**. After repairing authentication and artificially aging the claim past its stale threshold, subsequent sweeps still made no call: Limen kept refreshing its `live` file.

The steering text survives in the delivered record, but it is falsely classified and will not be retried automatically. The wake claim can remain stuck while its listener keeps running.

**Evidence:** `P/packages/coding-agent/src/core/extensions/types.ts:1375–1378`; `P/packages/coding-agent/src/core/agent-session.ts:2574–2592`, `1176–1179`, `1234–1248`; `L/hook/steering.ts:97–101`; `L/hook/wake.ts:204–210`, `359–369`, `744–763`.

The existing rejection test substitutes a promise-returning API that Pi does not expose: `L/test/wake-hook.test.ts:1273–1326`.

**Small recommendation:** Treat the API call as submission only. Retain pending steering until observable message consumption, and stop perpetually renewing an unentered wake when Pi is idle. Correct the local API type and test against the real extension binding. Simply adding `await` will not fix this.

### 2. High — hosted `/reload` falsely announces job completion

**Trigger:** Reload extensions in a hosted worker; session replacement has the same shutdown-event ambiguity.

The hosted hook writes `session-ended` for every `session_shutdown`. Pi explicitly includes `"reload"`, `"new"`, `"resume"`, and `"fork"` among that event’s reasons—not just `"quit"`.

**Reproduction:** Calling public `session.reload()` left `session-ended=true`. The same session then answered another prompt successfully; there had been **zero shutdown requests**.

The supervisor treats that marker as terminal regardless of the live agent’s status, then finalizes the job and returns.

**Evidence:** `L/hook/hosted.ts:100–104`; `P/packages/coding-agent/src/core/extensions/types.ts:632–637`; `P/packages/coding-agent/src/core/agent-session.ts:2818–2841`; `L/src/supervisor.ts:66`, `96–104`; `L/src/herdr.ts:139–140`.

**Small recommendation:** Inspect the shutdown reason. Extension cleanup is not process completion. Reload must neither create nor leave a false terminal marker; explicitly define session-replacement behavior separately.

This is a hook-to-supervisor contract finding, not an independent audit of Herdr process ownership.

### 3. High — wake retries duplicate recovered work and override aborts

**Trigger:** A wake response encounters a transient provider error and then succeeds, or ends aborted.

Limen permanently sets `pending.errored=true` after any failed assistant message. A later successful retry sets `answered=true` but never clears the error. At settlement, the error wins: Limen deletes the claim without counting an attempt and immediately sweeps again.

**Reproductions:**

- One synthetic `overloaded_error`, followed by Pi’s successful retry, produced **three model calls and two identical wake user messages**. Only two calls were needed for the original request and retry.
- A synthetic aborted response, with Pi auto-retry disabled, produced **two model calls and two wake messages**: Limen restarted it automatically.

The code also gives terminal errors no Limen retry ceiling because those releases do not count as attempts. Persistent errors can therefore restart after Pi exhausts its own retry policy.

**Evidence:** `L/hook/wake.ts:359–365`, `498–513`, `880–892`; `P/packages/coding-agent/src/core/agent-session.ts:702–710`, `2891–2940`.

**Small recommendation:** At `agent_settled`, evaluate the final outcome after Pi’s retries rather than latching every intermediate failure. Preserve an aborted wake as pending/advisory instead of silently reopening the turn. Let Pi own transient provider retries.

### 4. Medium — `finish` pays for another model call before shutdown

**Trigger:** A hosted worker calls `finish`.

The tool requests shutdown but returns an ordinary tool result. Interactive Pi defers that shutdown while the agent is busy; the agent loop normally asks the model to respond to the tool result first.

**Reproduction:** The actual tool wrote the handoff and requested shutdown once, but Pi made **two model calls**, ending with an extra assistant response. A scratch wrapper adding only `terminate: true` reduced this to **one call**, preserving the handoff and shutdown request.

**Evidence:** `L/hook/hosted.ts:57–61`; `P/packages/coding-agent/src/modes/interactive/interactive-mode.ts:1915–1919`, `3382–3383`; `P/packages/agent/src/agent-loop.ts:225–235`.

Installed Pi’s example states the purpose directly: “without paying for an extra follow-up LLM turn” (`I/examples/extensions/structured-output.ts:1–5`, `34–43`).

**Small recommendation:** Return `terminate: true` alongside `ctx.shutdown()`. Keep `finish` as the final tool action: Pi terminates a batch only when every finalized tool result requests termination (`P/packages/agent/src/agent-loop.ts:589–590`).

### 5. Medium — legitimate input transforms defeat wake identity

**Trigger:** Another coordinator extension transforms injected input.

Wake confirmation matches the original text against the consumed user message exactly. Pi runs `input` transformations before constructing that message.

**Reproduction:** An extension that appended one sentence caused **two successful responses**, followed by `blocked=true` and `delivered=false`. The wake was consumed twice but never recognized.

**Evidence:** `L/hook/wake.ts:490–496`, `768–789`; `P/packages/coding-agent/src/core/agent-session.ts:1182–1200`.

**Small recommendation:** Use a structured machine-message identity rather than prose equality. Pi supports custom messages with `customType` and `details`, plus custom rendering. This can carry a job/receipt identifier through message events without treating it as human input.

That API is still fire-and-forget: switching to custom messages does **not** itself solve finding 1. See `P/packages/coding-agent/src/core/extensions/types.ts:1365–1378` and `agent-session.ts:1482–1514`.

### 6. Low — busy wakes miss the promised audience cue

**Trigger:** A completion arrives while the coordinator is already responding.

Limen generates its wake-specific cue in `before_agent_start`. Pi’s streaming path queues the follow-up and returns before emitting that event; the agent loop later drains the queue directly.

**Reproduction:** A human prompt followed by a queued wake produced **two model calls but only one communication cue**. The wake call lacked “This turn was opened by a job wake”.

**Evidence:** `L/hook/communication.ts:41–55`, `101–109`; `P/packages/coding-agent/src/core/agent-session.ts:1209–1223`, `1276–1297`; `P/packages/agent/src/agent-loop.ts:257–268`.

**Small recommendation:** Put the essential audience/wake cue in the wake itself. Describe guidance refresh accurately as occurring on a new prompt submission, not every model call or queued follow-up.

### 7. Medium — review PASS excludes proven regressions outside ticket bullets

**Trigger:** A diff demonstrably breaks an existing contract or introduces a security defect that the ticket’s acceptance bullets did not anticipate.

The reviewer is told to investigate “broken invariant, silent regression, security exposure,” but also:

> “Blocking is only a proven break of an acceptance bullet.”

Thus a proven regression outside those bullets must remain PASS-with-notes. Re-review further directs the reviewer to file anything beyond prior blockers as a note.

**Evidence:** `L/templates/reviewer.md:8`, `14`, `18–20`.

This is a demonstrated instruction conflict, not evidence that a particular unsafe candidate was merged. The coordinator still decides what to merge.

**Small recommendation:** Allow blocking findings for proven, candidate-caused regressions, contract violations, and security defects, including newly introduced ones during re-review. Keep plausible risks and unavailable checks nonblocking. This changes judgment guidance, not runtime gates.

### 8. Low — failed-turn guidance incorrectly says nothing was visible

**Trigger:** An assistant streams useful text and then errors or is aborted.

The next cue asserts that “nothing reached the human.” Pi’s renderer explicitly preserves partial content and displays the failure afterward.

**Evidence:** `L/hook/communication.ts:58–64`, `104`; `P/packages/coding-agent/src/modes/interactive/components/assistant-message.ts:177–198`.

**Small recommendation:** Say the previous response failed or was incomplete. Do not infer transcript invisibility from `stopReason`. This finding is source-proven; no visual/TUI reproduction was run.

## Integration shape and efficiency

The basic architecture remains useful:

- **Routing uses Pi’s current session identity.** Pi populates `PI_SESSION_ID` for each Bash command; spawn records that subscriber. Workers discard inherited coordinator metadata before launching their own Pi. No additional identity registry is needed (`P/packages/coding-agent/src/core/tools/bash.ts:165–190`; `L/src/commands/spawn.ts:122–148`; `L/src/wrapper.ts:105–110`).
- **Inheritance separates durable guidance from short cues.** Project text overrides package defaults; communication assembles stable guidance in the system prompt and keeps wake-specific text outside it. Preserve that separation (`L/hook/inherit.ts:41–47`; `L/hook/communication.ts:41–55`, `80–98`).
- **Machine notifications can use native custom messages.** Structured identity and rendering are a better fit than synthetic human messages and exact-text receipts. Include the necessary cue because this path also bypasses ordinary prompt preparation.
- **Avoid unmeasured performance claims.** Cold drift detection synchronously executes Git history queries; the footer redraw interval is 120 ms. These are identifiable costs, not proof of the reported CPU problem (`L/hook/inherit.ts:99–126`, `149–153`; `L/hook/wake.ts:196`; `P/packages/coding-agent/src/modes/interactive/interactive-mode.ts:2090–2092`). Same-sweep wake batching could also avoid one response per queued completion; Pi defaults to one-at-a-time queues (`P/packages/agent/src/agent.ts:231–232`).

## Coverage and limits

Read all in-scope hooks and top-level role/communication templates, their relevant tests, and the matching Pi extension, session, queue, prompt, persistence, and rendering paths. Traced spawn subscription and prompt inheritance through steering, hosted finish, completion wake, and actual coordinator response. Consulted the pinned read-only board before reporting.

The reproductions exercised installed Pi’s real integration machinery, but used synthetic authentication/model behavior. They did not exercise a real terminal, provider network, Herdr UI, or process teardown. Session replacement beyond reload is source-traced, not independently reproduced.

No full lane was rerun after the coordinator reported its baseline failures and timeout. The 77 passing targeted tests and these probes are the complete independent execution claim; they do not imply the remaining integration is bug-free.
