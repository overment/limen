# F021 notes

## `agent list` name field (Herdr 0.8.0, this job)

Named hosted agents expose `name` on both `agent get` and `agent list`. This job:

```
herdr agent get w14:pX  →  name: limen-f021-hosted-stop-real-4844
herdr agent list        →  same row, same name, pane_id w14:pX
```

Unnamed agents (coordinator pi, Claude, Codex) have no `name` field — same as the 2026-08-18 unnamed probe.

The live name `limen-f021-hosted-stop-real-4844` is the pre-F021 truncation: job id suffix `48448762` lost `8762`.

## Name-matching comes out

`liveHostedTarget` matches only the pane just created. `startHosted` recovery probes `target` then `place.pane`, never the agent name. A name hit on another pane is the collision latch (ticket M5). List rows do carry `name` for named agents, so name-matching would work — it is still the wrong key.

## Interrupt spelling

F020 probe: `ctrl+c`. `stopHostedAgent` sends it twice with a 200 ms gap. `stopCommand` calls it once after writing `stop-requested`.

## Wait knob

`LIMEN_HOSTED_STOP_WAIT_MS` (default 15000) is how long `limen stop` waits for the supervisor (or supervisor-dead + agent-missing) before reporting the agent still up.
