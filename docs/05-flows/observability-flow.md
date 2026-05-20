---
title: Observability Flow (Honeycomb, OTel-native)
type: flow
domain: infra
version: 2.0.0
last_updated: 20.05.2026
status: stable
sources:
  - instrumentation.ts
  - instrumentation-node.ts
  - src/lib/telemetry/logger.ts
  - src/app/api/ai/parse-query/route.ts
  - src/app/api/ai/rank-results/route.ts
  - src/app/api/places/route.ts
related:
  - "[[ai-search-flow]]"
  - "[[../02-backend/api-routes/ai]]"
---

# Observability Flow

Single-tool, OTel-native. Everything — traces, LLM spans, structured
logs — flows to **Honeycomb** through one OTLP pipe.

> **History:** v1.0 of this doc used Axiom (Vercel marketplace log
> drain + a separate OTLP attempt). Axiom's free tier caps datasets at
> 2 (one slot taken by the system `axiom-audit` dataset), which blocked
> creating a `Kind: Traces` dataset for OTLP. Migrated to Honeycomb,
> whose free tier has no dataset limit and is OTel-native. Vercel Log
> Drain is no longer used.

## Architecture

```
                  ┌────────────────────────────────────┐
                  │           Honeycomb                │
                  │  ── HTTP request spans             │  ← @vercel/otel auto
                  │  ── fetch spans (Supabase, Gemini) │  ← @vercel/otel auto
                  │  ── gen_ai.* LLM spans             │  ← AI SDK telemetry
                  │  ── structured log records         │  ← OTel Logs API
                  │     (all bound by one traceId)     │
                  └────────────────────────────────────┘
                                  ▲
                                  │  one OTLP/HTTP pipe
                                  │  /v1/traces  +  /v1/logs
                                  │  headers: x-honeycomb-team,
                                  │           x-honeycomb-dataset
                                  │
                  ┌───────────────┴────────────────────┐
                  │       Vercel Function (Next.js)     │
                  │   instrumentation.ts → registerOTel │
                  └─────────────────────────────────────┘
```

No Vercel Log Drain. No second tool. One `traceId` correlates every
span and log from a single request.

## Two signals, one pipe

### Traces

`instrumentation-node.ts` registers `@vercel/otel` with an
`OTLPHttpJsonTraceExporter` → `https://api.honeycomb.io/v1/traces`.

> **Runtime gating:** `instrumentation.ts` is loaded by Next.js for
> EVERY runtime, including Edge (middleware). The OTel log packages
> (`@opentelemetry/sdk-logs`, `exporter-logs-otlp-http`) are Node-only —
> importing them in Edge crashes middleware with
> `MIDDLEWARE_INVOCATION_FAILED`. So `instrumentation.ts` only
> dynamic-imports `instrumentation-node.ts` when
> `NEXT_RUNTIME === "nodejs"`. Middleware (Edge) runs un-instrumented.

Span sources:
- **HTTP request spans** — auto, every route handler invocation. Method,
  path, status, duration as span attributes.
- **fetch spans** — auto, every outbound `fetch` (Supabase REST calls,
  Gemini API calls).
- **gen_ai.* spans** — from AI SDK `generateText({ ...,
  experimental_telemetry: { isEnabled: true, functionId, metadata } })`.
  Carry GenAI semantic conventions:
  ```
  gen_ai.system, gen_ai.request.model,
  gen_ai.usage.input_tokens, gen_ai.usage.output_tokens,
  gen_ai.prompt, gen_ai.completion, gen_ai.response.finish_reason
  ```
  `functionId` is the span name (`ai.parse-query`, `ai.rank-results`);
  `metadata` becomes span attributes (`userId`, `candidateCount`).

### Logs

`instrumentation.ts` also registers a `BatchLogRecordProcessor` wrapping
an `OTLPLogExporter` → `https://api.honeycomb.io/v1/logs`.

`src/lib/telemetry/logger.ts` exposes `log.{debug,info,warn,error}`.
Each call emits an OTel log record:
- `event` → record **body** (primary searchable name in Honeycomb)
- `attrs` → record **attributes**, flattened (see below)
- severity → `severityNumber` / `severityText`
- trace context (traceId, spanId) → **auto-attached** by the OTel SDK
  when emitted inside an active span

