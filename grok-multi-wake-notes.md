# Multi-bot finish delivery (F702b)

The assigned ticket `spec/features/active/F702b-grok-bot-multi-wake/ticket.md` is absent in this worktree. No findings file was supplied. Work proceeds from the instruction: finish webhooks must fan out to two Grok bots on one project, and HTTP acceptance must not be called a wake.

Seam: `bin/tony-finish-ping.sh` owns private config and transport; `src/finish-webhook.ts` owns the once-only automatic attempt and durable receipt. Spawn/continuation already select a project-specific private env path. Preserve those semantics and legacy Tony single-destination configuration.

Candidate contract: optional `LIMEN_FINISH_WEBHOOK_TARGETS` is a JSON array of explicit `{url, auth}` destinations in the selected private dotenv file. It replaces, not appends to, legacy Tony fields. Bot-specific routing belongs in each endpoint URL; Limen sends the existing `{job, status, branch}` payload to every configured target concurrently. Never discover recipients from names or default all bots to Tony. Invalid config fails before any send.

Live-proof blocker: which two authorized Grok Bot wake endpoints consume this payload, and where can the coordinator observe each bot's resulting turn? Neither endpoint contract nor observer is provided by the missing ticket. A synthetic receiver can prove fan-out and distinguish a recorded bot action from HTTP-only acceptance, but cannot prove production Grok wake. Do not print private configuration, invent a Grok API, or install/change private configuration without that contract.
