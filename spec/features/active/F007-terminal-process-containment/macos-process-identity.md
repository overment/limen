# macOS process birth identity

## Decision

Use the Darwin `proc_pidinfo(pid, PROC_PIDTBSDINFO, ...)` birth timestamp, not
`ps`'s `lstart`, as the identity paired with every escaped PID:

```text
ProcessIdentity = { pid, bornSeconds, bornMicroseconds }
```

`struct proc_bsdinfo` exposes `pbi_start_tvsec` and `pbi_start_tvusec`; the
public macOS SDK declares the API in `usr/include/libproc.h` and those fields in
`usr/include/sys/proc_info.h`. The microsecond pair is the required resolution:
`ps -o lstart` is only `%c` time (whole seconds), so the current F007 repair
branch's `startedAt: lstart` comparison cannot substantiate the PID-reuse
acceptance.

Implement the query through a small, shipped Ruby helper using the standard
`Fiddle` library and `/usr/lib/system/libsystem_kernel.dylib`'s
`proc_pidinfo`. This is a dependency-free macOS CLI boundary: no npm package,
native addon, compiler, or shell interpolation. Node invokes `/usr/bin/ruby`
with an absolute helper path and a decimal PID, reads one JSON result, and gives
the helper a short timeout. The helper must fail rather than invent an identity
when Ruby/Fiddle or `proc_pidinfo` is unavailable.

The helper should return the public `proc_bsdinfo` fields needed by F007:

```json
{"pid":123,"ppid":77,"pgid":123,"born":"1786736391.120227","command":"node"}
```

Use fixed-width offsets from the documented ABI only inside the helper (or
prefer a 15-line C helper compiled and shipped with the release if Limen stops
supporting the macOS system Ruby). Keep the TypeScript contract as the JSON
above. `pbi_comm` is sufficient for a cleanup note; command arguments are
observational only and must never be part of the identity comparison.

## Capture and signal rule

1. While the wrapper's parent chain still identifies ownership, capture every
   escaped descendant with its `ProcessIdentity`. The existing `ps` walk in
   `src/proc.ts` can be replaced by the helper's `ppid`/`pgid` data; this also
   removes format-sensitive `ps` parsing.
2. Just before **each** `SIGTERM` and `SIGKILL`, query that exact PID again.
   Signal only when `{ pid, born }` equals the captured identity. A missing,
   malformed, changed, timed-out, or permission-denied query is *unconfirmed*:
   do not signal it and record the captured PID, birth identity, and last known
   command in `cleanup`.
3. Re-query after each grace period. A matching identity still present becomes
   a durable survivor; a changed or absent identity is not a survivor owned by
   this job.

The two queries and `kill(2)` are necessarily separate ordinary-user system
calls. macOS has no public pidfd-style, race-free signal handle usable here;
the comparison rejects a replacement observed at re-verification, but cannot
make that final syscall atomic. F007 must therefore keep its stated
best-effort scope and never claim sandbox-grade containment.

## Terminal-state boundary

Discovery and cleanup remain advisory, but attribution must finish while the
wrapper's parent chain is intact. Await the bounded pre-TERM process snapshot,
including captured birth identities, before sending the process-group TERM.
A failed or timed-out snapshot writes `cleanup`; after that short bound,
termination and terminal-state finalization proceed normally. Each process
query remains bounded (currently at one second) and its own detached process
group is killed on expiry.

Only the ownership snapshot sits on the stop/timeout path. After TERM, identity
rechecks, escaped-process TERM/KILL grace periods, and survivor recording
continue in an error-contained task and do not delay `stopped` or `failed`.
This avoids losing attribution when Pi exits immediately on TERM while keeping
a hung process query bounded. A descendant that detaches and exits its parent
before the pre-TERM snapshot begins still cannot be attributed safely; record
the discovery failure rather than broadening cleanup into a pattern kill.

## Small proof plan

1. Unit-test helper output for the current process: PID and decimal
   `seconds.microseconds` are present; an impossible PID returns no identity.
2. Spawn two short-lived processes in the same wall-clock second and assert
   their birth values differ or, at minimum, retain microsecond precision. This
   proves the test is not accidentally exercising `ps lstart`.
3. Keep F007's mocked PID-reuse seam, but capture identity A and make the
   recheck return identity B for the same PID. Assert neither TERM nor KILL is
   sent to B and `cleanup` records an unconfirmed replacement.
4. Make process discovery sleep past its bound for both `limen stop` and
   `--timeout`. Assert each path waits no longer than that short bound, writes a
   cleanup warning, and then reaches its terminal state.
5. On a real macOS runner, repeat the detached-child stop/timeout test and
   assert the captured identity matches before the child receives KILL. Run
   `npm run check`.
