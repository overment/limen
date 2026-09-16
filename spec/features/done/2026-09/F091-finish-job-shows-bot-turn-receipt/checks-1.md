# Finish transport inspection: partial landing evidence

Candidate `a4cba17bb335a9ee77c1b5b42a0038019773aa4f` landed as `2dabae76b5b13747f3a5fd502ff2e8ea38f22095` after coordinator inspection under Adam's delivery instruction. This is a partial product landing, not a completed feature or an Adam review verdict. No independent reviewer was spawned.

Evidence: `/home/overment/limen-evidence/f091-5932f3a5/`. The coordinator retained the exact binary candidate diff there as `candidate.patch` and inspected the terminal job record, final session messages, complete diff, native output and two-target inspection artifacts.

- Worker focused checks passed 138/138 at the clean candidate.
- Coordinator typecheck and helper/lifecycle/receipt/finalization/jobs/view/structure checks also passed 138/138; `coordinator-focused.log` and `coordinator-focused/` retain output and synthetic artifacts.
- Full native lane ran once: TypeScript/Biome passed, 377 tests passed, one registry-lock test cancelled after 60 seconds, exit 1. No full rerun or unrelated repair; cause remains unproven.
- Real helper fixtures preserved HTTP 2xx acceptance alongside 5xx rejection or a stalled target, omitted secrets in both views, and sent no additional request on repeat finalization. All transport was intercepted; no real receiver was contacted.

## Superseded implementation gap

At the transport landing the CLI had no path from unobserved to observed completed bot turn. The receiver-evidence candidate documented in `notes.md` supersedes that gap with bounded operator-selected file exports and both-view offline checks. This historical check record proves only the transport candidate, not the receiver-evidence candidate or actual receiver turns.

Current operational requirement supersedes the original Mac-only/two-receiver boundary: one authorized VPS hosted job delivers automatically to Johnny alone. Johnny controls processing or genuine-export hold/release, preserves real history and the exact `finishEvent`, and sends no second request. Export hold proves unobserved inspection, not absence of an actual turn. Mac is optional; synthetic records do not satisfy live proof. See `docs/finish-webhooks.md` for both control options and their distinct attestations.

No outcome file or PROVEN mark is earned. The new inspection capability does not waive live receiver proof or Adam's review. Operators should note the documented 64-target selection limit and added automatic `finishEvent` payload field. Private configuration and production receiver contracts were not inspected or changed.
