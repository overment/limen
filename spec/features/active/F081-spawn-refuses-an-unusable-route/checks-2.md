# Route refusal waits on a supported zero-generation interface

Adam's continuation forbids paid route probes without proven zero spend or explicit spend authorization. Catalog presence and authentication readiness are not route proof. The preferred path is to retain the failing counterexample and wait for Pi-supported non-generating validation of the resolved provider/model/API endpoint.

Coordinator rechecked installed Pi 0.84.2 at main `713cf54`: its `dist/cli/auth-check.js` implementation and `dist/core/model-runtime.d.ts` interface are byte-identical to the previously inspected copies. Auth checks resolve provider credentials; the model interface exposes catalog/auth operations and generated stream/complete operations, not an exact-route non-generating probe. No auth call, catalog refresh, generated turn or provider request was made. Results are retained in `/home/overment/limen/tmp/evidence/f081-3241d718/coordinator-interface-refresh.log`.

Hosted continuation transport is already landed at `a3872a68ae1b408dabc6ef57d7f645971c08abfc`. The installed-Pi parser/file-processor check passed again: continuation selection and exact text bytes travel through `@continue` without generation. No additional unlanded safe transport was identified in the retained candidate.

The auth-ready batch-only counterexample remains on unchanged, locked candidate `b14b5fedb5b9eefe150d569427cebe63c6c53ba6` and in `route-refusal-regression.patch`. Real refusal is unimplemented and unproven. The next implementation requires a Pi-supported non-generating probe or Adam's explicit generated-probe authorization with spend/latency/retry limits; absent either, do not substitute auth success, catalog availability or guessed free requests.
