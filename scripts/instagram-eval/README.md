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

## Cost per full run (35 posts)

- HikerAPI ≈ 4 requests per post ≈ 145 requests ≈ $0.15 at $1 / 1,000
- Google Text Search (Enterprise SKU) ≈ 3 per post ≈ 110 — free inside the 1,000 monthly, $35 / 1,000 beyond
- Gemini 3 Flash ≈ 35 calls ≈ $0.05

## Known limits (2026-10-16)

- Chain branches that only the photos identify (e.g. a café chain in a "best study cafés" list) are skipped, not guessed.
- Gemini output varies between runs; precision held in every run (three prototype samples, three production runs), recall moves by about one place (37–38 of 43).
- Posts get deleted over time; an `ERROR post_unavailable` line means the label set needs a replacement post.