Attribute flattening (`flatten()` in logger.ts): OTel log attributes
must be primitives or arrays of primitives. Nested plain objects become
dot-notation keys (`hard.city`); arrays of objects are JSON-stringified
(`top5`); nulls are dropped. Honeycomb's data model is flat, so this is
the natural shape.

## Required env vars (Vercel)

| Env var | Purpose | Default |
|---|---|---|
| `HONEYCOMB_API_KEY` | Honeycomb write/ingest token | (required) |
| `HONEYCOMB_DATASET` | Target dataset name | `map-organiser` |
| `HONEYCOMB_API_URL` | Base URL — `https://api.honeycomb.io` (US) or `https://api.eu1.honeycomb.io` (EU) | `https://api.honeycomb.io` |

When `HONEYCOMB_API_KEY` is absent (local `next dev`), no exporters are
configured. The OTel SDK still runs — spans + log records are created
in-memory so trace context works — but nothing ships. The logger falls
back to `console.log` in non-production for local DX.

## Event taxonomy

Predictable `event` (= log record body) names → stable Honeycomb
queries / boards:

| Event | Source | Level |
|---|---|---|
| `ai.parse-query` | parse-query route, success | info |
| `ai.parse-query.llm_failed` | parse-query catch | error |
| `ai.rank-results` | rank-results route, success | info |
| `ai.rank-results.full_ranked` | rank-results route, success | debug |
| `ai.rank-results.llm_failed` | rank-results catch | error |
| `ai.rank-results.salvaged` | schema-failure recovered | warn |
| `ai.rank-results.salvage_failed` | salvage also failed | error |
| `ai.rank-results.out_of_range_idx` | LLM returned idx ≥ N | warn |
| `ai.rank-results.duplicate_idx` | LLM returned same idx twice | warn |
| `ai.rank-results.skipped_candidates` | LLM omitted candidates | warn |
| `api.places` | /api/places GET on AI-search path | info |

Add new events here when introducing new instrumentation.

## How to debug in Honeycomb

### One AI search session, full timeline
Open any span → "View trace". The trace waterfall shows HTTP span →
gen_ai span (parse-query) → fetch spans → rerank → with log records
inline at the point they were emitted. One `traceId`, no grep.

### LLM cost / token usage over time
Query `gen_ai.usage.input_tokens` + `gen_ai.usage.output_tokens`,
visualise `SUM`, group by `gen_ai.request.model`, `bin(time, 1h)`.

### Which queries trigger LLM laziness
Filter `event = ai.rank-results.skipped_candidates`, breakdown by
`userId`. Should be rare since v1.8.5's idx-reference change.

### p95 LLM latency
On the gen_ai spans, `P95(duration_ms)` grouped by `name`
(`ai.parse-query` vs `ai.rank-results`).

### AI Observability view
Honeycomb's built-in AI Observability panel auto-detects the gen_ai.*
spans — prompt, completion, token, cost rendered without hand-written
queries.

## Diagnostic toggles

| Surface | Production default | Enable |
|---|---|---|
| Server log records (`log.*`) | ON → Honeycomb | always |
| Server `console.log` mirror | OFF (prod) / ON (dev) | n/a |
| OTel spans (incl. gen_ai.*) | ON → Honeycomb | bound to registerOTel |
| Client `[ai-search/*]` console logs | OFF | `localStorage.setItem("ai-debug","1")` |
| `window.__aiSearchStore` | OFF | same localStorage flag |

## Cost expectations

F&F scale: well within Honeycomb's free tier (20M events/month, 60-day
retention, unlimited datasets). Vercel Log Drain disabled → no
`$0.50/GB` drain cost.

## Not yet instrumented

Other API routes (`parse-link`, `enrich`, `import-batch`, etc.) still
use ad-hoc `console.log`. With Vercel Log Drain disabled these no longer
reach an external sink — they only appear in Vercel's own 1h-retention
log view. Migrate to `log.*` opportunistically when touching those
files. Frontend instrumentation (browser span → traceparent header →
server) is also a future add.
