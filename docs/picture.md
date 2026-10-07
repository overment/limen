# Picture

[README](../README.md) · [Command reference](commands.md)

Picture shows a project’s code structure and the places named by its specified features and journeys.

The architecture map is a local file. `limen picture build` makes it from a Markdown dataset that Git ignores (default `.limen/picture/`). The output is one offline `map.html` in the same directory. **Build never calls a model.**

- **Not in Git:** The dataset and the map are not in Git. Nobody commits or lands them. A new clone has no map.
- **Rules:** [templates/picture/CONTRACT.md](../templates/picture/CONTRACT.md) has the dataset rules.
- **Source check:** Build warns (`source.missing`) for each cited source path that does not exist in the project root. The map still renders.

## What the map shows

The picture shows the plant atlas beside a quiet column of work and dated decisions. Select a place to read its sources, connections, and the features and journeys that name it.

Module titles and place names wrap instead of cutting off. Place labels keep their work counts beside the name. Hover a place for its full name and description; open it for sources and connections.

Select a feature or journey to reveal its `touches` or `steps`, including places inside different modules. Only named places light; nested places keep their parent captions.

Follow a journey through its ordered steps, including repeated visits and stops at the whole project. The URL preserves a selected place, work item, or day on reload. The map never uses Git history to guess places.

Module cards and band places wrap into rows with a minimum readable width. On a wide window, the atlas stays beside the reading column. Its heading, selection line, and legend stay visible while the map scrolls. Selecting a place, module, work item, or journey step brings the focused or first lit place into the map viewport without moving the selected row in the reading column. Narrow windows keep the atlas above the reading column.

Pins, places, modules, work, journeys, and days open larger as layers over the page. An item opened inside a layer stacks one more layer. The trail above the layers names each one and jumps to any of them. Esc and browser Back close the top layer; the Left and Right arrow keys move the top layer to the previous or next item of the same kind. The URL holds the whole stack, so a reload or a shared link opens the same layers.

**Map features are not the live work list.** They show where specified features cross the code, not their state. The board (`spec/build.md`) owns feature state. The live picture also reads tickets and the board to show current work.

Ticket dates show when work opened or landed; a dated **Needs Adam** request or **Wrong** problem appears as a pin. Ticket `touches` link the work to exact map places; a place with no evidence stays unlinked.

Make a ticket with `limen ticket new "what becomes true" [--lane planned|active] [--touches id,id]`. It takes an F number that no lane (dated done and dropped folders included), no local `limen/*` branch and no job label uses. It writes the ticket under `spec/features/<lane>/` and prints its path. The default lane is planned. Only pass `--touches` for module or plant ids you verified in the map's `nodes/` files; omit it when no place is known.

The scaffold writes `opened` and a valid front matter block. For later dated decisions, use `needs-adam` with `needs-adam-on` or `wrong` with `wrong-on`; remove each pair when resolved. Add `landed` to done tickets with a known date. The [ticket contract](../templates/picture/CONTRACT.md#ticket-front-matter) has an example. A missing front matter block on an active ticket, a bad date, an incomplete pair, or an unknown place id is an error. A missing `touches` list on an active ticket or a duplicate F number warns. Every `ticket.*` message names the path, line and `fix:` action.

In a job worktree, the map is not in the branch. It stays in the plant root. Check the worktree ticket against that map without replacing its rendered page:

```sh
limen picture build --dir "$LIMEN_CONTEXT_ROOT/.limen/picture" --out /tmp/check.html --strict
```

The strict check exits 1 for ticket errors. It warns, but does not guess a link, when an active ticket has no known `touches`.

Remove a Needs Adam request and its date after Adam answers. Remove a Wrong problem and its date after the fix. The pin then leaves the page.

## Refresh the map

The coordinator starts the first map by hand, as an interactive `--role picture` job (`--tab`). It uses `--detached` only when the interactive start fails.

Start it from the project repository, with the engine and model flags chosen for the job:

```sh
limen spawn --role picture --tab --engine E --provider P --model M --thinking T \
  'Create the first local architecture map in .limen/picture. Read templates/picture/CONTRACT.md; commit nothing.'
```

With no dataset, both `limen picture build` and `limen picture tick` point to this command and `docs/picture.md`. Build exits with an error; tick skips the refresh without starting a job. A dataset with no recorded revision gets the same first-map hint from tick. Existing dataset validation errors still appear.

After that, `limen picture tick --engine E --provider P --model M --thinking T` does one quiet pass. It compares the commit recorded in the map with `HEAD`. It starts a detached refresh job only in two cases:

- files were added, deleted, or renamed, or
- a source that the map cites changed. A source that only a feature or a journey cites counts too.

Changes to specs, docs, or the map only print nothing and cost nothing. So a change to the board only (`spec/build.md`) never refreshes the map. The tick tries each tip one time. `--dry-run` prints the decision in one line, also when the map is current or nothing relevant changed.

## Map watch

**Off by default.** The tick runs by itself only in a project that turns on its watch. Each time the top branch moves (a land, a merge, or a pull), the watch hook starts one tick in the background. Worker branches and other refs start nothing. The hook never makes a merge or a spawn wait. The refresh job wakes no conversation.

| Command | Effect |
|---|---|
| `limen picture watch on --engine E --provider P --model M --thinking T` | In the primary checkout, installs one Git `reference-transaction` hook. |
| `limen picture watch` | Prints the state. |
| `limen picture watch off` | Removes the hook. |

`--branch` names the top branch when it is not the branch that is checked out. `.limen/picture-watch.log` records each move.
