# Outcome

`limen jobs --label PREFIX` lists jobs whose label starts with that prefix, including terminal jobs the default snapshot hides. A miss prints `nothing matched` and does not dump `--all`. Default snapshot, `--all`, and single-id lookup are unchanged. Landed `4cc8bc9`. Focused jobs tests passed. Full native: TypeScript and Biome passed, 402 pass / 1 fail; the miss is the existing wake-sweep timing bound, isolated rerun 8/8. Prefix match only: a feature number at the end of a label is not a prefix. Adam reviews; no independent reviewer.
