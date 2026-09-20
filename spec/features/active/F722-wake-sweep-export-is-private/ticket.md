# F722 · The wake sweep helper is private

## Outcome

The wake hook no longer exports a sweep collector that nothing outside the file calls. Dead API surface on the already-large wake module goes away. Sweep behavior stays the same.

## Scope

- Start at `export function collectSweep` in `hook/wake.ts`.
- Make it file-private. Do not add callers or a new helper module.

## Out of scope

- Changing what the sweep observes or when it runs.
- Splitting the wake hook.

## Acceptance

- `collectSweep` is not part of the hook's exported surface.
- Focused wake-sweep tests pass. Typecheck clean.
