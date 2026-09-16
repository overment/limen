# Coordinator-owned retirement of the optional spoken response feature

The worker removed runtime playback in `cb3542a`, but cannot change feature state: its instructions explicitly prohibit editing the board, ticket status, or outcome files. The request's retirement acceptance is therefore not complete. Do not interpret this job's eventual `done` state as completion of that acceptance.

Please retire `spec/features/done/2026-08/F046-optional-speech-command/` when integrating this candidate. Recommended: move it to the dropped lane, remove the ticket's obsolete PROVEN status line, and replace the current-tense playback claims in `outcome.md` with a short historical statement that the optional command shipped previously and was subsequently removed at the owner's request. Cite the actual landing commit, not the worker candidate as though it had merged. Reconcile any affected board history as coordinator-owned work; the board currently has only an August aggregate, not an individual F046 entry.

Alternative permitted by the brief: keep the historical done folder but make its outcome unambiguously state removal and eliminate the misleading PROVEN claim. The worker chose neither on the coordinator's behalf.

The original ticket/outcome and board were read but left byte-for-byte unchanged. Existing mixed audit logs need not be rewritten: they describe tests that actually ran before removal. Writing-register guidance is unrelated to audio and must remain unchanged.
