# F036 outcome · short agent names, role descriptions

Landed at `554e3c9` (2026-08-21, coordinator-written, suite-covered). `hostedAgentName` emits `limen-<fnnn>-<hex>` for feature jobs (slug+hex fallback otherwise); the worker hook reports `--display-agent "limen worker|reviewer"` at session start, with spawn passing `LIMEN_ROLE`.

Proven live 2026-08-21 on job `2026-08-21-f036-naming-try-53de86f2`: agent name `limen-f036-53de86f2` (hex intact), `display_agent: "limen worker"`, tab label carrying only the feature title — no triple repetition in the sidebar.
