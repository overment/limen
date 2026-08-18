# F017 live trial — hosted idle is not done

Observed 2026-08-18 while implementing this ticket, before the branch landed.

Job `2026-08-18-f017-completion-handoff-1e3ceecd` (and later `07575ba7`, `ee09c0b3`) was stamped `done` with `hosted idle 90s after tools` while the hosted pi session was still turning. After the stamp, tool-calls kept rising (e.g. 19 → 21; 15 → 26) and the session jsonl mtime advanced. `npm run check` (~2 min, no output) also trips the 90s floor.

That is the F015/F017 failure mode: Herdr unseen-idle is not session end. The suite now covers the fake-Herdr case (`a hosted job finalizes on session end, never on unseen idle after tools`). This note is the live counterpart the ticket asked for.
