# Wake ceiling candidate: native proof correction

Candidate `a4772851e74870e784544eef58800f6771a56cd9` implements the two-attempt native wake ceiling. Coordinator inspection read the complete diff, terminal job record, final session messages, and retained evidence; this is not Adam's review.

- Focused wake suites passed 64/64. Installed Pi replay recorded exactly two user wakes, assistant errors, provider calls, and settlements; exhaustion survived extension reload with no delivery receipt or third wake.
- The retained patch matches `git show --format=fuller` of the candidate. Evidence: `/home/overment/limen/tmp/evidence/f090-a3fd5657/README.md`.
- Full `npm run check` passed TypeScript/Biome and 386/387 tests. The failure at `test/steer-command.test.ts:74` compared job-directory snapshots; only `pid` disappeared.

## Blocking proof finding

The checklist requires a green full native lane. The refusal test waits for `state=done`, but `src/wrapper.ts` writes terminal state before removing `pid`. The asynchronous finalizer can therefore remove `pid` between snapshots while `steer` correctly refuses without writing. This ordering is unchanged by the wake candidate.

Correct the test fixture in `test/steer-command.test.ts` to observe finalizer cleanup before taking its first snapshot. Keep the refusal assertion and meaningful snapshot comparison; do not hide PID changes by weakening all snapshots. No runtime finalization or wake-policy change is needed.

One test-only repair is authorized. Prove the refusal test, then run the full native lane once at the new clean candidate and repeat the retained isolated installed-Pi replay against that revision. Preserve the first failure and report any remaining failures rather than repeatedly buying full runs. Adam's review remains pending; the coordinator has not merged the candidate.
