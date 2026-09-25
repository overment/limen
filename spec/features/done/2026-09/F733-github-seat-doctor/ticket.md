# F733 · The seat can diagnose its GitHub doorbell

## Outcome

An Alice-seat operator can provision and diagnose the isolated GitHub App doorbell using checked-in Limen materials instead of a private draft and tribal steps. `limen github doctor` reports each missing prerequisite and the exact safe repair without exposing credentials or weakening the worker/poller split. The same package supports a second repository on the seat.

## Scope

- Package reusable root-side setup and systemd timer/service materials under `docs/seat/`, adapting the Alice draft in `tmp/` without hardcoded App ID, secret, or deployment commit.
- Start doctor in a new source file: inspect installed poller release, key ownership and accessibility by the right identities, timer, project registry/ACL, worker group/sudo status, binding and live registered agent. State fixes plainly and fail nonzero when unsafe or incomplete.
- Diagnose both the root/operator setup and coordinator-side binding without asking a worker to inspect the PEM bytes; expose a single `github doctor` CLI entry and brief help.
- Update `docs/seat/README.md`, `docs/remote.md`, and Alice operator directions with secure setup, doctor, multi-repository, and Mac-versus-VPS trial commands.

## Out of scope

- Running the root setup without operator credentials, editing iceener/alice, copying PEM to a worker account, loosening sudo/ACL checks, or replacing the F014 poller.
- Implementing mention parsing or retry logic; those belong to the companion front-door slice.

## Acceptance

- On an unprovisioned seat, doctor identifies missing PEM/timer/ACL/group/binding/live agent with actionable steps; success requires each safety prerequisite, not just file existence.
- The checked-in setup is parameterized, repeatable, and keeps `/opt/limen` root-owned, PEM poller-only, state poller-private, and worker without sudo.
- Alice instructions start from root setup, match the installed CLI version, show `github doctor` and `github ensure`, then demonstrate `@limen` from the Mac and seat verification without private draft paths.
- Doctor can inspect a registered project or several without printing key contents, tokens, or claims.
