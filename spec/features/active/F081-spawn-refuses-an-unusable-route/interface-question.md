# Unusable-route refusal remains blocked; hosted transport is a safe partial

The auth-ready batch-only regression in `test/spawn-command.test.ts` deliberately remains failing, not skipped or converted into an authentication failure. Spawn returns status 0, creates a job/worktree, and the fake provider rejects the first turn with `404 model is only available through the Batch API`. The test requires status 1, that reason, and no planted records. No production route refusal was added.

## Installed interface

Inspected Pi 0.84.2 at `/home/overment/.nvm/versions/node/v24.19.0/lib/node_modules/@earendil-works/pi-coding-agent`:

- `pi auth check --help` supports `--provider`, `--model`, `--json`, `--credentials`, and `--no-refresh`. It refreshes expired OAuth credentials by default. Do not use `--credentials` for preflight.
- `dist/cli/auth-check.js:checkProviderAuth` resolves the model, then discards it except for its provider ID. `checkAuth(provider)` and optionally `getAuth(provider)` determine readiness. `createAuthCheckModelRuntime` disables model-network refresh. No inference route is called.
- `docs/sdk.md` defines `getAvailable()` as models with authentication configured. `PromptOptions.preflightResult(true)` means accepted/queued/handled; later provider failures are events, not preflight rejection. Calling `prompt()` runs a generated turn, including Pi-owned retries.
- `dist/core/model-runtime.d.ts` exposes catalog/auth operations and generated `stream`/`complete` operations, but no non-generating model-route validation method.

Question for the owner: should this wait for a Pi-supported non-generating probe that validates the exact resolved model/provider/API endpoint and returns its refusal reason, or is one generated preflight turn per spawn authorized? Recommend waiting for that interface. If generation is authorized, specify token/spend and latency limits and how Pi-owned retries count against them; no such spend was authorized or performed here. Catalog/auth readiness must not be represented as route proof.

## Safe transport seam

`src/supervisor.ts` already passes fresh hosted tasks as `@task.md` and the preamble as a file path. Continuations alone read the whole instruction into a shell argument. They now pass `--continue @<job>/continue`, using Pi's existing file-argument transport, without changing detached continuation.

Installed `dist/cli/args.js` treats `--continue` as a boolean and `@file` independently. `dist/cli/file-processor.js` reads text bytes and wraps them in `<file name="...">`; the continuation therefore arrives as attached text rather than a bare message. Session selection and literal provider/model/thinking flags are unchanged.

The hosted regression uses a fake Herdr that refuses CR/LF in agent argv, checks both fresh spawn and continuation become agents, and checks quotes, backticks, command substitution text, and newlines stay in the referenced files. It failed before the change on continuation with the reported shell-encoding reason. It does not prove a live Herdr/Pi model turn.

Evidence is retained outside the worktree at `/home/overment/limen/tmp/evidence/f081-3241d718/`. Read its candidate/checks records for exact command results. No private config/credential edits, provider substitution, generated probes, new retries, F090 dependency, or board changes belong to this partial.
