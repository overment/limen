# F935 group brief · a short read-only run that the live picture can show

## Outcome

This group exists so the live picture can show a real group as one tree. The work itself is small and read-only. Nothing lands.

## Rules (binding)

1. Read only. Do not edit, create, or commit any file in the repository. Do not run tests, builds, or formatters.
2. Coordinators: spawn exactly two workers with the recorded worker settings that your task names. Then wait with `limen group wait` until both workers are finished. Then publish one team summary and finish.
3. Workers: read the files your team note names. Then wait about 4 minutes (`sleep 240`), so the picture can show the tree while you are live. Then publish one finding with `limen group publish`, at most four sentences, and finish.
4. Keep each finding short and specific: one thing the code does, with a file and function name.
5. Do not spawn reviews, continuations, or extra workers.
