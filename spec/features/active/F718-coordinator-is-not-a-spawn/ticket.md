# F718 · shop manual names the coordinator as a Herdr Pi tab

## Outcome

A new plant no longer treats `limen spawn` as starting a coordinator. The shop manual coordinators inherit says, early and plainly, that the coordinator is a hosted Pi tab in Herdr, that spawn only creates workers, reviewers, and advisors, and how to name the Herdr space so that tab is not lost among workers.

## Scope

- The package shop manual (`templates/agents.md`), in a short section before Durable intent.
- Keep `templates/AGENTS.md` in lockstep if it is a shipped copy of the same file.
- One short README sentence so install agrees that spawn is not a coordinator.
- Update the packaged history hash for `templates/agents.md`.

## Out of scope

- A `--role coordinator`, a coordinator job kind, or any spawn-role change.
- Planting `AGENTS.md` on `limen init` (inheritance from the package stays).
- Alice, Herdr runtime space renaming, or a new harness flag for `LIMEN_COORDINATOR`.

## Acceptance

- `templates/agents.md` states, before Durable intent, that the coordinator is a hosted Pi session in Herdr for this plant (`LIMEN_COORDINATOR=1`), owns tickets and `spec/build.md`, decides spawn and merge, and is not a limen job.
- The same section says workers, reviewers, and advisors come only from `limen spawn`, and never to spawn a coordinator job.
- It says `LIMEN_COORDINATOR=1` on a spawn shell does not change job role.
- It prefers a plant-named Herdr space (`limen`, or `alice limen`) over a space named only workers, that the coordinator tab is labelled clearly, that worker tabs come from spawn, and that Shepherd talks to the Pi coordinator.
- A short table maps "Tony spawns a coordinator" to starting that Pi tab, and "the coordinator manages workers" to that Pi running `limen spawn`.
- README gains at most one sentence or cross-link; no new README section.
- Packaged template history for `agents.md` matches the new bytes.

## Notes

`limen init` does not copy the shop manual into the project. Coordinators inherit `templates/agents.md` unless the project overlays `AGENTS.md`.
