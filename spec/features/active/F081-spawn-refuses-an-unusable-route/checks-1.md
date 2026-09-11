# Hosted transport landed; route refusal is unresolved

Only the tested hosted-continuation transport and its regressions landed, as `a3872a68ae1b408dabc6ef57d7f645971c08abfc`. The two source/test files exactly match worker candidate `b14b5fedb5b9eefe150d569427cebe63c6c53ba6`; the entire candidate was not merged. Continuation text now uses Pi's `@continue` file transport and arrives inside Pi's file wrapper, rather than entering shell argv as multiline text.

The candidate's failing route-refusal test remains unskipped on its unchanged branch, with its failure log outside the worktree. `route-refusal-regression.patch` additionally retains that counterexample beside this ticket as a zero-context patch. It is not part of main's executable test lane because route refusal is not implemented or claimed. The candidate worktree is Git-locked while the interface/spend decision remains open.

## Evidence

Root: `/home/overment/limen/tmp/evidence/f081-3241d718/`.

- Worker focused spawn/hosted suites: 70 passed, one route-refusal failure. All hosted checks passed.
- Worker full native lane, once: TypeScript/Biome passed; 378 passed, one route failure, one registry-lock timeout, exit 1. No full rerun or unrelated repair.
- Coordinator typecheck and the two transport/continuation tests passed at the transport-only landing (`coordinator-transport.log`).
- Coordinator also reran the retained installed-Pi parser/file-processor proof: exact bytes and continuation selection passed without generation. No live Herdr/Pi model turn or provider call was used for this proof.

## Open decision

The installed auth implementation resolves model credentials, not inference routability. No supported non-generating route validation interface was found. `interface-question.md` records the exact installed interfaces and asks whether to wait for a Pi-owned check or authorize generated-probe cost and latency. Recommend waiting for Pi rather than adding a generated turn to every spawn; no probe spend is authorized here.

F081 remains ACTIVE and unproven. Hosted startup verification can proceed independently on the landed transport fix; that does not waive route refusal. Adam's delivery instruction authorizes the partial landing, not a claimed Adam candidate-review verdict. No independent reviewer was spawned, and the parked wake-ceiling candidate was untouched.
