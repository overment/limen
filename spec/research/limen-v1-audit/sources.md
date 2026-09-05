# Limen v1.0 integration audit

## Question

How reliably do Limen's communication, handoffs, naming, roles, spaces, tabs, agents, and process ownership fit Pi and Herdr? Identify demonstrated defects and efficient API use without turning operating judgment into restrictive machinery. The owner requested this research and a possible Desktop HTML presentation, not production changes.

## Sources

- Limen: `/Users/overment/.overment/limen`, revision `5a00065c92d86cd2039149273095e4e470898418`.
- Pi: https://github.com/earendil-works/pi.git, shallow clone `/tmp/limen-v1-audit.sUTvC8/pi`, revision `da840b6216578c2a571d0374ac6a2091a83f9d91`.
- Herdr: https://github.com/herdrdev/herdr.git, shallow clone `/tmp/limen-v1-audit.sUTvC8/herdr`, revision `6c52aad511b0fb601e6223bd6ad944f48cbdba6d`.
- Installed Pi: `0.85.1`; installed documentation: `/Users/overment/.nvm/versions/node/v24.1.0/lib/node_modules/@earendil-works/pi-coding-agent/`.
- Installed Herdr: `0.8.2`; `herdr --skill` and command-group help describe the live CLI.

Upstream HEAD and the installed programs are different evidence surfaces; do not assume version parity. Clone paths are temporary; repository URLs and commits preserve source identity.

## Coverage

- Research report 1: complete Limen hooks, prompts, inheritance, steering, notification delivery; the relevant Pi extension/session/queue/rendering APIs and implementation.
- Research report 2: complete Limen runtime and command layer, particularly Herdr adapter, supervisor, process containment, launch, resume, stop, pruning, names and layout; matching Herdr API implementation.
- Coordinator: product intent and role contracts, documentation consistency, native check results, synthesis and HTML presentation.
- Judge: challenge the reports against their cited sources and distinguish demonstrable defects, known active work, optional improvements, and uncertainty.

Inspect complete relevant files and matching tests, not just search excerpts. This is an integration audit, not a claim to review every vendored dependency or every unrelated upstream subsystem. Do not interact with, stop, steer, or adopt unrelated live jobs. Use isolated scratch fixtures for reproductions, never the real job cabinet. Do not edit production code, feature state, or vision.

## Model decision

At the owner's explicit request, every job in this audit uses `openai-codex/gpt-6-astra:xhigh`, including the judge. The reports provide independent task perspectives, not different-model diversity. Findings require source evidence; empirical claims name the command and result. Research reports are filed verbatim by the coordinator and committed before the judge runs.
