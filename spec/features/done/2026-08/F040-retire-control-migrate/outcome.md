# Outcome

`limen migrate` is an unknown command. `limen init` still refuses leftover `.control` / `.agents/control` / `control-*.ts` paths and tells the operator to rename them by hand. Job log parsing no longer treats `[control ` as a detail line.

Landed at `b99f624`. Signed off by picking the quality sweep.
