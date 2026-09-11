# Proposal and wireframe checks

The scoped source/browser checks passed. The full Limen check is incomplete with three reported test failures, not green. No Alice test or native-app run was performed.

Candidate: `a3f5d100f86457d164b39ac8784e619bb7dd1949` (proposal, evidence map, Markdown guide and HTML wireframe). The final filing commit adds only this check record and Tony's handoff; it does not change the checked example.

Retained evidence outside the worktree: `/Users/overment/.overment/limen/tmp/evidence/F050-study/`. `guide/example.html` is the copied, directly openable sample; `candidate-visual/` contains the clean-candidate frames and machine-readable checks. The initial dirty-tree run is separately retained under `visual-1/` and is not substituted for clean-candidate evidence.

## Discriminating checks

The most fragile claim is that the picture distinguishes **source shape, intent, a landed design and actual proof**, rather than drawing plausible future capabilities as working ones.

The dependency read disproved an initial draft assumption: `alice-ai` depends on `alice`, but `alice-code` does not. The host's `HostCodeRunner` bridges the latter. Both example versions were corrected before the candidate commit. This is why dependency arrows and runtime-flow arrows are different in the proposal.

The retained `check-example.mjs` reads exact Alice revision `fd67336e94bd3a13eb86341c04de265cef5020a2` and drives a separate headless Chrome through its own loopback DevTools endpoint. It has no npm dependency and neither attaches to Alice nor touches its runtime/workspace/credentials. Run from any directory with the candidate checkout path:

```sh
node /Users/overment/.overment/limen/tmp/evidence/F050-study/check-example.mjs \
  /path/to/candidate-checkout /path/to/new-evidence-directory
```

Actual results, both the initial run and clean-candidate run:

- HTTP `request` and `subscribe` explicitly reject as unimplemented. A synthetic change from `Promise.reject` to `Promise.resolve` fails that source assertion.
- Adapter dependency check passes; adding a synthetic `alice` dependency to `alice-code` fails it. The real host adapter implementation is present.
- All 38 internal HTML links resolve; all 13 revision-pinned source links resolve through local Git. Sibling document links resolve. The page has no script, iframe, image, CSS import or URL subresource.
- Six places retain identical measured geometry in Structure, Intent and Evidence. All three overview frames have different hashes and visible different text. Each card is 225px high at the checked desktop size.
- Native radio keyboard behavior passes: ArrowRight changes focus and selection from Structure to Intent.
- Journey navigation, source disclosure and authority detail work; the target starts below the sticky header.
- The 390px viewport has no horizontal overflow. The test checks layout, not a complete mobile usability/a11y audit.
- The owned Chrome process exits 0 and its temporary profile is removed.

Browser: Chrome `152.0.7977.77`. Desktop: 1440×1000; narrow viewport: 390×844. The candidate run records clean Git status and the candidate SHA in `candidate-visual/checks.json`.

### Opened frames

All six frames were opened for both runs, including the clean-candidate frames:

- `overview-structure.png`: whole six-place map, boundary note, three-item margin and journey links fit the desktop viewport.
- `overview-intent.png`: the same cards stay in place while rules and two disagreement labels replace structure prose.
- `overview-evidence.png`: the same map instead shows inspected source, reported prior proof, missing HTTP capability and uneven coverage. It does not turn uniformly green.
- `journey-source-trail.png`: ordered message flow and the expanded source trail are readable together; the explicit no-native-test caveat remains visible.
- `remember-detail.png`: four durable facts and the derived index are separated; the reported restart proof remains visibly distinct from source inspection and unrun native acceptance.
- `mobile-overview.png`: the header, product explanation, snapshot caveat, lens controls and first card fit the narrow column without horizontal clipping. The whole map requires vertical scrolling there.

These checks establish a navigable static wireframe and selected source premises. They do not establish human comprehension, automatic freshness, watcher correctness, full architecture alignment or Alice runtime behavior.

## Native repository lane

- `npm ci`: passed from this worktree's lockfile; 12 packages added, zero vulnerabilities. npm warned about the user's unknown `min-release-age` configuration. No lockfile change.
- Scoped `biome check spec/features/active/F050-living-architecture-picture/example.html`: one file checked, no fixes or findings.
- `git diff --cached --check`: passed before the candidate commit and for the evidence/handoff filing.
- Final documentation integrity: 21 Markdown local/pinned link destinations resolve; all six retained guide files were copied byte-identically. The complete diff contains only six new files under this ticket's folder.
- `npm run check`: invoked **once**, at clean candidate `a3f5d10`. TypeScript completed successfully; Biome checked 69 files with no fixes/findings. The test stage emitted **156 passing and three failing test lines** before the enclosing command timed out at 600 seconds. No final test summary or process exit result was produced. Full output: `native-check.log`.

Reported failures:

1. `diff resolves a pruned job and prints its exact recorded changeset`
2. `diff does not launch hunk without a TTY and fresh jobs record its version`
3. `a clean run writes no stop-reason`

Their causes are not diagnosed here; do not call them pre-existing or fixed. A follow-up process listing found no `npm run check` or `node --test` process, and Git status remained clean. No full-lane rerun or unrelated runtime repair was attempted.

## Research and boundary checks

The pinned source archive contains 27 selected Alice files with SHA-256 hashes; each matched the primary checkout when captured. The source-backed code/outcome links resolve at the pinned revision, not a moving branch. The earlier F580/F595 and recent F652 proof receipt paths were checked for existence only, not validated or rerun. The recent Resources feature has notes but no outcome file; that missing file was not invented.

Public theory sources were fetched successfully and read: C4's official home page and Shneiderman's *The Eyes Have It*, pp. 336–337 (plus the subsequent taxonomy excerpt). Original HTML/PDF, extracted text and hashes are retained in `sources/`. No external source search or recalled API was used to design a watcher implementation; no watcher implementation exists.

No runtime/role/vision/styleguide/board/ticket/outcome edits, Alice writes, independent review, child-worker spawn, upload, public hosting, native app launch, creator-app terminal read/input/focus, or `w98:t1` action occurred. The remote UI skill fetch tool was unavailable; no compliance with its unfetched guidance is claimed. Tony was not a named live route in the inspected agent list; the prepared tip must be forwarded by the coordinator rather than sent to an unidentified pane.
