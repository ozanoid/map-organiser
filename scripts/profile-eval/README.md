# Place profiles — which model writes them

`npm run eval:profiles` writes the profiles of the 10 places in `places.json`
(the owner's library: London, Istanbul with Turkish reviews, Lisbon, Amsterdam;
food and not) with each writer, from the same prompts the app uses
(`profileInputs` in `src/lib/ai/generate-profile.ts`). Nothing is saved and no
tag or category suggestion is applied.

```bash
npm run eval:profiles
```

```bash
npm run eval:profiles -- --writers=claude-haiku-5-5:high,claude-sonnet-5-5:medium
```

Writers: `gemini` (production today), `claude-haiku-5-5:<effort>`,
`claude-sonnet-5-5:<effort>`. Each runs over every place before the next, so a
Claude writer reads the shared instructions (~8K tokens) from the cache.

Measured per writer: profiles written, quotes found word for word in the
place's reviews (theme evidence; a quote not found was reworded or made up),
time, tokens (thinking included), cost. Claude calls go to `assistant_spend`
(purpose `eval`, the owner's account); Gemini's are priced at the app's SKU
($0.0095 a profile), not recorded here. Every profile and its measures land in
`out/<time>.json` (git-ignored: library content).

## Measured 24.11.2026

| Writer | Profiles | Quotes found | Time | Per profile |
|---|---|---|---|---|
| Gemini 3 Flash | 10/10 | 62/74 (84%) | 30.1 s | $0.0095 (SKU) |
| Claude Haiku 5.5, high | 10/10 | 84/89 (94%) | 40.0 s | $0.006 |
| Claude Sonnet 5.5, medium | 10/10 | 99/102 (97%) | 14.7 s | $0.047 |

Side by side: https://claude.ai/artifact/5GY7RV3aX3fio8qatL4cUN (private).
