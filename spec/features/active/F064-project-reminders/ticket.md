# F064 · moment-of-use reminders come from the project

## Outcome

After an agent edits code or starts work, Limen recalls the project’s own styleguide or vision instead of reciting Limen’s TypeScript product rules. The reminder points to the governing file and carries its headings, so it is useful in Rust, Svelte, CSS, and other repositories without inventing project intent.

## Scope

- Start in `hook/communication.ts`, where reminder text and code-path classification live.
- Build style and vision reminders from the active project files at the moment the tool result is handled.
- Treat a write or edit outside `spec/` as code unless its path is Markdown.
- Keep the reminder bounded and useful when a governing file is absent or has no headings.

## Out of scope

- Changing the stable system-prompt guidance or per-turn audience cue.
- Parsing project languages, frameworks, or build systems.
- Changing Specs reminders or board behavior.

## Acceptance

- A project with different styleguide and vision headings gets reminders naming those files and headings, with none of Limen’s TypeScript or one-human wording.
- `.rs`, `.svelte`, and `.css` edits recall the styleguide; Markdown outside `spec/` does not.
- A `spec/` edit still recalls the Specs register.
- Communication-hook tests cover project-specific text and the wider code-path rule.
