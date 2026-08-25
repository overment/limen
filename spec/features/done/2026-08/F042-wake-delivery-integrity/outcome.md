# Outcome

A wake claim is held accepted until the injected user text enters the loop, a non-error assistant message follows, and `agent_settled` confirms. Batched follow-ups all confirm from one assistant turn. A live accepted claim carries a heartbeat so a second window cannot steal it. Footer `setStatus` failures no longer kill delivery. Session start handles advisories before completions. `.limen/last-sweep` is stamped while a coordinator is open.

Implementation `af12f1b`, repair `7e43d23`. Re-review PASS of `7e43d23`. Merged `70eaebd`.
