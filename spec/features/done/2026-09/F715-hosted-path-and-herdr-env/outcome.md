# Outcome

Hosted Herdr tabs now get `HERDR_ENV=1` and a PATH that starts with `/usr/bin`, so `git` resolves in the tab. Detached watch tabs still pass no `--env`. Landed `ccf3e7e`, budget bump `75cf1a7`. Discriminating hosted-start test passed. Full native: TypeScript and Biome passed, 401/402 tests passed; the miss is the existing wake-sweep timing bound (44 ms vs 20 ms), not this change, and was not repaired. Herdr 0.8 already accepts `tab create --env`; no Herdr-side ask. Adam reviews; no independent reviewer.
