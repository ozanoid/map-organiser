---
title: Observability Flow (Axiom + OTel + structured logs)
type: flow
domain: infra
version: 1.0.0
last_updated: 20.05.2026
status: stable
sources:
  - instrumentation.ts
  - src/lib/telemetry/logger.ts
  - src/app/api/ai/parse-query/route.ts
  - src/app/api/ai/rank-results/route.ts
  - src/app/api/places/route.ts
related:
  - "[[ai-search-flow]]"
  - "[[../02-backend/api-routes/ai]]"
---

# Observability Flow

Single-tool stack for app + LLM telemetry. Everything ends up in **Axiom**;
queryable, traceable, correlatable.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       Axiom (dataset: vercel)               │
│  ─ Structured JSON logs (queryable fields)                  │
│  ─ OTel spans (incl. gen_ai.* from AI SDK telemetry)        │
│  ─ Vercel runtime telemetry (report.durationMs, memory)     │
│  ─ Edge request logs (path, status, IP, userAgent)          │
└─────────────────────────────────────────────────────────────┘
              ▲                              ▲
              │ Vercel Log Drain             │ OTLP traces
              │ (auto, console.log → JSON)   │ (via @vercel/otel)
              │                              │
   ┌──────────┴───────────┐      ┌───────────┴──────────┐
   │  API routes          │      │  AI SDK generateText  │
   │  log.info("event",   │      │  experimental_telem-  │
   │           { attrs })  │      │  etry: isEnabled=true │
   └──────────────────────┘      └───────────────────────┘
              │                              │
              └──────────  same trace_id ─────┘
                  (OTel context propagates
                   between log + span)
```

## The two pipes

### Pipe 1 — Vercel Log Drain (logs)

Set up automatically by the Vercel-Axiom marketplace integration.
Every `console.log` / `console.warn` / `console.error` in API routes,
middleware, and edge functions ships to Axiom dataset `vercel` within
seconds.

We emit **structured JSON** via `log.*` helpers (see `src/lib/telemetry/logger.ts`).
Each line becomes a queryable record in Axiom with these fields:

```
{
  level:     "info" | "warn" | "error" | "debug",
  event:     "ai.parse-query" | "ai.rank-results" | "api.places" | ...,
  timestamp: "2026-05-20T00:20:47.123Z",
  traceId:   "abc123..."  // present when OTel context is active
  spanId:    "def456...",
  ...attrs   // event-specific payload
}
```

### Pipe 2 — OTel spans (traces)

`instrumentation.ts` registers `@vercel/otel` at process boot.
`@vercel/otel` auto-detects Vercel's platform OTel pipe (set up by the
Axiom integration) and forwards spans to Axiom.

AI SDK's `generateText({ ..., experimental_telemetry: { isEnabled: true,
functionId, metadata } })` produces spans with **GenAI semantic
conventions**:

```
gen_ai.system                = "google_genai"
gen_ai.request.model         = "gemini-flash-latest"
gen_ai.usage.input_tokens    = 16553
gen_ai.usage.output_tokens   = 1722
gen_ai.prompt                = "<full system + user prompt>"
gen_ai.completion            = "<full LLM response>"
gen_ai.response.finish_reason = "stop"
```

The `functionId` is the span name (e.g. `ai.parse-query`); `metadata`
becomes span attributes (e.g. `userId`, `candidateCount`).

## Correlation via trace_id

Every Axiom record (log OR span) emitted within a single request
shares one `traceId`. In Axiom Stream / Query, filter
`traceId = "abc123..."` and you get the full timeline:

```
00:20:47.121  span   POST /api/ai/parse-query    (HTTP)
00:20:47.342  span   gen_ai.request               (parse-query LLM call)
              attrs: gen_ai.usage.input_tokens=412 etc.
00:20:47.844  log    event=ai.parse-query         (sanitized hard + intent)
00:20:48.011  span   GET /api/places              (refetch with new filter)
00:20:48.245  log    event=api.places             (sql_rows=25 returned=25)
00:20:48.567  span   POST /api/ai/rank-results
00:20:54.123  span   gen_ai.request               (rerank LLM call)
              attrs: gen_ai.usage.input_tokens=16553 etc.
