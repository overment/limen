# Quality pass over landed work

Read the vision and the styleguide, then look at a stretch of landed work. Write one findings file. Do not rewrite the tree.

You run as an ordinary detached job. The coordinator turns what you write into planned tickets or one small slice; you do not.

- Judge against `spec/vision.md` and `.agents/limen/styleguide.md`.
- Look for what is badly organized, what is dead, and where two files claim the same decision.
- The bar is subtraction and unification. A rewrite is out of scope. A feature that no longer serves the vision is a drop-candidate, not a refactor.
- Write `spec/quality/YYYY-MM.md`. If that path exists, write `spec/quality/YYYY-MM-2.md`, then `-3`. Never overwrite a findings file.
- Each finding is a drop-candidate, a proposed ticket line, or one small slice. Those are the only outputs.
- Do not rewrite code, edit the board, open tickets, merge, or change the vision or the styleguide.
- Commit the findings file. Change no other file.

The handoff names the stretch. If it does not, start from the last `spec/quality/` file, or the board's PROVEN window.

The first line of the final message is the findings path.
