# Coordinator observations

The architecture should stay small: Limen owns work intent and evidence, Pi owns agent execution, and Herdr owns terminal topology. None of their terminal or completion signals should substitute for another layer's judgment. These observations supplement the independent source reports; they are not a completed integration verdict.

## Role and documentation contracts

- The worker is told to follow dependencies until a slice is coherent (`templates/worker.md:17`), then to finish if it touches more than the named seam (`:19`). The coordinator manual offers a starting seam as a lead. Recommendation: the outcome and explicit scope are the boundary; necessary dependency edits inside that boundary should not require a coordinator round trip. Escalate product ambiguity, not file count.
- The reviewer is directed to investigate broken invariants, regressions, and security (`templates/reviewer.md:8`), but may block only a proven acceptance-bullet violation (`:14`). Recommendation: retain the proven/plausible distinction while permitting a demonstrated material regression or security defect to fail a candidate even when the ticket did not predict it. This is a judgment change, not a runtime gate.
- The worker prompt calls detached the default (`templates/worker.md:9`); in Herdr, spawn defaults to hosted. The README's review examples omit `--detached` (`README.md:66–67`, command reference), although the shop manual explicitly requires it. Its unqualified timeout/tool cap claim (`README.md:78`) applies to detached jobs, not hosted ones. Correct the examples and conditional wording rather than introducing another operating mode.
- Keep the useful naming distinction: a conversation tab names a subject; a job tab names an outcome and round; the durable job ID identifies the record. A feature number is an address, not an explanation. Do not make human wording the lookup authority for a live process.
- Keep selective review and bounded iteration. A finite spend policy is useful; blanket instructions such as “ten reads means edit” or “never rerun” should be defaults with engineering judgment, not universal laws. Some failures require reading first or a discriminating rerun to establish causality.

## Baseline checks

Commands ran in the coordinator checkout at `f17edfc`, whose changes since the pinned code baseline are documentation only. The checkout was clean at invocation; no source was edited by this audit.

- `npm run check`: exit 1. TypeScript completed, then Biome rejected formatting in `.limen/jobs/2026-09-05-f085-coordinator-cpu-resume-2-a6845681/evidence/cpu-summary.json`. The command did not reach tests. Log: `/tmp/limen-v1-audit.sUTvC8/limen-check.log`.
- `biome.json` includes `**` and excludes only `node_modules` and `package-lock.json`; it does not enable Git-ignore handling. `.gitignore` excludes `/.limen/`. Recommendation: exclude runtime evidence from the source formatter. Do not rewrite evidence to satisfy formatting.
- A separate `npm test` was terminated by the Bash tool's 600-second deadline. The retained output has 66 successful test lines and six failing lines; the runner did not emit a final summary or detailed end-of-run failure diagnostics. This is incomplete and not an overall pass. Log: `/tmp/limen-v1-audit.sUTvC8/limen-test.log`.
- Failure lines name: running/pruned continue refusal; a pruned-job diff; exhaustion while tab close hangs; hosted-default versus detached spawn; supervisor-PID launch timing; hosted review versus detached review. Without completed diagnostics, these lines do not establish six product defects.
- No full upstream Pi or Herdr build/test lane or remote-seat proof was run by the coordinator.

## Launch observation

Two simultaneous researcher spawns both returned `git is not on PATH`. Immediately afterward, `/usr/bin/git` existed and `git --version` worked. Neither research job had a planted record, and neither new worktree remained. A separate coordinator was also launching a quality job. Sequential retries started successfully. The runtime researcher was asked to test whether automatic pruning can race the worktree-before-record interval. This observation alone does not establish the live incident's cause.

## Presentation

The owner-authorized HTML is `/Users/overment/Desktop/Limen-v1.0.html`. It is an offline, self-contained explanation and proposal, not a live dashboard or a shipped release. Until the independent reports and judge are filed, its finding list is explicitly a draft.

Chrome opened the document. The coordinator inspected desktop (1440 × 1050) and narrow (390 × 844) screenshots: both rendered readable headings and cards; the narrow layout stacks content and horizontally scrolls its navigation. Browser checks exercised five role choices, four scenarios with five distinct stages each, four finding filters, and all local anchors; there were no broken anchors or desktop document overflow. Screenshot attachment evidence lives in this coordinator's Pi session; the browser gateway refused filesystem screenshot writes. Final research-content changes still require a final render check.

The UI skill's remote tool was unavailable; the HTML uses ordinary HTML/CSS/JavaScript without an added dependency. No runtime code, product vision, or feature state was changed by this audit.
