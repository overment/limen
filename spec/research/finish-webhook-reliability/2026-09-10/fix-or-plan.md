# Finish-webhook repair boundary

## Implemented in this branch

Automatic finish delivery now prepends the directory of Limen's running Node executable to the sender PATH (`src/finish-webhook.ts`, runtime fix commit `a777385`). This removes the reproduced automatic exit 127 when the inherited PATH cannot run Node. The canonical helper, three-field `{job,status,branch}` payload, private config selection, once-only claims, deadlines, and no-retry behavior are unchanged. The installed package must be updated to use the fix; this worker did not install or merge it.

`docs/finish-webhooks.md` now distinguishes malformed local auth, HTTP ingress rejection, a downstream routine auth failure, absent opt-in, partial fan-out, and unobserved wake. It includes a no-send manual launcher preflight and explains why changing a webhook key cannot be assumed to repair a routine's provider login. Regression tests cover the runtime failure and ensure receiver error text never becomes a sender diagnosis or wake acknowledgement.

## Operator-owned repair

1. **Correlate the reported Grok run before changing credentials.** Locate “Limen coordinator finish ping” around `2026-09-10T08:30:28Z`, with payload label `openrouter-websearch-timeout` and status `done`. The corresponding Alice helper reported HTTP 200. Obtain the receiver run address, failing step, and sanitized error class. If it is the same run and ingress accepted, repair that step's account/provider/integration authentication, not the ingress key by default. If the actual ingress receipt is 401/403, verify the authorized route and refresh its webhook credential privately.
2. **Fix manual service PATH where needed.** The home launcher is intact; `/usr/bin:/bin` cannot find this Mac's NVM Node. Add the actual Node 24+ directory to the invoking service or shell, then run the documented zero-argument preflight there. Do not copy secrets, change global recipient routing, or assume the automatic fix repairs standalone manual calls.
3. **Opt in projects deliberately.** Alice app/API and Limen are still opted out. Use the private project recipe in `docs/finish-webhooks.md` only after the operator confirms the intended receiver route(s). Preserve mode 600 and ignore rules, inspect a fresh job's `finish-webhook-env`, and do not retrofit historical jobs or inject the home destination globally.
4. **Close the wake evidence gap.** For the one controlled final ping, record its HTTP result separately from a matching completed turn in the intended bot. A run ID or HTTP 200 is insufficient. Do not retry an accepted or ambiguous send merely because a local history search cannot see the remote receiver.

## Question for Adam / receiver operator

Can you provide the failed Grok routine's run address and failing step for the 10:30 Warsaw alert, and confirm whether its payload label was `openrouter-websearch-timeout`? The local evidence points to downstream authentication after an accepted request, but cannot identify which credential needs repair. No new endpoint, token rotation, or receiver-side code change is justified without that correlation.

The authorized final ping at `2026-09-10T09:14:18Z` exited 0 with HTTP 200; the bot turn is still unobserved. Do not send it again without checking the receiver. `findings.md` records the 73 passing focused tests, the full native lane's single line-budget failure, and the passing targeted recheck after removing a comment. The full native lane was not rerun. Remaining scope is receiver correlation/authentication repair, deliberate project opt-in, and observed bot-turn proof; none is silently marked fixed by the sender change.
