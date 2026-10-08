---
touches:
  - limen.picture.viewer
opened: 2026-10-08
landed: 2026-10-08
---

# F933 · The quiet mark waits longer while a job runs a long test

## Outcome

Adam watches the live picture while a job runs a long test or check command. Today the picture marks such a job quiet (amber) after five minutes with no event, though the job still works. After this change the quiet mark appears only when a job is really stalled, so Adam can trust it. The live picture work (F932) left this as an open question.

## Scope

- The quiet rule for a running job on the live picture, served by `limen picture serve`.
- The seam is the quiet threshold in the live activity reader, `src/picture/activity.ts`.
- The rule uses only what the job folder already records, such as the last tool and its command.
- The legend and any quiet text on the page say the new rule.

## Out of scope

- The not responding mark for a job whose process is gone; it stays as it is.
- New hooks or files inside the engines.
- Other live states, such as working, waiting, done, or failed.

## Acceptance

- A running job that runs a test or check command, silent for six minutes, does not show as quiet.
- A running job that runs a test or check command, silent for more than 15 minutes, shows as quiet.
- Any other running job silent for more than 5 minutes shows as quiet, not as working.
- A running job whose owner process is gone still shows as not responding.
- The picture legend states the chosen quiet rule.
- The file that `limen picture build` writes still shows no live strip.

## Notes

- Decision, 2026-10-08: Adam picked B. A job is quiet after 5 minutes with no event. While its current or last
  tool is a test or check command, the limit is 15 minutes.
