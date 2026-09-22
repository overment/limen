# F727 · Pi and OMP share one engine profile

## Outcome

Adam can approve an engineering spec for running Limen jobs on Pi or OMP behind one flag, without a Claude-style dual harness. No engine implementation lands unless the spike is trivial and this spec says implement-now.

## Scope

- Spike: identical tiny prompts under installed `pi` and `omp` (`-p --mode json` or the documented print/json equivalent). Diff argv, JSON event stream, and session files. Verdict: shared parser OK, adapter needed, or incompatible.
- Spec: public flag/env (`--engine pi|omp` and/or `LIMEN_ENGINE`), profile table fields, exact argv mapping, stream handling, preflight/auth, continue/resume, docs/tests, non-goals.
- Change list: Limen files to touch, shared vs profile-only, acceptance, risks (Herdr, sessions, models).
- Recommendation: one paragraph — ship profile table, need event adapter, or not worth it yet.

Write the notes and spec in this feature folder. Do not merge a full engine onto main.

## Out of scope

- Implementing `--engine omp` on main unless the spike is trivial and the spec says implement-now.
- Restoring Claude. GitHub doorbell. Unusable-route refusal.

## Acceptance

- Spike notes name the commands run, the event-type overlap, and a clear parser verdict.
- Spec lists profile fields and argv mapping a worker could implement without inventing a second wrapper.
- Recommendation is one of the three options, with the spike as evidence.
- Typecheck clean; no required runtime change.

## Notes

OMP docs: https://omp.sh/docs (cli, rpc, sdk, providers). Repo: can1357/oh-my-pi. Current Limen launch (wrapper): `pi --mode json --approve --no-extensions --session-dir … --name … --append-system-prompt …` plus provider/model/thinking; binary `LIMEN_PI` / `pi`. Stream parser keys: `tool_execution_start`, `tool_execution_end`, `message_end`, `agent_start`, `turn_start`, `message_start`, `message_update`.
