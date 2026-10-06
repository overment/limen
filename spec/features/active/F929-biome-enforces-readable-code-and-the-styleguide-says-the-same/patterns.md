# Patterns and libraries for readable limen code

Research map for this feature. Every limen claim cites `file:line` at the base of this branch. Every library number comes from the `npm view` output in the appendix, run on 2026-10-06. Unverified points carry `[INFERENCE]`.

## 1. Argument parsing

**Today.** Nine commands parse flags with a hand-written index loop. Each loop has its own rules for missing values, repeats, and unknown flags.

| File | Loop | Value after a flag may start with `--`? | Repeat rule |
|---|---|---|---|
| `src/commands/continue.ts` | 29-47 | yes, except `--extension` (37) | last wins |
| `src/commands/group.ts` | 32-57 | no (52) | error (52) |
| `src/commands/keeper.ts` | 138-154 | no (147) | last wins, `--job` collects |
| `src/commands/land.ts` | 190-203 | no (196) | error (197) |
| `src/commands/spawn.ts` | 400-448 | yes, except `--extension` (428) | error via `once` (517-520) |
| `src/commands/picture.ts` | 23-32 | no (29) | error (29) |
| `src/commands/ticket.ts` | 51-62 | not checked; steps by 2 | error (54) |
| `src/commands/linear.ts` | 42-48 | not checked; steps by 2 | last wins |
| `src/commands/github.ts` | 211-216 | not checked; steps by 2 | rejected (214) |

Nine more sites test one flag by position, without a loop: `src/main.ts:146,151-152`, `init.ts:11-12`, `jobs.ts:100-112`, `status.ts:25-26`, `steer.ts:11-13`, `sweep.ts:23-25`, `prune.ts:9-11`, `group.ts:236-239` and `group.ts:262`. The quartet `--engine --provider --model --thinking` is parsed in five of these places (`keeper.ts:22`, `picture.ts:9`, `github.ts:209`, `continue.ts:35`, `spawn.ts:413-420`).

One real defect follows from the mixed rules. In `spawn` and `continue`, `--label --tab task` stores `--tab` as the label and leaves `tab` false (`spawn.ts:427-433`, `continue.ts:36-40`). This is read from the code; it was not run.

