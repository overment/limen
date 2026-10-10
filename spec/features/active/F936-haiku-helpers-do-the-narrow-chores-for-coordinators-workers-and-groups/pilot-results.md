# Pilot results: lead-only compared with Haiku-scout-first

Run on 2026-10-10, 15:05 to 15:54 UTC, as `pilot.md` says, with one change that Adam approved: the lead is `--engine omp --provider pi-claude --model pi-claude/claude-opus-5-5 --thinking high --timeout 45m` in both arms. The helper is `--model pi-claude/claude-haiku-5-5 --thinking medium --timeout 15m --role scout` (`templates/scout.md`). Every job ran `--detached` with `--prepare "npm ci --no-audit --no-fund"`, in a disposable clone that holds history only up to the task's base and has no remote. The ten lead jobs ran at the same time. The Mac's load average was 270 to 340 during the pilot (12 users), so wall times are noisy, and six of ten leads hit the 45-minute timeout while running the full suite. Each of those six committed a candidate first, so the oracle ran on that candidate's tip. No pilot commit reached `main`.

## Results

Seconds come from `started-at` and `finished-at`. The gap is the time from the helper's finish to the lead's start. Tokens are sums over the job's own session turns, as `limen jobs <id>` now shows them. Every helper turn ran `pi-claude/claude-haiku-5-5` in the OMP session, and every Claude Code transcript `message.model` for the five helpers is `claude-haiku-5-5`. Every lead turn ran `pi-claude/claude-opus-5-5`.

| Task | Arm | Oracle | Helper s | Gap s | Lead s | Total s | Lead turns | Lead tokens (in / out / cache read / cache write) | Helper tokens (in / out / read / write) | Wrong findings (top?) | Verified | Retries | Manual fixes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| F770 | lead-only | pass 15/15 (job timed out at 45 min in its full suite) | — | — | 2704 | 2704 | 24 | 48 / 9,079 / 1,106,077 / 53,929 | — | — | — | 0 | 0 |
| F770 | scout-first | pass 15/15 (first run 14/15: hosted test timed out under load; rerun passed) | 37 | 77 | 999 | 1113 | 26 | 52 / 8,745 / 1,089,690 / 27,337 | 10 / 3,474 / 141,191 / 29,034 | 1 (not top): said `docs/remote.md` has no `interactive_ready` text; line 162 has it. The lead caught it. | real (read) | 0 | 0 |
| F728 | lead-only | fail 55/58 (job timed out); same 3 hosted-test timeouts as the other arm | — | — | 2704 | 2704 | 32 | 64 / 9,595 / 1,673,800 / 40,050 | — | — | — | 0 | 0 |
| F728 | scout-first | fail 55/58 (job timed out); same 3 hosted-test timeouts | 38 | 82 | 2707 | 2827 | 34 | 68 / 14,428 / 1,903,817 / 47,056 | 10 / 1,293 / 139,135 / 5,133 | 0 | real (ran the test) | 0 | 0 |
| F933 | lead-only | pass 5/5 | — | — | 836 | 836 | 46 | 92 / 13,585 / 2,731,309 / 58,209 | — | — | — | 0 | 0 |
| F933 | scout-first | pass 5/5 | 57 | 69 | 879 | 1005 | 35 | 70 / 12,403 / 1,866,938 / 45,831 | 12 / 5,770 / 205,965 / 39,770 | 0 | real (read) | 0 | 0 |
| F760 | lead-only | fail 11/13 (job timed out); oracle wants the reference names (`kind: issue`, its refusal text) | — | — | 2703 | 2703 | 50 | 100 / 31,346 / 4,645,318 / 107,128 | — | — | — | 0 | 0 |
| F760 | scout-first | fail 11/13 (job timed out); same 2 tests | 35 | 94 | 2706 | 2835 | 47 | 94 / 29,150 / 4,447,898 / 109,644 | 12 / 3,569 / 197,204 / 19,309 | 0 | real (read) | 0 | 0 |
| F737 | lead-only | no verdict: found the precedence defect against real OMP, then timed out in the full suite | — | — | 2703 | 2703 | 39 | 78 / 13,225 / 1,890,535 / 41,775 | — | — | — | 0 | 0 |
| F737 | scout-first | **fail**: `PASS 2554043`, defect missed | 365 | 78 | 1407 | 1850 | 39 | 78 / 18,500 / 2,365,626 / 61,752 | 16 / 5,573 / 265,645 / 16,993 | 0 false claims; it marked native precedence as covered by a test and missed the defect | real (ran tests) | 0 | 0 |

