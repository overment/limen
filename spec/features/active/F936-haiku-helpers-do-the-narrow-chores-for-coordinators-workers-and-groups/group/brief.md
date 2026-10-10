# Brief · how Limen's logic tells an agent when and how to use a Haiku helper

## Shared outcome

Adam gets one minimalist black-and-white HTML page. Its graphs show how to change Limen's logic so that a lead agent (Opus or Sol) knows **when** to give a narrow chore to a Claude Haiku 5.5 helper, **how** to give it, and **when not to**. The lead of this group builds the page from your findings. You deliver the findings, not the page.

Owner request (Adam, 2026-10-10): run a Sol team and an Opus team. Map every place in Limen where a decision to delegate happens or could happen. Bring real knowledge of model routing and prompting, with sources. Propose the concrete logic change. Challenge each other.

## Facts at the start

Read `ticket.md`, `study.md` and `pilot.md` in this feature folder first. They are the input. Short version:

- Haiku 5.5 is a read-only helper. It returns an evidence packet of 15 lines or fewer, so the completion wake (`handoffExcerpt` in `src/job/wake-text.ts`, 15 lines and 1,200 characters) carries it whole. The lead reads it and decides.
- Top uses: repository scout before a spawn; test, log and failed-job triage; review and judge evidence pre-pass; team scout after the team hypothesis; cabinet digest and candidate table for a group lead.
- The lead keeps: hypotheses, synthesis, the hard change, landing, review of record, the judge's divergence, and every text Adam reads.
- `--model pi-claude/claude-haiku-5-5` runs Haiku 4.5 today with no warning. One catalog entry in the local OMP bridge fixes it.
- Groups forbid helper agents today (`templates/group-member.md`, `templates/coordinator.md`, `docs/groups.md`). Only Adam can change that rule.
- The vision: judgment travels as prose; new machinery only where prose cannot reach; inform, do not gate; no automatic routing or model fallback.

## Places to map (starting list, not complete)

- Templates: `templates/agents.md`, `coordinator.md`, `worker.md`, `group-member.md`, `reviewer.md`, `judge.md`, `keeper.md`, `researcher.md`, `quality.md`, `picture.md`.
- Hooks: `hook/communication.ts`, `hook/group-peer.ts`, `hook/hosted.ts`, `hook/steering.ts`, `hook/wake.ts`, and the loader `templates/limen-extension.ts`.
- Runtime and commands: `src/runtime/engine.ts` (argv, bridge loading, per-job `--config` overlay), `src/runtime/stream.ts`, `src/commands/spawn.ts`, `src/commands/group.ts`, `src/commands/continue.ts`, `src/commands/steer.ts`, `src/commands/watch.ts`, `src/commands/keeper.ts`, `src/commands/webhook.ts`, `src/job/wake-text.ts`, `src/job/group-cabinet.ts`, `src/job/group-events.ts`.
- Durable choices: `spec/build.md` TRACK (standing models, reasoning levels).

## Rules

- Read-only for `src/`, `hook/`, `bin/`, `templates/`, `test/`, `docs/`. Do not run tests, builds or formatters. They cannot change your answer.
- Do not start model runs, helper jobs, reviews or continuations. Do not use the `anthropic` provider.
- Write only `spec/features/active/F936-haiku-helpers-do-the-narrow-chores-for-coordinators-workers-and-groups/group/teams/team-N-findings.md` (your team number). At most 250 lines. Commit it on your own branch.
- A source claim needs a fetched source. Fetch the page (the `read` tool on the URL, or `curl`) and put the URL and one short quote beside the claim. A claim you could not fetch is marked `unverified`. Never cite from memory alone.
- Every code claim names a file and a function, line or hook event.

## Candidate sources (verify each; drop what does not load)

- Anthropic model docs: `https://docs.claude.com/en/docs/about-claude/models/overview`, `https://docs.claude.com/en/docs/about-claude/models/choosing-a-model`. Find the Haiku 5.5 page and release note (released 2026-10-07).
- Anthropic prompting guide: `https://docs.claude.com/en/docs/build-with-claude/prompt-engineering/overview` and the best-practices page for current models.
- Anthropic engineering: `https://www.anthropic.com/engineering/building-effective-agents` (routing, orchestrator-workers), `https://www.anthropic.com/engineering/multi-agent-research-system` (lead and cheaper subagents).
- Claude Code subagents (per-subagent model, the Haiku `Explore` agent): `https://docs.claude.com/en/docs/claude-code/sub-agents`.
- Routing and cascades: FrugalGPT `https://arxiv.org/abs/2305.05176`, RouteLLM `https://arxiv.org/abs/2406.18665`, AutoMix `https://arxiv.org/abs/2310.12963`, LLM cascades with mixture of thoughts `https://arxiv.org/abs/2310.03094`.

## Talk to each other

- First action: publish your initial hypothesis (the member contract says how).
- By **minute 30** of the group: publish your delegation map's top findings (the five places where the signal matters most).
- By **minute 55**: publish your draft proposal: where the signal lives, the not-use rule, the escalation rule.
- Answer every point another team addresses to you: `limen group publish --team team-N 'Answer to team-N: …'`. Agree, or name the evidence that would change your mind. Silence is not an answer.
- Final file committed by **minute 75**. The group deadline is 90 minutes.

## Shared format for the findings file

1. **Delegation map.** One row per place:

   | Place | File and hook or function | Who decides today | Haiku fit (yes, after pilot, no) | Signal that should reach the agent |
   | --- | --- | --- | --- | --- |

2. **Knowledge.** Numbered claims about routing by task shape, cascades and escalation, evidence packets, verification, and steering (role prompts, routing tables, hook reminders, tool allowlists, per-role model defaults, budget signals). Each claim: one sentence, URL, short quote, and what it means for Limen.
3. **Proposal.** An ordered list of changes. Each: file, the change in one or two sentences, prose or mechanism, and why. Then three rules in plain words: when to use a helper, when not to, and when to escalate to the lead.
4. **Decision flow.** One Mermaid `flowchart` for "should this be a Haiku helper?", with the escalation path.
5. **Points from the other team.** Each point, your answer, and whether it changed your result.
