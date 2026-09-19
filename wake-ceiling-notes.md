# Native wake attempt ceiling

`hook/wake.ts` shares the existing allowance across subscribers and fallback for each job notification kind. A successful confirmation no longer erases prior failures. Outstanding claims reserve the remaining allowance, so concurrent subscribers cannot queue more failures than the ceiling permits; successful fan-out proceeds as claims confirm.

`notify/unconfirmed/_completion` and `_advisory` now contain an append-only sum: each unsuccessful attempt appends `1`. Existing scalar `1` / `2` files still work. The claim's exclusive `unsuccessful` marker prevents competing recovery paths from charging the same claim twice. At two failures, the claim remains under `notify/claims` with `blocked`, and the job log plus coordinator notification explain that automatic delivery stopped.

`src/supervisor.ts` owns advisory rearming. Its existing `clearHostedAdvisory()` cleanup on resumed work also removes the advisory allowance, without touching completion exhaustion. An unchanged stall, hook reload, new subscriber/fallback listener, or late success cannot reset the allowance.

Deliberate recovery: stop/mute affected listeners, preserve the claim and job log as evidence, remove the affected kind's exhausted claims and `notify/unconfirmed` file, then resume listening. Do not remove subscribers or invent a delivered marker. Quota handling and provider selection remain operator decisions; no provider retry configuration changes here.

Re-applied on current main. Do not merge the locked candidate `0fa48fa`. Adam owns review.
