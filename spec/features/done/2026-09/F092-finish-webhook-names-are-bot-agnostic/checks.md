# Neutral finish configuration: landing evidence

Candidate `d0eb175670583498df05e3796eea2677c98dd524` was inspected by the landing coordinator and merged as `a76e0ae9b564d540d710189bb3815242d50c71bd`. Adam authorized delivery; no independent reviewer was spawned, and no Adam candidate-review verdict is claimed.

Evidence root: `/home/overment/limen/tmp/evidence/F092/candidate-31c1625f/`.

- `candidate.patch` matches `git diff d0eb175^ d0eb175 --binary` byte-for-byte.
- Worker focused helper/lifecycle suites: 76 passed, zero failures/cancellations at the clean candidate (`focused-candidate.tap`).
- Coordinator reran `npm run typecheck` and `node --test --test-concurrency=1 --test-timeout=60000 test/finish-webhook-helper.test.ts test/finish-webhook.test.ts test/inherit.test.ts`: exit 0, 79/79 passed (`coordinator-focused.log`).
- Full native lane ran once in the worker: TypeScript/Biome passed; 371 passed, zero failed, one cancelled, exit 1. The dead-registry-lock test at `test/sweep-command.test.ts:50` timed out after 60 seconds (`native.log`). Its cause is unproven; no full rerun or repair widened this naming-only slice.
- Post-merge inventory found no retired `TONY_FINISH_WEBHOOK_ENV`, `_URL`, or `_AUTH` literals in runtime code, packaged guidance, README, or setup docs. Retired literals remain in negative tests and generic retirement prose, not operational reads or aliases.

The legacy-only selected-file regression exits 1 naming the required neutral AUTH key before any request. Separate checks prove retired env-path overrides cannot opt in unconfigured jobs or select a file; independently configured canonical selection retains its existing behavior.

No private env inspection/edit, real webhook request, manual finish ping, or completed bot-turn observation was performed. Migration remains operator-owned; the next receipt slice must preserve the new keys and distinguish HTTP acceptance from receiver evidence. The registry-lock timeout remains a native-suite limitation, not a failure reclassified as green.
