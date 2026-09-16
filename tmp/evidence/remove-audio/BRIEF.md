# Remove audio / speech playback from Limen

Adam: strip audio-related features entirely.

## Scope (product audio only)
- Remove optional `/speak` Pi command and all wiring (F046 optional speech command).
- Delete or retire `hook/speak.ts`, `test/speak-hook.test.ts`, README `/speak` docs, package/hook registration, histories that only exist for speak.
- Move or close the F046 feature folder honestly (done → dropped, or outcome stating removed — follow project styleguide; do not leave a lying “proven” speech feature).
- Do **not** rewrite metaphorical “voice” / “speak” prose in communication guidance (plain writing register ≠ TTS).
- Do **not** touch Alice, API, or other plants.

## Constraints
- Astra x-high worker ok. Focused tests green for the removal. No merge without Adam unless he already authorized full land (he asked to remove entirely — land on job branch; HANDOFF says whether merge is ready).
- Write HANDOFF under tmp/evidence/remove-audio/.

## Success
No `/speak` registration path remains; docs don’t advertise speech; native/focused speak tests gone or replaced by absence checks; candidate ready for Adam.
