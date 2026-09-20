# F721 · Coordinator status is static

## Outcome

The coordinator footer no longer animates a spinner on a 120 ms timer. Job facts still update when the sweep or a watcher event produces a new status. Cosmetic CPU work and the interval/frame branches go away. Wake delivery and durable state stay the same.

## Scope

- Start at `drawStatus` / `setInterval(drawStatus, 120)` in `hook/wake.ts`.
- Drop the spinner frames and the animation interval. Write the footer once when the sweep produces a new status body.
- Keep Herdr metadata event/sweep driven as it is today.

## Out of scope

- Wake routing, claims, or delivery.
- Tab-title running count.
- Splitting the wake hook further unless this deletion still leaves a proven size problem.

## Acceptance

- No 120 ms interval exists solely to rotate spinner frames.
- A status body change still updates the footer.
- Clearing status still removes the footer.
- Focused wake-hook and wake-sweep tests pass. Typecheck clean.

## Notes

Quality findings: settled-history already removed expensive reads; the remaining interval exists only to animate `SPINNER`.
