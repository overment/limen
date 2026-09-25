# F731 · One seat bell per real job event

## Outcome

A finished job or hosted-stall advisory makes the seat ring once, not every fifteen minutes forever while a coordinator is absent. The Mac seat can keep its periodic sweep for discovering new work without replaying already-announced events. Adam can distinguish a new stall after a worker genuinely resumed from an old stalled event.

## Scope

- Start at `sweepProject` in `src/commands/sweep.ts`: the registered Mac seat has thousands of persistent `notify/seat` markers but treats them only as a cooldown, not an event receipt.
- A terminal transition gets one seat notification; the same unchanged finished job never rings again even without `notify/delivered`.
- A current `advisory` gets one seat notification; a cleared and newly created advisory may ring once again.
- Preserve legacy timestamp markers as evidence that old events already rang. Coordinate concurrent sweep processes before showing a notification.
- Keep the coordinator wake, Herdr notification, and opt-in finish webhook paths unchanged unless a reproduced second loop demands it.

## Out of scope

- Editing another plant or purging its job history or notification markers.
- Disabling first notification for genuinely new terminal events or stalls.
- Turning failed or ambiguous webhook transport into proof of a bot turn.

## Acceptance

- Repeated sweeps over an old terminal job with no coordinator receipt show the seat notification once, including after a service restart.
- Existing seat timestamp markers suppress another notification for that same event.
- A new advisory after the old one clears can notify once; an unchanged advisory stays quiet.
- Concurrent sweeps cannot both ring for the same event; failed notification transport is handled deliberately without creating an unbounded notification loop.
- The focused native regression, typecheck, and Biome check pass.

## Notes

Observed on the Mac seat: `works.earendil.limen-sweep` ran 2,097 times, scanning 18 registered roots. Among 802 jobs with seat markers, 793 were marked repeatedly; old finished jobs hold over 1,900 markers each and no `notify/delivered` receipt.
