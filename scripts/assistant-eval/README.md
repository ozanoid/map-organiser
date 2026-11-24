# Claude agent — eval

Twelve requests Ozan makes of the assistant (`cases.ts`, Turkish and English),
run against his own library (`ozan@maporganiser.com`) through the same loop the
app uses (`src/lib/agent/run-turn.ts`), on one model and effort at a time. It
chose the model and effort the agent starts conversations on
([[docs/_plans/phase-2-assistant]]).

Nothing is written to the library. A call that saves something stops at the
approval card and is recorded (never run), or — in `decline-mark-visited` — is
declined, which tests the resume path. Conversations stay in memory. Read tools
run for real; `search_google_maps` (DataForSEO) makes its own small paid call,
counted in `api_usage` as usual. (`rank_places` called Gemini until 24.11.2026;
it now returns candidates with profiles and the agent ranks them.)

**It costs money.** Every Claude call is written to `assistant_spend` with
`purpose = 'eval'`, so it counts toward the platform's monthly cap. A full run
of the 12 cases cost $1.15 on Opus 5.5 medium, $0.70 on Opus 5.5 low, $0.58 on
Sonnet 5.5 high and $0.35 on Sonnet 5.5 medium (23.11.2026; the eval of that
day, re-runs included, $5.03). The fixed prompt is cached across cases, so the
first case of a run pays its write (~27k tokens: $0.135 on Opus, $0.067 on
Sonnet).

## Run

Free — the size of the fixed prompt (system prompt + tools) per model:

```bash
npm run eval:assistant -- --count-tokens
```

All cases on a config (`opus-medium`, `opus-low`, `sonnet-high`, `sonnet-medium`):

```bash
npm run eval:assistant -- --config opus-medium
```

Some cases, with a spending stop (checked before each case):

```bash
npm run eval:assistant -- --config sonnet-high --cases visit-log,laptop-cafe --max-usd 1
```

Progress and the summary go to stderr; stdout carries the app's JSON log lines.
The full transcript of a run — every tool call, its result, the proposed
writes, the replies, tokens and dollars per step — goes to
`scripts/assistant-eval/out/` (git-ignored: it holds library content).

## What it checks

Per case, automatically: the tools a good answer needs (one of each group),
the write it should propose, and the reply language. The quality of the answer
is read from the transcript — `note` in each case says what a good one does.

The language check counts Turkish against English function words; a one-line
proposal ("Dünkü ziyareti kaydediyorum: …, 4 puan") can have neither and show
as a FAIL — read the transcript. Results of 23.11.2026:
[[docs/_plans/phase-2-assistant#Eval sonuçları (23.11.2026)]].
