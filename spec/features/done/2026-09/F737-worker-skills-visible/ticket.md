# F737 · Plant skills reach OMP workers without hand links

## Outcome

An OMP worker sees the plant's project skills on its first turn, including skills authored before OMP became limen's default engine. A plant does not need to duplicate or link individual skills into another engine's directory when it adds a skill.

## Scope

- Start at limen's worktree and engine launch seam: the skill view must follow the repository selected for a job, not the coordinator's checkout.
- Treat `.agents/skills/<name>/SKILL.md` as the portable native layout and expose legacy `.pi/skills/*.md` and `.pi/skills/<name>/SKILL.md` to OMP without editing the plant.
- Preserve native skill precedence and Pi's existing discovery; handle symlinks, additions and resumed branches without stale inventory.
- Include hosted and detached workers, fresh reviews, and both kinds of continuation; adjacent non-Git coordinator workspaces target the child repository's skills.
- Explain the authoring contract and compatibility behavior in limen documentation.

## Out of scope

- Rewriting Alice's skill files or adding more hand-maintained symlinks there.
- Changes to hang detection, finish absorption, or the plant status plate.
- A new skill registry or model-side routing rules.

## Acceptance

- A fresh Alice OMP worker offers `meta-skill`, `speak-concisely`, and `understand-feature` beside the four already visible skills; a newly added legacy skill also appears without a manual link.
- Fresh and continued jobs in both modes, including independent reviews, expose the selected plant's skills, not the coordinator's unrelated project skills.
- Pi retains its native project skill behavior, and native OMP skills are not hidden or accidentally replaced by legacy duplicates.
- Real OMP discovery is demonstrated against a representative project and limen's focused tests/checks pass.