Change from lead-only to scout-first in the lead job (helper not included):

| Task | Lead turns | Lead cache read | Lead output | Total wall time |
|---|---|---|---|---|
| F770 | +8 % | −1 % | −4 % | −59 % (the lead-only job timed out in its full suite) |
| F728 | +6 % | +14 % | +50 % | +5 % (both timed out) |
| F933 | −24 % | −32 % | −9 % | +20 % |
| F760 | −6 % | −4 % | −7 % | +5 % (both timed out) |
| F737 | 0 % | +25 % | +40 % | −32 % (the lead-only job timed out) |

The helper cost 139,135 to 265,645 cache-read tokens and 35 to 365 seconds per task. That is 5 to 14 % of the lead's cache read.

## Verdicts

- **Scout before a spawn (F770, F933, F760): keep, on trial.** Both arms pass the oracle on F770 and F933. F760 does not count: both arms fail the same two oracle tests, because those tests use the reference commit's names (`kind: "issue"` and its refusal text). F933 is the clean result: the lead used 24 % fewer turns and 32 % less cache read. F770 is a tie in tokens (−1 %). Its 59 % lower wall time comes from the lead-only job hanging in its full suite under load, not from the packet. One F770 finding was wrong (not the top one), and the lead found and corrected it without a retry. Run F770 and F933 again at normal load before the helper model goes on the board.
- **Failure triage (F728): not kept.** The packet was correct and matched the known answer: recovery accepted only a `pi` or `node` process (`src/integrations/herdr.ts:175`). Both leads still timed out, and both fail the same three oracle tests, which are hosted-job tests that time out under this load. The pilot shows no saving: the scout-first lead used 14 % more cache read. Run it again at normal load.
- **Review pre-pass (F737): cut.** With the packet, the review returned `PASS 2554043` for a candidate with a known blocking defect: a legacy `.pi/skills` entry hides an `.omp/skills` entry with the same name. The packet put native precedence under a passing test. The lead-only review found the defect against real OMP 18.4.4 ("a legacy `.pi/skills/X.md` takes the bare name from a native `.omp/skills/X`"), then timed out in the full suite before it wrote its verdict. This meets the drop rule in spirit: the pre-pass made the review of record miss a blocking finding.

## Surprises

- Haiku 5.5 is fast as a scout: 35 to 57 seconds for the three seam questions and the triage, and 365 seconds when it ran test suites.
- Four of five packets were over the 1,200-character limit (1,353, 1,820, 1,640 and 1,632 characters). Each stayed within 15 lines. The wake keeps only the first 1,200 characters, so the end of the packet does not reach the coordinator. The rule in `templates/scout.md` alone does not keep packets short.
- Every `Verified:` line named a command or read that the helper's session really shows. One packet wrote `Base: not captured` instead of running `git rev-parse`.
- A helper's fixed prompt cost is higher than the study's single-call figure: 139K to 266K cache read per scout job over 5 to 8 turns, not 10K to 15K.
- Six of ten leads used up the 45-minute timeout in `npm run check` at this load. Neither arm can show a time saving while the full suite takes most of a lead's time.
- An oracle copied from a later commit can fail a correct candidate when it pins names from the reference commit (F760). It can also fail on timing alone (F728 hosted tests; F770 scout-first passed 15/15 only on the second run).

## Evidence

The handoffs, the scout packets, the leads' final messages, the oracle outputs, and the bridge probe transcripts are in `.limen/evidence/f936-pilot/` in the canonical root. That folder is not committed. The pilot clones were deleted after the run.
