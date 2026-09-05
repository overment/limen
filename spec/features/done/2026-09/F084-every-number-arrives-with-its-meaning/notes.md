# What the corpus says, and why the cue is the seam

Corpus: 1,276 replies the coordinator actually sent the owner across 147
conversations at Alice, 31 August to 5 September, extracted from the Pi session
files as the last assistant text before each human turn. 184,827 words, median
59 words per reply. Tickets: the 160 `ticket.md` files in that project.

## Counts

| Measure | Replies | Tickets |
|---|---|---|
| Feature numbers in prose | 2,828 | 995 |
| Of those, meaning first and number in parentheses | 126 (4%) | 107 (11%) |
| Number as the subject of a sentence | 282 | 53 |
| Number as the first word of the reply | 129 | — |
| Bare pairs, `F375/F376` or `F385 and F393` | 162 | — |
| Commit hashes with no noun before them | 191 of 447 | — |
| Replies naming the machinery but never the reader | 599 (47%) | — |
| Hyphenated modifiers per 1,000 words | 11.3 | 13.3 |

Twelve percent of replies are a job's state and nothing else: *X is running, Y
is clean.*

## The disease is not generic AI filler

Checked against the usual markers, per thousand replies: `delve` 0, `moreover`
0, `furthermore` 0, `crucial` 0, `robust` 0, `tapestry` 0, `it is worth noting`
0. The register already removed that layer. What remains is the opposite
failure — correct, dense, and unreadable to anyone who was not in the work.

## Before and after, from the corpus

**Sent:** F379 is in flight. F380 waits.

**Readable:** Putting live chat on one surface is running (F379). Letting an
answer carry a durable form is waiting behind it (F380).

---

**Sent:** F425 is running in its own tab. F426 stays planned: it extracts the
editor F425 still owns, so the two cannot run in parallel.

**Readable:** The composer is learning to speak markdown and stop carrying image
bytes (F425); it has its own tab. Editing a document without rewriting untouched
bytes stays planned (F426) — it pulls out the same editor, so the two cannot run
at once.

---

**Sent:** Pushed `alice-v6` to GitHub. Remote now points to `5d6df658`.

**Readable:** Pushed the main line to GitHub. It now points at the commit that
merged quiet tool rows (`5d6df658`).

## Why this is not a placement fix

The rule is already in three places. `templates/communication.md` states it with
five worked examples. `hook/communication.ts` puts it in the cue that rides every
turn: *No identifier without its meaning.* The specs reminder carries its ticket
form: *no bare feature numbers.* The board digest already injects the NOW and
NEXT sections, so the meaning of anything in flight is in context when the reply
is written.

Compliance is four in a hundred anyway, and the worst examples above are about
work that was in flight, whose titles were on screen.

So the failure is not that the rule is absent, unread, or short of data. It is
that the cue compresses the rule into a property — *no identifier without its
meaning* — and a property reads as satisfied by any sentence that mentions the
thing. The register's five before-and-after pairs are the part that actually
teaches the move, and they are read once per call, at the start, not at the
moment of writing.

The change is to make the cue name the failing sentence rather than the virtue.

## Open question

Nothing counts this after the fact. The measurement above is thirty lines of
throwaway script over the session files. The quality role already reads a
stretch of landed work and writes findings; reading the coordinator's own last
hundred replies and reporting this ratio would cost that role one paragraph and
would tell you whether the cue worked. Not proposed here — it widens the role.
