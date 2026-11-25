# Instagram import — regression set

`labels.json` holds 35 public Instagram posts with the places they should add,
labelled by hand-checked research (2026-10-16): 25 posts the rules were tuned
on (`set: "dev"`) and 10 never seen while tuning (`set: "holdout"`). Each venue
carries its Google `place_id` (plus `alt_place_ids` for duplicate listings) and
a status:

| status | meaning | an automatic add of it counts as |
|---|---|---|
| `include` | the post features it | correct |
| `optional` | named, but featured-ness is debatable (tour stops, a lounge inside a hotel, host building) | neutral — wrong only if the place differs |
| `ambiguous` | a chain branch the post doesn't pin | unverifiable (error) |
| `not_on_google` / `closed` | no listing to add | unverifiable (error) |

Only venue labels are stored — no captions, profiles or personal accounts.

## Run

```bash
npm run eval:instagram
```

```bash
npm run eval:instagram -- --set=holdout
```

```bash
npm run eval:instagram -- --only=DP4CaeSDBC0
```

It runs `analyzeInstagramPost` (the production code) and writes nothing to the
database. Exit code 1 means a wrong or spurious place — the contract is
precision; recall is reported alongside.

Needs `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD`, `HIKERAPI_KEY`,
`ANTHROPIC_API_KEY` and a Mapbox token in `.env.local`. Each post
line shows the time it took and the searches it made.

### Which model reads the posts (v1.50.0)

```bash
npm run eval:instagram -- --model=claude-haiku-5-5 --effort=high
```

`--model` is `claude-haiku-5-5` (the default, as in production —
`INSTAGRAM_READER`) or `claude-sonnet-5-5`; `--effort` is `low`, `medium` or
`high` (default: production's, `high`). Every read is written to
`assistant_spend` (purpose `eval`, the owner's account); its cost is printed in
the summary. (`gemini`, the default until v1.51.0, went in v1.55.0.)

Measured 24.11.2026 (35 posts, 1 deleted, 42 places to add):

| Reader | Correct | Optional | Wrong / spurious | Recall | Per read |
|---|---|---|---|---|---|
| Gemini 3 Flash | 35 | 1 | 0 | 83.3% | ~$0.0014 |
| Claude Haiku 5.5, high | 36 | 1 | 0 | 85.7% | $0.00076 (34 reads, $0.0259) |

Posts that differed: `C0iuUU3Mspu` and `DWJ0aQljNFx` (Haiku found, Gemini
missed), `DZxOpyQsN3f` (Gemini found, Haiku left an ambiguous candidate out).
Three of Gemini's posts hit network errors in the full run and were run again
with `--only=`.

## Cost per full run (35 posts, measured 18.11.2026)

- HikerAPI 140 requests ≈ $0.14 at $1 / 1,000
- Google Maps search through DataForSEO ≈ 110 searches ≈ $0.22 at $2 / 1,000 (since v1.42.0; before, Google Text Search Enterprise — ≈ 107 searches, free inside the 1,000 monthly, $35 / 1,000 beyond)
- Mapbox city lookups ≈ 27 — free up to 100,000 a month
- Claude Haiku 5.5 (high) ≈ 35 reads ≈ $0.03 (measured 24.11.2026; Gemini 3 Flash ≈ $0.05 before)

About $0.39 a run.

## Known limits (2026-10-16)

- Chain branches that only the photos identify (e.g. a café chain in a "best study cafés" list) are skipped, not guessed.
- Gemini output varies between runs; precision held in every run (three prototype samples, three production runs), recall moves by about one place (37–38 of 43).
- Posts get deleted over time; an `ERROR post_unavailable` line means the label set needs a replacement post.
