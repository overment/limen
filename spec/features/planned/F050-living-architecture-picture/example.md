# Alice / field guide

A local personal assistant that acts through code. **The runtime is the product; the window is a client.**

**Illustrative snapshot, not live health.** Source: `fd67336e94bd3a13eb86341c04de265cef5020a2`. Selective inspection, not a whole-repository audit. [Interactive wireframe](example.html) · [Proposal](proposal.md) · [Evidence map](notes.md).

## The whole shape

```text
YOU
 │ see, send, inspect
 ▼
SURFACES ──typed requests──▶ HOST & CONTRACT ──runtime requests──▶ RUNTIME
   ▲                         │ account / OS / Secrets             │
   │ snapshots + live hints  │                                    ├─read/write─▶ REMEMBER
   └─────────────────────────┴────────────────────────────────────┤
                                                                  └─call─▶ ACT OUTSIDE
                                                                           │
                                                              providers / services / Node
```

Arrows here describe runtime flow, not imports. `alice-ai` depends on `alice`; the host injects its implementation. Code takes a different path: the host's `HostCodeRunner` implements the runtime interface and adapts to `alice-code`, which has no `alice` dependency. The kernel depends on neither concrete crate. Look generation and proof are a separate development layer, not another product authority.

| Place | Owns / does not own | First source address |
| --- | --- | --- |
| **Surfaces** | Chat, Apps, History, Gallery, Capabilities and Settings render facts; they do not own the journal or scheduler | `src/app/Main.svelte`, `src/lib/thread/project.ts`, `src/lib/ui/` |
| **Host & contract** | Tauri composition, native transport and host services; account operations route to the host's account owner, runtime requests to Runtime | `contract/operations.json`, `src/lib/ipc/client.ts`, `src-tauri/src/commands.rs` |
| **Runtime** | Bounded agent work, dispatch, Grants and coordinated authority access; no vendor wire protocol | `crates/alice/src/runtime.rs`, `crates/alice/src/agent/` |
| **Remember** | Authored Files, journals, work rows and typed Values are four semantic authorities; live decoration and index are disposable | `crates/alice/src/{workspace,journal,work,values}/` |
| **Act outside** | Concrete provider/service protocols and contained Node execution; credentials/permission are not granted by importing a package | `crates/alice-ai/src/lib.rs`, `crates/alice-code/src/lib.rs`, `src-tauri/src/code_runner.rs` |
| **Look & proof** | Tokens/vocabulary generate the look; proof records consequences. Neither is product history | `ds/tokens.json`, `src/lib/ui/schema.ts`, `scripts/proof/run.mjs`, `spec/quality/` |

External boundary: optional account/cloud services are not audited here. This map does not assert desktop/browser parity, remote runtime delivery, Windows containment, all MCP modes, sync, or offline-model readiness. HTTP client transport still rejects as unimplemented. “Main/spotlight” in vision is not proof that both windows are delivered in this snapshot.

## Follow a message

1. **See & send:** the window submits through the typed RuntimeClient. The journal projector paints history, with live decoration while a turn runs.
2. **Cross one contract:** the Tauri runtime request route calls Runtime using the generated envelope. Account operations have a host-owned branch; this journey is a runtime message, not an account call.
3. **Work:** the bounded loop reads current authored identity and uses work rows for scheduling. Grants govern dispatch; the host injects provider/Code implementations. Intent/result journal records explain durable consequences; streaming chunks are not journal history.
4. **Act:** a model/service adapter speaks its actual protocol; Code uses the contained runner. A caller implementing a runtime interface is not a second scheduler.
5. **Remember & return:** durable history is the journal; work rows say what this host is doing. Clients reread authority and then consume disposable notices. Closing a client is not `Runtime.stop`; this is an architectural/source claim, not a native test result from this study.

