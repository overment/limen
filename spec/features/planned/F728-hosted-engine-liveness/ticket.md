# F728 · Hosted OMP jobs stay live when Herdr loses their classification

## Outcome

A hosted OMP job remains running when its agent listing temporarily disappears but its process is still present on the recorded pane. The Pi/OMP profile table must also inform recovery evidence rather than leaving OMP outside the fallback that already protects Pi.

## Scope

- Start at `locateHostedAgent` in `src/herdr.ts`, whose foreground-process fallback currently recognizes only `pi` or `node`.
- Use the recorded engine and existing profile where process identity requires an engine choice; retain one shared recovery path.
- Preserve the distinction between a missing agent, an uncertain probe, and a positively located live process.
- Cover hosted startup recovery, supervision, and existing callers without adopting an unrelated pane.

## Out of scope

- New engine types, another supervisor, or another stream parser.
- A general Herdr process-discovery redesign or an unconditional widening of process-name matches.
- Changing job completion, stop, or notification policy.

## Acceptance

- A fake-Herdr regression keeps an OMP job running when its agent row is absent but the expected OMP process remains on the recorded pane.
- A genuinely absent process still permits the existing terminal-state path.
- An unrelated pane or process is not adopted as the job.
- Existing Pi and moved-pane recovery tests still pass, along with typecheck.

## Notes

Source inspection in `spec/quality/2026-09-2.md` found this gap after Pi/OMP selection landed (F727). It is not a reproduced live OMP failure; live hosted OMP proof was outside that engine slice. The ticket's regression should establish the exact failure before changing recovery.
