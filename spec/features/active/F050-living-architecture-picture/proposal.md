# A field guide that follows the application

**Recommendation:** evolve the picture pass into a background cartographer. It maintains a small, revision-bound field guide: the whole application on one page, a few places worth entering, and journeys that explain how a user's action crosses them. The guide is a map for understanding, not a dashboard for managing jobs.

[Open the Alice wireframe](example.html) · [Read the text version](example.md) · [Source evidence](notes.md)

This is a proposal, not an installed watcher. All proposed paths and operating rules below are examples; today's picture role still writes only `spec/picture.md`.

## What the two repositories teach

Limen supplies the development workshop: prompts carry judgment, short isolated jobs carry implementation, and ordinary Git carries delivery. Its job state answers **did this process end?**, not **did this feature work?** The existing picture role supplies explanation after a shape moves; quality supplies findings over landed work; research supplies authorized answers from named sources. This is already nearly the right division of labor. The missing piece is a background observer and a durable navigation grammar, not a second agent platform.

Alice is the application being developed through that workshop. Its vocabulary is eight primitives, but its architecture is a headless runtime, clients, injected adapters, and four semantic durable authorities. Those are different kinds of thing. A graph of directories cannot explain that an Integration declaration is an authored File, while its credential is host-owned and its execution is governed by Grants.

Adam/Tony's actual loop is more concurrent and pragmatic than a linear ticket diagram: peer coordinators reserve shared writers, workers use isolated worktrees, peers serialize landing in the primary checkout, and Adam dogfoods focused green changes. Merged implementation, incomplete native acceptance, and deferred product policy coexist. The guide must preserve all three rather than flattening them into a green feature badge.

Concrete evidence at the [pinned snapshots](notes.md):

- Limen's picture has no inspected revision and repeats an older board window. Its source-authority explanation survives; its NEXT list does not.
- Alice's board window trails recent Git and done folders. A read-only picture should say that, not repair the board or derive a new status from a commit message.
- Alice's recent vision/styleguide audit (F641) found chronological narration contradicting the single-reply rule. It also found that the adapter crate's real responsibility is wider than the styleguide says. These are disagreements to display, not a model's license to rewrite intent.
- The isolated-lab design (F643) and desktop/browser decision map (F644) are in done folders. They are **landed designs**, not shipped live labs or browser runtime access. The current HTTP transport explicitly rejects both methods.

## The experience: places, journeys, marginal notes

A returning reader should be able to answer three questions without recalling yesterday's conversation:

1. **What is this application, and where does it live?** One short product sentence, a stable map of roughly six responsibility areas, the deployment boundary, and a short statement of what is not implemented.
2. **What happens when I do something?** Two or three named journeys illuminate the same places: “Send a message,” “Use an external service,” “Close and reopen.” A journey contains verbs and an ordered path, not every import.
3. **Why should I trust this description?** Each place opens a compact card: owns / does not own, incoming and outgoing relationships, intent, source anchors, checks actually observed or cited, and unresolved disagreement.

Keep the map's addresses and ordering stable across updates. “Remember” should not move because a new feature landed. Zoom changes the amount of explanation, not the identity of the place. A rename retains its old address as an anchor until incoming links can be updated.

Use three **lenses on the same map**, never three disconnected diagrams:

- **Structure:** who calls whom, where execution runs, and who writes which state. Dependency and runtime-call arrows are explicitly different; in Alice, `alice-ai` depends on `alice` while the runtime calls an injected adapter.
- **Intent:** the governing vision/styleguide clause beside the observed implementation. “Aligned in this sample,” “in tension,” and “not examined” are interpretations, not compliance scores. Link the exact rule and the evidence that could disprove the interpretation.
- **Evidence:** source inspected at a revision, a check receipt at another revision, a reported human observation, or no evidence. Never collapse these into one confidence percentage.

