# F092 · Finish webhook names are bot-agnostic

## Outcome

Operators configure finish delivery without any `TONY_*` key names. Single-target
and env-path selection use `LIMEN_FINISH_WEBHOOK_*`. Old `TONY_*` names are gone
from code, docs, and tests — not kept as permanent aliases.

## Scope

- `bin/tony-finish-ping.sh`: read `LIMEN_FINISH_WEBHOOK_ENV`,
  `LIMEN_FINISH_WEBHOOK_URL`, `LIMEN_FINISH_WEBHOOK_AUTH` (and keep
  `LIMEN_FINISH_WEBHOOK_TARGETS`). Remove reads of `TONY_FINISH_WEBHOOK_*`.
  Log prefixes must not say `TONY_FINISH_WEBHOOK`.
- `src/finish-webhook.ts`: pass `LIMEN_FINISH_WEBHOOK_ENV` into the helper;
  accept only that name from the process environment for overrides.
- Docs (`docs/finish-webhooks.md`, README links): agnostic names only; note that
  the helper binary may still be named `tony-finish-ping.sh` this slice (rename
  optional follow-up) but keys/docs are cleared.
- Tests: `test/finish-webhook*.ts` use `LIMEN_*` only.
- Migration note in docs: existing private env files must switch to
  `LIMEN_FINISH_WEBHOOK_TARGETS` or the new single-target keys; `TONY_*` stops
  working when this lands.

## Out of scope

- Renaming the helper filename / home launcher path (optional F09x follow-up).
- Changing webhook payload shape or receiver contracts.
- Inventing bot APIs or storing credentials in the repo.

## Acceptance

- A config that only has `LIMEN_FINISH_WEBHOOK_URL` + `_AUTH` sends successfully.
- A config that only has `LIMEN_FINISH_WEBHOOK_TARGETS` sends successfully.
- A config that only has legacy `TONY_*` keys fails closed with a clear message
  naming the new keys (no silent fallback).
- Focused finish-webhook helper + lifecycle suites pass. Adam reviews.

## Notes

Adam lock 2026-09-11: clear `TONY_*` out; limen → Johnny, alice/api → Tony via
agnostic keys. Private envs already migrated to `LIMEN_FINISH_WEBHOOK_TARGETS`.