00:20:54.456  log    event=ai.rank-results        (top5, hidden_count, etc.)
```

End-to-end debugging without grep.

## Where instrumentation lives

| File | What it does |
|---|---|
| `instrumentation.ts` (root) | Boots OTel for the Node.js runtime. Single call: `registerOTel({ serviceName: "map-organiser" })`. Auto-detects Vercel-Axiom OTel pipe. |
| `src/lib/telemetry/logger.ts` | `log.{debug,info,warn,error}` helpers. Outputs structured JSON to stdout/stderr → Vercel Log Drain → Axiom. Auto-attaches `traceId`/`spanId` from current OTel context. |
| `src/app/api/ai/parse-query/route.ts` | `experimental_telemetry: { isEnabled: true, functionId: "ai.parse-query", metadata: { userId, queryLen } }` on the generateText call. `log.info("ai.parse-query", { ... })` for diagnostic record. `log.error("ai.parse-query.llm_failed", err, ...)` on failure. |
| `src/app/api/ai/rank-results/route.ts` | Same pattern, with extra `log.warn` events for `out_of_range_idx`, `duplicate_idx`, `skipped_candidates`, `salvaged`. Top-5 and full-ranked emitted as structured arrays, not stringified. |
| `src/app/api/places/route.ts` | `log.info("api.places", { filters, sql_rows, returned, ... })` — only when `city` is present (AI search path). Manual browsing path stays silent. |

## Event taxonomy

Predictable `event` names so Axiom queries / dashboards are stable:

| Event | Source | Level |
|---|---|---|
| `ai.parse-query` | parse-query route, success | info |
| `ai.parse-query.llm_failed` | parse-query catch | error |
| `ai.rank-results` | rank-results route, success | info |
| `ai.rank-results.full_ranked` | rank-results route, success | debug (verbose) |
| `ai.rank-results.llm_failed` | rank-results catch | error |
| `ai.rank-results.salvaged` | rank-results, schema-failure-recovered | warn |
| `ai.rank-results.salvage_failed` | rank-results, salvage also failed | error |
| `ai.rank-results.out_of_range_idx` | LLM returned idx ≥ N | warn |
| `ai.rank-results.duplicate_idx` | LLM returned same idx twice | warn |
| `ai.rank-results.skipped_candidates` | LLM omitted candidates | warn |
| `api.places` | /api/places GET on AI-search path | info |

Add new events here when introducing new instrumentation.

## How to debug in Axiom

### Trace a single user session
```
['vercel']
| where ['traceId'] == "abc123..."
| sort by ['_time']
```

### LLM cost over time
```
['vercel']
| where ['attributes.gen_ai.usage.input_tokens'] != ""
| summarize sum(toint(['attributes.gen_ai.usage.input_tokens'])),
            sum(toint(['attributes.gen_ai.usage.output_tokens']))
            by bin(_time, 1h), ['attributes.gen_ai.request.model']
```

### Which queries trigger LLM laziness (skipped candidates)
```
['vercel']
| where ['event'] == "ai.rank-results.skipped_candidates"
| project _time, ['userId'], ['count'], ['total'], ['missing']
| sort by _time desc
```

### p95 latency per route
```
['vercel']
| where ['report.durationMs'] != ""
| summarize percentile(toint(['report.durationMs']), 95)
            by ['request.path']
```

## Diagnostic toggles

| Surface | Production default | How to enable |
|---|---|---|
| Server logs (`log.*`) | ON | n/a — always emitted |
| Server `log.debug` lines | ON (no extra gate currently) | n/a |
| Client `[ai-search/*]` console logs | OFF | `localStorage.setItem("ai-debug","1"); location.reload()` |
| OTel spans (incl. gen_ai.*) | ON | Bound to `@vercel/otel` register; runtime auto |
| `window.__aiSearchStore` | OFF | same localStorage flag |

If log drain costs climb later, demote `ai.rank-results.full_ranked`
from `info` to `debug` and add a server-side debug gate. Currently it
is emitted as `log.debug` already.

## Cost expectations

For F&F scale (estimated):
- Log drain volume: ~1-3 GB/month → ~$1-2 / month (Vercel Pro `$0.50/GB`).
- OTel ingestion: well within Axiom free tier (500 GB/month).
- AI SDK telemetry adds ~5% to span payload (prompt + completion bytes).

Monitor monthly via Vercel dashboard → Usage → Logs.
