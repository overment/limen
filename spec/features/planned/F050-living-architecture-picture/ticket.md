# F050 · A background field guide explains the application

**Adam 2026-09-08 (via Tony / Alice dogfood):** Study **limen** (`~/.overment/limen`) and how **Alice** is developed with it (vision, board, feature folders, styleguide, quality, picture role). Propose how limen can run an **entirely background** worker that watches landed changes and presents the **whole application** so a technical human — forever a bit “day one” — can grasp alignment with vision/styleguide, module relationships, and condition, from broad overview down into details.

## Constraints (hard)
- Easy to manage and keep current (semi-automatic welcome).
- **Not** another complicated single-project app to maintain.
- Prefer artifacts Astra-class models can author/maintain (Git-friendly, inspectable).
- Build on existing limen seams where they fit: `spec/picture.md`, `--role picture`, quality/research job kinds, board/feature folders — extend or reimagine, don’t ignore them.
- Freedom for creativity and systems-presentation theory; taste matters.

## Deliverables
1. Short understanding of limen’s role vs Alice’s development loop (evidence from repos, not vibes).
2. Proposal: what the background worker watches, what it produces, how humans navigate overview→detail, how it stays fresh without babysitting.
3. **Wireframe / living example** on Alice (or limen itself) showing where this leads — sketches, HTML/markdown mock, mermaid, or similar. Explain the experience.
4. Explicit non-goals and failure modes (overbuilt dashboards, stale diagrams, noise).
5. Tip Tony with paths/commits; do not invent board state. Prefer Astra xhigh workers if you spawn help.

## Out of scope
Shipping a production dashboard in Alice; rewriting limen core reliability (F048/F049 seat work) unless the proposal clearly depends on a tiny hook.
