# Receiver-export inspection: product landing, Mac proof outstanding

Candidate `ab33fd170500844e93e0999db12ffdf82cb329a8` landed as merge `87dd357cde8740cb5b129ee909cc42129eb88b0a` after coordinator inspection under Adam's delivery instruction. No independent reviewer was spawned, no Adam candidate-review verdict is claimed, and the feature remains ACTIVE pending the required Mac proof.

Evidence root: `/home/overment/limen-evidence/f091-51bb62b9/`.

- `candidate.patch` matches `git show --binary --format=fuller ab33fd1` byte-for-byte. Coordinator inspected the complete diff, job/session commands, clean worktree, raw logs and both CLI views in retained offline artifacts.
- Worker focused checks passed 121 before commit. At the clean committed candidate, coordinator typecheck and all 121 helper/lifecycle/receipt/finalization/jobs/view/structure checks passed (`coordinator-focused.log`).
- `coordinator-offline/` retains accepted/no-export, one matched/one mismatched export and two matching exports in both views. Rejected/stalled transport remains independent; repeated finalization keeps the request count at two. These are synthetic receiver records, not actual bot turns.
- Negative checks reject unselected/relative sources, local flags, invalid maps, wrong event/target/receiver, non-completed turns, unsafe references, malformed/oversized/nonregular/symlink files and extra fields. The 84-line reader adds no network calls, polling, writes or finalizer waiting; the source budget explicitly rises to 4010 for 4006 actual lines.
- Full native lane ran once at the clean candidate: TypeScript/Biome passed; 368 passed, one failed, one cancelled, exit 1 (`native.log`). The registry-lock test at `test/sweep-command.test.ts:50` exceeded 60000ms. The warm-sweep check at `test/wake-sweep.test.ts:60` measured 28.217ms against its 20ms limit, despite zero settled-record reads. Neither cause was established, neither failure was repaired or rerun, and the full lane is not green.
- Coordinator clarified the runbook's watch command: only a Pi coordinator can create that subscription; Johnny outside Pi follows the named job through inspection and durable records, without inventing a session ID. This is a documentation-only correction after the runtime landing.

The implementation worker's automatic VPS receipt records one configured target accepted with HTTP 2xx at `2026-09-11T22:29:07.704Z`. Its event is `limen-finish-dde63db51430f5a0115c02eed3e91d972d491bdfe6c920799a1f48172ef28b32`; no completed receiver turn was verified and no manual ping was sent. This receipt is not Alice Mac proof.

Observed means a correlated completed-turn export was read from the operator-designated source, not authenticated origin or independently verified history. Johnny must obtain actual receiver exports through an authorized channel and follow their references for the live proof. The exact file contract, offline harness and Mac procedure are in `docs/finish-webhooks.md`; no outcome file or PROVEN mark is earned yet.
