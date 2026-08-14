# F006-interactive-managed-updates · Make Limen updates safe, current, and discussable

[2026-08-14] [🟠] [ACTIVE] [COORDINATOR] ACTIVE · F006-interactive-managed-updates

## Outcome

A coordinator can bring an existing Limen project forward to the installed Limen release without turning project guidance into a stale fork or silently overwriting judgment. Mechanical updates are clear and reversible; a semantic prompt, extension, or workflow change arrives as a short, decision-ready conversation when its effect is not obvious.

## Scope

- Shape an explicit interactive update experience for Limen-managed extensions, prompt bases, project overlays, and coordinator guidance.
- Define the durable files and provenance needed to distinguish an unchanged managed asset from a project modification, including recovery and workspace behavior.
- Define the agent-facing response shapes: concise status, safe-update summary, meaningful-difference explanation, options, recommendation, and only the questions that require a human decision.
- Define job-time prompt composition from an installed Limen base, project-owned additions, and a snapshot of live job facts.
- Propose a staged, testable implementation boundary for `limen update` (or a better command name).

## Out of scope

- Implementing the update command, prompt composition, asset manifest, or interactive UI.
- Automatically updating Limen through a package manager or network fetch.
- Automatically overwriting `spec/vision.md`, `spec/build.md`, tickets, or project-specific rules.
- Retrofitting every existing project beyond the already-applied prompt and extension refresh.

## Acceptance

- A design note beside this ticket gives a coherent mental model, command lifecycle, asset ownership classes, durable state, recovery behavior, and workspace semantics.
- It contains concrete examples of the agent’s update brief for: no change, safe mechanical update, customized/ambiguous asset, and legacy prompt migration.
- It explicitly distinguishes what the agent may apply autonomously from what it must explain and discuss with the human.
- It names the unresolved response-shape/settings decisions for a human discussion before implementation begins.
- The proposal preserves Limen’s advisory-first, ordinary-files-and-Git, reversible-operation principles.

## Notes

The immediate incident was a copied extension becoming stale and a newly improved prompt narrative requiring manual propagation. F006 must make the next update deliberate, concise, and trustworthy rather than a bulk file copy.