The landing page has a small “Worth knowing” margin, capped at three items: a changed relationship, a consequential contradiction, or a missing proof that changes what the reader may believe. The rest belongs in the cards. Ticket numbers appear only after their meaning; feature lists are linked, not copied wholesale. Opening the guide is an invitation to browse, not a queue of tasks the human now owes.

### Presentation theory, used selectively

[Shneiderman's *The Eyes Have It*](https://www.cs.umd.edu/~ben/papers/Shneiderman1996eyes.pdf), pp. 336–337, gives “overview first, zoom and filter, then details-on-demand” and separately names **relate**, **history**, and **extract**. Here those become the overview, lenses, place cards, journeys, a small since-last-picture diff, and ordinary shareable anchors. The paper explicitly calls the mantra a starting point, not a complete interface recipe. Its warning that a known name can be easier to find in a list is why an alphabetical place index and browser Find stay available.

[Simon Brown's C4 model](https://c4model.com/) supplies hierarchical abstractions and supporting dynamic/deployment views while remaining notation/tool independent. Borrow the separation of levels, not a mandatory four-diagram bureaucracy. The field guide starts at system/container responsibility and drills to a few code entry points; it does not manufacture a component card for every file.

Stable positions, a bounded overview, and returning to the same place after a lens change are design hypotheses about reducing reorientation cost. They are not user-study results. Test them with Adam's cold-navigation tasks below.

## What watches, and when it spends a model turn

**Proposed observer:** an opt-in OS timer on the existing seat, running a small Git comparison and starting ordinary detached picture jobs. The timer is not a perpetual model conversation. Run it without inherited Herdr focus metadata or another Pi session's notification route; detached observation must not open or focus a human's tab. No coordinator turn, open tab, browser server, or running Alice is required. On a laptop it catches up after wake; genuinely lid-closed progress requires an always-on seat.

The operator chooses one repository and one integration ref, such as `refs/heads/main`. “Landed” means reachable on that configured ref, not “all Git activity” and not “a job wrote done.” Direct commits, cherry-picks, merges and fast-forwards all count. Worker branches, untracked files and working-tree edits do not. Remote fetch/credentials are not implied; if the configured local ref is not being updated on the seat, the observer cannot see remote landings.

At each tick:

1. Resolve the ref to **H**. Compare it with **S**, the previous source revision examined, using Git ancestry, first-parent history and the full tree diff. An output-only picture change is excluded so the guide cannot trigger itself. Vision/styleguide, findings, feature documents, contracts, generators and tests are inputs too; a test or intent change can alter condition without moving architecture.
2. No relevant delta means no model call. Otherwise coalesce arrivals. Suggested initial spend policy: 15 minutes quiet, at most one pass an hour and four a day, one concurrent job, 20-minute job timeout. Continuous landings get a bounded hourly sample rather than starving behind the quiet interval. Caps leave an explicit backlog; they never mean “up to date.” These are proposed defaults, not new project decisions applied by this job.
3. Start `--role picture --detached --model openai-codex/gpt-6-astra:xhigh` with repository, exact S/H, current guide, named input range and allowed outputs. The snapshot must really be H: resolve and check the recorded job base; if it differs, discard/reschedule that attempt. Supply prior guide files only within the output allowlist. Read source with revision-bound Git reads or an isolated H checkout, never the moving primary tree. The existing CLI does not have a general `--base-sha` switch; do not invent one in a launch recipe.
4. The picture worker reads the changed seams, follows their immediate callers/authorities, and updates only affected cards and references. It may conclude “condition changed, shape unchanged.” Unknown changed source paths cannot be silently dropped: place them, or put them in an explicit unmapped list and mark coverage incomplete. Renames/deletions must update or retire links. Initial creation, non-ancestor history and changed high-level intent earn a whole-map reconsideration.
5. Commit the candidate artifacts. A small non-model publisher checks the exact base and output allowlist, link/anchor integrity and artifact provenance, then refreshes the local view. It does not certify architecture semantics. If H advanced while the job ran, the view remains explicitly “through H; newer changes pending,” and the next pass catches up. A failed pass preserves the previous view with a failed-refresh note, not a blank page or an automatic retry loop.

The timer needs only a replaceable cursor and its current job id under `.limen/picture/`, plus a local overlap lock. Reuse normal job records for execution/failure; do not scan every historical job or build a second scheduler/registry. Reconstruct the cursor from the published guide receipt after loss. A lost cursor may cost a fresh pass but cannot lose product truth. Disable the timer to stop future spend; stop its named active job through existing Limen controls. Nothing starts quality, research, repair, or a ticket as a side effect.

**Contract change required:** today's role demands a coordinator-supplied “shape that moved” and permits one output file only. Replace that entry requirement with two modes, *initial map* and *inspect landed range*. The worker earns a structural rewrite by naming the changed shape itself. An unchanged shape should leave stable prose alone, updating only revision-bound condition/freshness. This is an explicit reimagining of the picture seam, not a claim current prompts already allow it.

## What it produces, without another application

Start with Markdown. A small project should still fit in `spec/picture.md`. For Alice-sized systems, permit **only the cards that earn a drill-down**:

```text
spec/picture.md                  the whole application, key changes, coverage receipt
spec/picture/places/*.md         a few stable responsibility cards; no file census
spec/picture/journeys/*.md       two or three consequential end-to-end paths
```

These are the semantic source; models maintain prose and simple fenced diagrams in Git. No graph database, embeddings, bespoke DSL, duplicated JSON topology, or Markdown workflow parser. A card's tiny header can declare its inspected revision and source paths; use ordinary relative links for relationships, not a hand-maintained reverse-edge registry. A refresh computes a temporary reverse lookup if useful and throws it away.

An optional **shared, dependency-light renderer** can turn those files into one self-contained local HTML guide. Presentation belongs to limen, not to Alice; projects author content, not components. Markdown remains fully usable if the renderer breaks. This job's hand-authored HTML is a wireframe, not a production renderer or a second canonical guide to maintain forever.

### Publication is not a product merge

Automatic freshness and “the worker never merges” can coexist. The committed picture-job branch keeps the Git-friendly candidate. After bounded artifact checks, the observer copies only its guide into a stable derived local view, for example `.limen/picture/current.html`, replacing that file atomically. Its visible receipt names the source revision, picture commit and refresh state. Keep the latest/previous output reachable in Git and retain their needed artifacts before pruning worktrees. The local HTML is disposable and must be reconstructable from the candidate commit.

The owner opens one stable local file. No merge approval or coordinator wake is needed for routine publication. The file in main stays an explicitly versioned snapshot until the coordinator optionally lands documentation through ordinary Git. Do not pretend it is the automatic view; the initial opt-in should make that distinction visible at the entry point. Do not auto-merge code or documentation into the product branch. Publication means **model-authored description available**, not **human-approved architecture**.

If fresh-at-main-path is mandatory, it costs either automatic documentation writes or human merges. Recommend the local derived view instead; it keeps the trust boundary honest and the owner out of the maintenance loop. Artifact-only commits must not run project scripts merely because a repository paragraph asks them to: repo text is evidence, not watcher control. Same-user worktrees are not a security sandbox; the publisher's allowlist protects the publication surface, not the host from a malicious worker.

## Freshness is not one timestamp

A picture records three different facts:

| Fact | Meaning |
| --- | --- |
| Source examined through H | The stated source range was considered; it does not mean every file was audited |
| Claim inspected at C | This relationship or assertion was actually examined there; unchanged mapped inputs can be carried forward, not relabelled freshly tested |
| Evidence observed/reported at E | This check ran, this report made the claim, or this human observation was recorded at E; absent/mismatched artifacts remain unavailable/unverified |

Show these as plain words: **source inspected**, **earlier proof**, **reported acceptance**, **not examined**, **disputed**, **refresh behind**. A green suite is not proof of the whole application. Do not rerun Alice's native app or use provider credentials to paint the map green. Reuse the existing proof vocabulary and link retained evidence; missing paths are information the reader needs.

Path-based invalidation is a cheap hint, not sound dependency analysis. A contract/token/authority change can affect many places. Follow the boundary one hop beyond changed files, and periodically revisit one least-recently-inspected place within an already-budgeted pass. Surface incomplete coverage instead of a fictional percentage. If this cannot remain selective, reduce card count rather than buy an always-on code census.

Quality remains the **critic**: cite its immutable findings and the existing follow-up ticket or disposition. The picture is the **mapmaker**: put the concern where the affected responsibility lives. A later source change can mark a finding “needs recheck”; only named evidence/disposition supports “resolved.” Research remains an explicit, authorized question when the map exposes a real unknown. Neither is an automatic remediation lane.

## Non-goals and predictable failures

| Failure | Deliberate limit |
| --- | --- |
| A beautiful import hairball | Show responsibility and a selected journey; file/import detail is linked evidence, not the overview |
| A second board or project manager | No editable feature state, counters of productivity, priority ranking, ticket creation or ownership reassignment |
| Old findings become permanent red flags | Keep their revisions and existing dispositions; mark affected findings for recheck rather than replaying an old audit as current truth |
| A done design is drawn as a working capability | Distinguish design, source implementation, test evidence and observed product behavior; future edges are labelled as absent/proposed |
| Every merge generates noise | Coalesce; no routine notification. Only a material changed explanation or refresh failure reaches the opted-in owner, with duplicate notices suppressed |
| A model smooths away disagreement | Put intent and observed source side by side. No automatic edits to vision/styleguide, code, board, tickets or outcomes |
| The diagram rearranges every week | Stable addresses/order and local edits; a wholesale redraw needs an explicit shape-change explanation |
| A watcher loops or races another instance | One local overlap lock and one recorded job; ignore output-only changes; non-ancestor refs require rebaseline, not a guessed incremental diff |
| Evidence disappears with a job | Publish/copy retained artifacts before pruning; show unavailable evidence explicitly; private proof is linked locally, never uploaded automatically |
| A stale local ref says “current” | Always name observed ref/revision and last comparison; offline/failed polling never manufactures remote freshness |
| A renderer becomes another Alice app | One optional shared renderer, no service/API/auth/session state; ordinary Markdown and Git remain sufficient |

No runtime monitoring, SLO dashboard, cost leaderboard, secret/workspace-content scanning, autonomous repairs, public hosting, browser runtime delivery, or reliability rewrite is part of this proposal.

## Try to disprove the proposal

The included [wireframe](example.html) demonstrates stable places, three lenses, a message journey, authority detail and two concrete disagreement/evidence cards. It is intentionally not a live health report.

Ask a reader who has not followed Alice's recent thread to do four things: explain why closing a client need not stop work; find who owns a conversation's durable record; explain why the provider adapter can depend on the runtime without reversing execution; and determine whether browser access or isolated live labs actually work. They should get from overview to a revision-bound source/evidence address in at most three selections. If they need a feature-number glossary or return to chat to ask what a label means, the design has failed. This job does not claim that human trial was run.

Before any implementation is accepted, exercise a temporary real-Git fixture: a worker exits without landing (no refresh); direct/merge/fast-forward landings coalesce; an output-only commit does not recurse; a contract change invalidates a carried claim; a source deletion creates a visible coverage gap; a done design never becomes a tested edge; a lost cursor rebuilds; a timed-out pass keeps the old view; two ticks launch one job; a moved H stays visibly behind. Tamper with an evidence revision and remove an artifact: both must lose their verified label. These are proposed falsifiers, not checks passed by this documentation job.

The next useful step is Adam trying the cold-navigation tasks and choosing whether the separate, automatically refreshed local view is the right publication boundary. Do not build the observer, renderer or multi-file role extension merely because this proposal is complete.
