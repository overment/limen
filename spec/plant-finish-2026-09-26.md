# Plant finish · 2026-09-26

**Before:** An idle or vanished tool child could leave an OMP/Pi job RUNNING; a `done` finish ping could be mistaken for permission to start another lane; a Herdr badge in one workspace hid the plant's other work.

**After:** Verified stalled children fail and leave evidence, while uncertain ownership stays advisory. Finished jobs keep durable `done` but webhooks send `status: "waiting"`, `jobState: "done"`; subscribed wakes say the branch awaits landing. `limen status` reads job records, Git and Herdr across spaces and labels missing evidence as unknown.

**Checks:** Mac synthetic real-process liveness cases passed 7/7 across hosted/detached Pi/OMP; status cases passed 4/4 and the live plant plate showed one RUNNING job, two working coordinator tabs and 18 unmerged historical branches. TypeScript and Biome on changed code passed. Combined finish/status/wake run passed 164/168; four finish-webhook tests timed out or failed sender timing under the loaded seat, so the full suite is **not green**. Actual provider hangs, Linux `/proc` and a receiver bot turn were not observed.

**Try:** Run `limen status` before another lane, then `limen jobs <id>` for evidence and the branch diff before landing. A configured finish receiver must handle `status: "waiting"` as owner handoff rather than require `done`; HTTP acceptance is not a bot-turn receipt. Merges: stalled-child `59cfb4e`, owner handoff `83f8cd1`, plate `e1a9d2f`, integration `fd267a5`.
