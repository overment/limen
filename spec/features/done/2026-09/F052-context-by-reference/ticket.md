# F052-context-by-reference · Refer to governing files instead of attaching them

[2026-08-31] [🟠] [ACTIVE] [COORDINATOR] ACTIVE · F052-context-by-reference

Every non-wake coordinator turn re-attaches the full bodies of `spec/vision.md`, `spec/build.md`, and `.agents/limen/styleguide.md` — up to 1000 lines each, hidden from display, duplicated across the whole session. Compaction then drops those copies silently, and nothing tells the model to go get them back. One law replaces the inlining: **refer, don't attach.** The project-context message becomes a short important-note section that names the governing files and the moments their contents must be in context. Because the note rides on every user message, the obligation itself survives compaction even when the file contents do not — the model is told, freshly and cheaply, to read what it no longer holds.

## Outcome

The `limen-project-context` message attached after each user message carries pointers and presence rules, not file bodies: the vision must always be present in the interaction and loaded before any touch of the feature specifications; the styleguide must be loaded before writing or modifying feature specifications and be in context whenever files are modified; the build board holds the current state of work and is consulted before selecting, starting, or reporting it. The note instructs re-reading after compaction and whenever work has landed since the last read. Advisories, drift notices, the inherited shop manual, and the speech register are unchanged.

## Scope

- Replace the three inlined file sections in `hook/communication.ts` with a governing-files note: one line per file — path plus its presence rule — listing only files that exist at the context root. A missing `spec/build.md` keeps its existing advisory.
- New framing header stating the contract: files are referenced, not attached; having their current contents in context is the agent's responsibility; re-read after compaction or when stale.
- The note resolves from `LIMEN_CONTEXT_ROOT` like the bodies did, and is re-evaluated every turn, so a file planted mid-session appears on the next message.
- Shop-manual inheritance, build-board advisory, guidance drift, wake-prompt skip, and the speech register keep their current behavior byte for byte.
- Update the two shop-manual sentences that promised injection (`supplies it to every role`, `1000-line injected limit`) to name the read-on-demand contract instead; update the README sentence.
- Update the communication-hook tests: pointer lines asserted present, file bodies asserted absent, per-turn freshness proven by a file appearing between turns.

## Out of scope

- Attaching the note to wake prompts (they stay lean; the wake is a pointer, not the work).
- Any enforcement or gating of reads — the note informs; nothing verifies or blocks.
- Worker and reviewer preambles, steering, task delivery, or the communication register mechanics.
- Caching, hashing, or change detection of the referenced files.

## Acceptance

- A turn in a project with all three files attaches a message containing the three pointer lines with their rules and none of the three bodies; customType, display, and tag framing unchanged.
- A turn before `spec/vision.md` exists omits its line; the turn after it is written includes it.
- With `LIMEN_CONTEXT_ROOT` set, the note lists files from that root while running in a worktree that has none.
- A wake prompt still attaches no project-context message and still appends the register.
- Shop manual still inlines when the project has no `AGENTS.md`; drift and advisory sections render exactly as before.
- The full hook suite and structure test pass.

## Notes

The compression is real but the deeper change is behavioral: the coordinator stops being handed context it never asked for and starts owning what it holds. Inform, don't gate — if a future session shows the rules being ignored, the fix is sharper note language or a worker-visible advisory, not a mechanism that blocks turns.