[Inspect the source boundary](https://github.com/iceener/alice/blob/fd67336e94bd3a13eb86341c04de265cef5020a2/src-tauri/src/commands.rs) · [Inspect the runtime](https://github.com/iceener/alice/blob/fd67336e94bd3a13eb86341c04de265cef5020a2/crates/alice/src/runtime.rs).

## Enter “Remember”

| Fact | Writer / location | If the client disappears |
| --- | --- | --- |
| Who Alice is now | Authored workspace Files; runtime CAS writes, direct edits legal | Files remain; future work rereads them |
| What happened | Runtime-written `threads/YYYY/MM/<id>/journal.ndjson` | History remains; reconstruct the transcript |
| What this host is doing | Guarded work-row owner in app-local `state.db` | A client subscription does not own the work |
| This host's preferences | Typed Values, separate schema/table ownership in `state.db` | Preferences remain; not scheduling history |
| Search/projection acceleration | Derived `.alice/index.db` | Rebuild from authority; not a fifth authority |

Managed attachment bytes belong to Files + journals. Secrets belong behind the host credential boundary, not authored files or Values. The four-authority count describes Alice's core durable state model; it does not erase external account authority or credential storage.

**Intent:** AUTHORITY-SPLIT, HEADLESS-RUNTIME, ONE-WRITER in `spec/vision.md`; “One authority per state family” in the styleguide.

**Source inspected:** the current runtime module declarations and authority construction, not every mutation path. [Runtime module map](https://github.com/iceener/alice/blob/fd67336e94bd3a13eb86341c04de265cef5020a2/crates/alice/src/lib.rs).

**Earlier proof, reported:** nested replies/restart repair (F595) records a before-repair falsifier and 55 passing protocol/fold tests at candidate `81981f469…`. Its isolated-native waiting/reopening acceptance was not run. The referenced summary exists in the primary checkout; this study did not rerun those tests or audit that summary's contents. [Original outcome](https://github.com/iceener/alice/blob/fd67336e94bd3a13eb86341c04de265cef5020a2/spec/features/done/2026-09/F595-nested-child-root-never-settles/outcome.md).

## Worth knowing

### A rule and its implementation disagree

**Intent:** the vision's PROJECTION-IDENTITY text still puts all same-turn tools above one narration row. **Source:** the projector preserves chronological narration beats (`project.ts`, comments and implementation around narration insertion and reply slots). The recent alignment audit (F641) already proposes correcting the rule; do not open a duplicate ticket or silently rewrite the vision.

[Vision at this snapshot](https://github.com/iceener/alice/blob/fd67336e94bd3a13eb86341c04de265cef5020a2/spec/vision.md) · [Projector](https://github.com/iceener/alice/blob/fd67336e94bd3a13eb86341c04de265cef5020a2/src/lib/thread/project.ts) · [Existing audit and proposed wording](https://github.com/iceener/alice/blob/fd67336e94bd3a13eb86341c04de265cef5020a2/spec/features/done/2026-09/F641-vision-styleguide-alignment-audit/notes.md).

### “Provider-only” is narrower than the adapter crate

The styleguide calls `alice-ai` model protocols only. Its current crate header and declared modules also own Integration HTTP, MCP, OAuth and search. The kernel/adapters dependency direction still agrees with intent in the sampled source. The disagreement is responsibility wording, not permission to move code. The existing audit recommends documenting the actual adapter owner; human judgment remains outstanding.

[Adapter crate](https://github.com/iceener/alice/blob/fd67336e94bd3a13eb86341c04de265cef5020a2/crates/alice-ai/src/lib.rs) · [Styleguide](https://github.com/iceener/alice/blob/fd67336e94bd3a13eb86341c04de265cef5020a2/.agents/limen/styleguide.md).

### Done is not one kind of evidence

| Claim | What is actually available |
| --- | --- |
| One provider Integration supports chat/images | Landed source; focused checks reported; Adam's OpenRouter dogfood confirmation is recorded in the outcome. No isolated-native suite claim. [One-Integration outcome](https://github.com/iceener/alice/blob/fd67336e94bd3a13eb86341c04de265cef5020a2/spec/features/done/2026-09/F580-one-integration-chat-and-images/outcome.md) |
| A browser can attach to Alice | **Not implemented in this inspected transport:** request and subscribe reject. The landed desktop/web map (F644) is a design, not a working edge. [Rejecting HTTP transport](https://github.com/iceener/alice/blob/fd67336e94bd3a13eb86341c04de265cef5020a2/src/lib/ipc/http.ts) |
| Two agents can use isolated live Alice labs | **Proposal only** in the inspected lab architecture (F643); no launch or cross-session proof in this study. [Lab design](https://github.com/iceener/alice/blob/fd67336e94bd3a13eb86341c04de265cef5020a2/spec/features/done/2026-09/F643-agent-owned-alice-lab-instances/architecture.md) |

## Coverage receipt

Mapped the whole product at responsibility level from vision/styleguide and module entries. Traced client → contract → runtime and inspected adapter/authority declarations plus narration source. Read recent outcomes, the earlier quality report, the recent alignment audit, and the lab/browser designs. Did not audit every source path, open historical Alice frames, run Alice tests, inspect external APIs or use the creator app. Proof-file existence is not proof-file validation.

The board view and recent Git history disagree in recency; this guide reports the disagreement and does not create a replacement board. All source links pin the snapshot, not `main`. GitHub links may require repository access; offline, use `git -C /Users/overment/playground/alice-app/alice show fd67336e94bd3a13eb86341c04de265cef5020a2:<path>` or the retained source copies named in [notes](notes.md).