**`node:util` `parseArgs`** (Node 24 docs: https://nodejs.org/api/util.html#utilparseargsconfig, page version v24.21.0; error codes: https://nodejs.org/api/errors.html#err_parse_args_invalid_option_value). Stable since v20.0.0. It covers what the loops do:

- `options.<name>.type`: `"string"` or `"boolean"`.
- `multiple: true` collects repeats into an array (`--job`, `--extension`). Without it, a repeated option is last-wins.
- `default` applies only when the option is absent (`--timeout 20m` in keeper).
- `--flag=value` and `--flag value` both work. `--` ends options; the rest are positionals (same as `spawn.ts:403`).
- `strict` (default `true`) throws on unknown options and on type mismatch. `allowPositionals` defaults to `false` under `strict`.
- `tokens: true` returns one token per use, so a command can still refuse a repeated flag.
- Errors: `ERR_PARSE_ARGS_UNKNOWN_OPTION` (unknown flag under `strict`), `ERR_PARSE_ARGS_INVALID_OPTION_VALUE` (string/boolean mismatch, missing or ambiguous value), `ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL` (positional while `allowPositionals` is `false`).

Ambiguous value, checked with `node -e` on Node v24.1.0 (`label` is a string option, `tab` is boolean):

| `args` | Result |
|---|---|
| `--label --tab x` | `ERR_PARSE_ARGS_INVALID_OPTION_VALUE`: "Option '--label' argument is ambiguous. Did you forget to specify the option argument for '--label'? To specify an option argument starting with a dash use '--label=-XYZ'." |
| `--label=--tab x` | `label: "--tab"`, positionals `["x"]` |
| `--label` | `ERR_PARSE_ARGS_INVALID_OPTION_VALUE`: "Option '--label <value>' argument missing" |
| `--tab=yes` | `ERR_PARSE_ARGS_INVALID_OPTION_VALUE`: "Option '--tab' does not take an argument" |
| `--bogus` | `ERR_PARSE_ARGS_UNKNOWN_OPTION` |
| `x` with `allowPositionals: false` | `ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL` |
| `--label a --label b` | `label: "b"` (last wins); with `tokens: true`, two `label` tokens |
| `--label --tab x` with `strict: false` | `label: "--tab"`: the ambiguity check is off |
| `fix -x bug` (task text) | `ERR_PARSE_ARGS_UNKNOWN_OPTION`; `-- fix -x` passes |

So `strict` mode fixes the `--label --tab` defect for free. It also changes two behaviors: Node's error wording replaces limen's (`main.ts:159` prints `error.message`, so the user sees Node's text), and spawn task words that start with one dash need `--` first.

**Recommended shape.** One `parseArgs` call per command, inside the command file, no shared wrapper. Cross-flag rules stay as early-return checks after the call. The sketch assumes `import { parseArgs } from "node:util"`, `ROUTE = ["engine", "provider", "model", "thinking"] as const` (names without dashes, unlike `keeper.ts:22`), and a full `ROUTE_OPTIONS` object. With those three lines added, it type-checks with `tsc --strict --exactOptionalPropertyTypes --noUncheckedIndexedAccess --verbatimModuleSyntax --erasableSyntaxOnly` and runs under Node v24.1.0 (scratch copy in `/tmp`, not in the repository):

```ts
function parseKeeperArgs(args: readonly string[]): KeeperOptions {
	const { values, positionals } = parseArgs({
		args,
		allowPositionals: true,
		options: {
			job: { type: "string", multiple: true, default: [] },
			candidate: { type: "string" },
			group: { type: "string" },
			timeout: { type: "string", default: "20m" },
			...ROUTE_OPTIONS, // { engine: { type: "string" }, provider: …, model: …, thinking: … } as const
		},
	});
	const [ticket, ...extra] = positionals;
	if (!ticket || extra.length) throw new Error("keeper requires exactly one <ticket-path>");
	if (values.job.length === 0 && !values.group) throw new Error("keeper requires --job ID or --group GROUP-ID");
	const route = ROUTE.flatMap((name) => {
		const value = values[name];
		if (!value) throw new Error(`keeper requires --engine --provider --model --thinking; missing --${name}`);
		return [`--${name}`, value];
	});
	const { candidate, group } = values;
	return { ticket, jobs: values.job, route, timeout: values.timeout, ...(candidate ? { candidate } : {}), ...(group ? { group } : {}) };
}
```

The 23-line body replaces 30 lines (`keeper.ts:131-160`), and the flag list becomes a table a reader can scan. Spawn keeps its "may be supplied only once" rule by counting `tokens`.

**Landed sample.** This branch rewrites `src/commands/keeper.ts` with one `FLAGS` table and `parseArgs`. It keeps keeper's own error messages: a first pass with `strict: false` and `tokens: true` names the unknown flag or the flag without a value, then a strict pass gives exact types. Thirteen bad argument lists give the same first error line as before. Two inputs change on purpose: `--job=x` now works, and `-j` is named as an unknown option.

## 2. Errors

**Today.** Commands throw (`throw new Error` appears 310 times in `src/`). `src/main.ts:157-160` turns any throw into one message line and exit code 1. For a CLI, that is the correct outer shape. The noise is lower down: `src/` and `hook/` hold 168 `try {` blocks and 112 `.catch(() =>` calls. About 25 of them only tell "file missing" apart from "real error", and they spell the check four ways (`group-cabinet.ts:45`, `jobs.ts:23`, `picture/board.ts:15`, `contain.ts:138`).

**Result unions already in use:**

- `src/picture/frontmatter.ts:14-15` declares `ScalarResult` and `QuotedResult` as `{ ok: true; value } | { ok: false; message }`; `bad()` at `:336-338` builds the failure.
- `landTicketCheck` returns `{ ok, tickets, lines }` (`src/commands/land.ts:110,169,172`). `land.ts:43` and `ticket.ts:112-113` branch on `gate.ok` with no try/catch.
- `src/integrations/coordinator-wake.ts:39-47` branches on `outcome.ok` from a Herdr call.

**Where a union removes try/catch noise:**

- `src/integrations/github-poller.ts:168-172` and `:322-326`: a try/catch exists only to map `ENOENT` to "no claim yet". A `readClaim()` that returns `{ ok: false; reason: "missing" | "invalid" }` lets both callers branch, and gives the shape check a home (section 4).
- `src/runtime/hosted-uncertainty.ts:10-13`: `catch {}` hides both a missing file and bad JSON. A union would say which one happened.
- `src/commands/github.ts:48-52`: a try/catch only replaces the `SyntaxError` text. A guard that returns `undefined` on bad input does the same in one line.

| Option | What a caller writes | Cost for limen |
|---|---|---|
| `throw` + early return (today) | nothing; failure is invisible in the type | try/catch at each "expected failure" site |
| Hand-rolled union, declared in the module that returns it | `if (!r.ok) return …` (TypeScript narrows) | none; already used (`frontmatter.ts:14`) |
| neverthrow 8.2.0 (`Result`, `ResultAsync`, `map`, `andThen`, `match`) | method chains on classes | a runtime dependency; classes against the styleguide; its README recommends `eslint-plugin-neverthrow` to force handling, and limen lints with Biome only (https://github.com/supermacro/neverthrow#readme) |
| Effect 4.0.1 (typed error channel, `Effect.gen`, `Data.TaggedError`, `catchTag`) | every effectful function returns `Effect<A, E, R>` | rewrites every async function; 49.6 MB unpacked; the docs call the learning path "a few focused days" (https://effect.website/docs/v4/onboarding, https://effect.website/docs/error-management/expected-errors/, a v3 page) |

**Recommendation.** Keep `throw` for command failures. Use a local `{ ok: true; … } | { ok: false; … }` union only where the caller branches on an expected failure, as `frontmatter.ts` and `landTicketCheck` already do. Do not add a shared `Result` type file; the styleguide forbids `types.ts` and helper bags.

## 3. Job lifecycle as a state machine

**Model.** `src/job/job.ts:6-12` types four phases (`running`, `done`, `failed`, `stopped`). `TERMINAL_STATES` and `isTerminal` are at `job.ts:23-25`. The `state` file is the commit point that observers read (`src/job/record.ts:38`). An empty or missing file is a job still starting; `jobs` shows it as running while `startingJob` holds (`src/commands/jobs.ts:275`).

**Real transitions** (`none` = no `state` file yet):

| From → to | Writer | Where |
|---|---|---|
| none → running | `spawn` command | `src/commands/spawn.ts:231` |
| none → running | `continue` command (new job dir) | `src/commands/continue.ts:166` |
| running → running | detached wrapper, after handshake; unguarded rewrite | `src/runtime/wrapper.ts:154` |
| none → failed | `spawn` when group launch fails | `src/commands/spawn.ts:226` |
| none → stopped | `group stop` for a reserved slot that never launched; plain `writeFile`, bypasses `finalizeJob` | `src/commands/group.ts:288` |
| running → done | wrapper, engine exit 0 | `src/runtime/wrapper.ts:243` |
| running → done/failed | hosted supervisor, agent finished | `src/runtime/supervisor.ts:168` |
| running → failed | wrapper | `wrapper.ts:48,83,239,244,249` |
| running → failed | hosted supervisor | `supervisor.ts:73,102,188,199,245` |
| running → failed | launch and handshake failures | `spawn.ts:277,351,570`, `continue.ts:222` |
| running → failed | reaper, process group gone | `src/runtime/reap.ts:81` |
| running → stopped (or done when the reason starts `done:`, `record.ts:33`) | `stop` command | `src/commands/stop.ts:27,61` |
| running → stopped | wrapper, signal; supervisor, stop request | `wrapper.ts:238`, `supervisor.ts:174,181,241` |
| terminal → anything | refused by `finalizeJob` | `src/job/record.ts:35` |

Every terminal write goes through `finalizeJob` (`record.ts:34-41`) except `group.ts:288`. The guard at `record.ts:35` is check-then-write, so two processes can still race between `:35` and `:41`. `wrapper.ts:154` has no guard: a `stop` or reap that lands between the handshake (`wrapper.ts:153`) and that write would be overwritten with `running` `[INFERENCE: window is short; not reproduced]`.

**Hand-rolled table.** One `const` map and one writer in `src/job/record.ts`:

```ts
const NEXT = { none: ["running", "failed", "stopped"], running: ["running", "done", "failed", "stopped"], done: [], failed: [], stopped: [] } as const satisfies Record<"none" | Job["phase"], readonly Job["phase"][]>;
```

`writeState(jobDir, next)` reads the current file, refuses a move not in `NEXT`, then calls `atomicWrite`. `finalizeJob` calls it, and so do the four direct writers above. The diff is small, adds no dependency, and puts every allowed move on one line. It does not remove the cross-process race; that needs a lock or an exclusive create, which is a separate decision.

**XState 5.33.2.** XState models in-memory actors built with `setup({ types }).createMachine(…)` (https://stately.ai/docs/setup). To persist, you call `actor.getPersistedSnapshot()`, store the JSON, and restore with `createActor(machine, { snapshot })`. The docs warn that a restored snapshot can be incompatible after the machine changes (https://stately.ai/docs/persistence). Limen's state is one word in a file with seven writers (`spawn`, `continue`, `stop`, `group stop`, the wrapper, the hosted supervisor, the reaper; table above), and the hook and `jobs` read it as plain text. XState would add restore → send → persist in each writer, or replace the plain file with a snapshot blob. It gives no help with the cross-process race.

**Recommendation.** Hand-rolled table plus one `writeState`. Not XState.

## 4. Validation at edges

**JSON.** `src/` and `hook/` hold 41 `JSON.parse(` calls in 22 files. Most cast with `as T` and check nothing. The five riskiest, read from data that another process or GitHub wrote:

1. `src/integrations/github-poller.ts:83`: every GitHub REST response is `(await response.json()) as T`. The whole poller trusts GitHub's shape.
2. `src/integrations/github-poller.ts:169` (also `:323`, `:477`, and `src/commands/github.ts:89,119,167`): claim files cast to `GithubClaim`. The seat poller writes them under another user; the coordinator reads them. `github.ts:90` calls `claim.repo.toLowerCase()` on the cast value, so a bad file gives a `TypeError`, not a message.
3. `src/job/group-cabinet.ts:48`: `run.json` cast to `GroupRun` (about 20 fields, `group-cabinet.ts:13-35`). Every group member reads it; its deadline decides whether a job starts (`wrapper.ts:47`).
4. `src/job/group-events.ts:51` (also `:197`, `:215`): events and receipts cast to `GroupEvent` and `GroupReceipt`. Peer jobs write them at the same time.
5. `src/project/git.ts:23`: `run.json` cast inline, then used to accept or refuse a group routing identity (`git.ts:24-25`).

**Env vars.** 57 distinct `process.env` names; 16 reads go through `Number(...)` with at least three different fallbacks: finite and positive (`supervisor.ts:37-38`), `|| default` (`stop.ts:23`), and no check (`wrapper.ts:51`: a non-numeric `LIMEN_TIMEOUT_MS` gives `NaN`).

**CLI args.** Section 1.

**Guards already in the code:** `isProcessInfo` (`src/runtime/contain.ts:198`), `record` and `token` (`src/integrations/finish-turn.ts:25-33`), the inline array check at `src/runtime/engine.ts:133`, and the field checks at `src/runtime/hosted-binding.ts:43`.

| Option | How it reads | Facts read this session |
|---|---|---|
| Hand-written guard `function isGroupRun(value: unknown): value is GroupRun` | one guard beside each type | no dependency; same pattern as `contain.ts:198`; type and guard can drift apart |
| Zod 4.6.5 | `const GroupRun = z.object({…}); type GroupRun = z.infer<typeof GroupRun>`; `safeParse` returns a discriminated union | type comes from the schema, so no drift; `zod/mini` is a functional variant in the same package, and its own docs say to use it only under strict bundle limits (https://zod.dev/basics, https://zod.dev/packages/mini) |
| Valibot 1.5.0 | `v.object({…})`, `v.safeParse`, `v.is` as a type guard | many small functions; "no dependencies" (https://valibot.dev/guides/introduction/) |
| ArkType 2.2.7 | TypeScript-like string syntax | three runtime dependencies; docs strongly recommend `skipLibCheck` (https://arktype.io/docs/intro/setup) |

**Recommendation.** Hand-written guards for the five files above, one guard next to each type (`isGroupRun` in `group-cabinet.ts`, `isGithubClaim` beside `GithubClaim`). Read as `unknown`, guard, and return a union or throw a message. If the owner ever allows one runtime dependency, Zod is the candidate: it is the only one that removes type/guard drift and has no runtime dependencies of its own.

## 5. Verdict table

Sizes are `dist.unpackedSize` from `npm view`. "None" means `npm view` printed no `dependencies` field.

| Library | Version | Runtime deps | Unpacked size | Benefit for limen | Cost | Conflict with "runtime dependencies empty" | Recommend now |
|---|---|---|---|---|---|---|---|
| Effect | 4.0.1 | none | 49,597,078 B (49.6 MB) | typed errors, retries, DI | whole-program rewrite of every async function | yes | **no**: it changes every function signature to solve a problem `main.ts:157-160` already solves for a CLI |
| XState | 5.33.2 | none | 2,313,340 B (2.3 MB) | visual, typed machine | restore/persist in seven writers; no help with the file race | yes | **no**: four states in a text file need a `const` table, not an actor runtime |
| Zod | 4.6.5 | none | 6,140,311 B (6.1 MB) | one schema gives type and check | first runtime dependency; breaks `test/structure.test.ts:24-29` | yes | **no**: five guards cover the risky reads without breaking the zero-dependency rule (`spec/vision.md:12`) |
| neverthrow | 8.2.0 | none | 112,467 B (112 KB) | `Result` combinators | classes; needs an ESLint plugin to force handling | yes | no |
| Valibot | 1.5.0 | none | 1,865,457 B (1.9 MB) | small schema functions | same as Zod | yes | no |
| ArkType | 2.2.7 | 3 | 340,244 B (+ deps) | terse syntax | three dependencies; `skipLibCheck` | yes | no |
| `node:util` `parseArgs` | built in (Node ≥18.3, stable v20) | none | 0 | one table per command; strict errors fix `--label --tab` | Node error wording; dash words in task text need `--` | no | **yes** |
| Hand-rolled unions and guards | n/a | none | 0 | explicit failure branches; checked JSON edges | guard can drift from type | no | **yes** |

## 6. Open picks for Adam

1. Move the nine flag loops to `parseArgs` and accept Node's error wording? I would pick yes.
2. Route every `state` write through one `writeState` with a transition table in `src/job/record.ts`? I would pick yes.
3. Keep zero runtime dependencies and hand-write guards for the five riskiest JSON reads, or allow Zod as the one exception? I would pick guards.

## Appendix: raw npm view output

Command: `for p in effect xstate zod valibot neverthrow arktype; do npm view $p version dependencies dist.unpackedSize; done` (npm config warning lines removed).

```
== effect
version = '4.0.1'
dist.unpackedSize = 49597078
== xstate
version = '5.33.2'
dist.unpackedSize = 2313340
== zod
version = '4.6.5'
dist.unpackedSize = 6140311
== valibot
version = '1.5.0'
dist.unpackedSize = 1865457
== neverthrow
version = '8.2.0'
dist.unpackedSize = 112467
== arktype
version = '2.2.7'
dependencies = { arkregex: '0.0.12', '@ark/util': '0.56.6', '@ark/schema': '0.56.6' }
dist.unpackedSize = 340244
```
