---
title: Observability Flow (Honeycomb + Vercel/Axiom + Langfuse)
type: flow
domain: infra
version: 3.3.0
last_updated: 15.07.2026
status: stable
sources:
  - src/instrumentation.ts
  - src/instrumentation-node.ts
  - src/lib/telemetry/logger.ts
  - src/lib/telemetry/trace-context.ts
  - src/lib/telemetry/langfuse.ts
  - src/app/api/ai/parse-query/route.ts
  - src/app/api/ai/rank-results/route.ts
  - src/app/api/places/route.ts
related:
  - "[[ai-search-flow]]"
  - "[[../02-backend/api-routes/ai]]"
---

# Observability Flow

**Dual-write logs, dual-export traces.** Every server log goes to two
independent destinations; traces go to Honeycomb, and the LLM subset of
those spans additionally goes to Langfuse (v1.16.0). Every pipe has
independent failure modes, so a misconfigured telemetry backend can
never black out monitoring.

## Why dual-write (v1.9.0 post-mortem)

The first Honeycomb cut rewrote the logger to emit ONLY OpenTelemetry
log records and gated `console.log` to development. The OTel Logs API
never writes to stdout — so the instant that shipped:

- the Vercel dashboard **Logs** view went empty (Vercel surfaces only
  stdout/stderr there),
- the Axiom Log Drain had nothing to ship (it drains stdout),
- Honeycomb wasn't receiving anything either — `HONEYCOMB_API_KEY` was
  added after the tested build, so the exporter was a no-op.

A hard cutover to an unverified pipe → total monitoring blackout. The
fix is the rule the otel-migration skill states outright (Phase 5):
*logs go to BOTH stderr AND OTel*. This system now does that.

## Architecture

```
   ┌──────────────────────────┐     ┌──────────────────────────────┐
   │  Vercel dashboard "Logs"  │     │         Honeycomb            │
   │  (stdout/stderr view)     │     │  ── HTTP / fetch spans       │
   └──────────────────────────┘     │  ── gen_ai.* LLM spans       │
              ▲                     │  ── OTel log records         │
              │ stdout              │     (trace-correlated)        │
              │                     └──────────────────────────────┘
   ┌──────────┴───────────────┐         ▲              ▲
   │  Axiom  (vercel dataset, │         │ OTLP /v1/logs│ OTLP /v1/traces
   │  vercel_parsed view)     │         │              │
   └──────────────────────────┘         │              │   ┌──────────────────────────┐
              ▲                         │              │   │        Langfuse          │
              │ Vercel Log Drain        │              │   │  ── gen_ai.* LLM spans   │
              │ (drains stdout)         │              │   │     ONLY (built-in       │
              │                         │              │   │     shouldExportSpan)    │
              │                         │              │   └──────────────────────────┘
              │                         │              │              ▲
              │                         │              │              │ LangfuseSpanProcessor
   ┌──────────┴─────────────────────────┴──────────────┴──────────────┴──────┐
   │                        Vercel Function (Next.js)                         │
   │                                                                          │
   │   log.info(...)  ─┬─▶ console.log(JSON)  → stdout                        │
   │                   └─▶ logs.getLogger().emit() → OTel pipe                │
   │                                                                          │
   │   generateText({ experimental_telemetry }) → gen_ai.* spans              │
   │     (→ Honeycomb AND Langfuse — spanProcessors: ["auto", langfuse])      │
   │   @vercel/otel auto → HTTP + fetch spans (→ Honeycomb only)              │
   └──────────────────────────────────────────────────────────────────────────┘
```

### Logs — dual-write

`src/lib/telemetry/logger.ts` `log.{debug,info,warn,error}` — each call
writes BOTH:

1. **stdout/stderr JSON line** — `console.log` (info/debug) /
   `console.warn` (warn/error). Shape:
   `{ level, event, timestamp, traceId?, spanId?, ...attrs }`.
   Nested objects preserved.
   - Vercel dashboard Logs view shows it (the `message` field).
   - Vercel Log Drain → Axiom `vercel` dataset. The `vercel_parsed`
     **view** (`extend p = parse_json(message) | ...`) surfaces every
     field as a typed column.

2. **OTel log record** — `logs.getLogger("map-organiser").emit(...)`.
   `event` → record body; `attrs` → flattened attributes (OTel allows
   only primitive / primitive[] — nested objects become dot-notation
   keys, arrays of objects are JSON-stringified). Trace context is
   auto-attached by the SDK. → Honeycomb `/v1/logs`.

`write()` is fully wrapped in `try/catch` — a telemetry failure (e.g.
`JSON.stringify` on a circular ref, an SDK error) is swallowed and
never propagates into the request handler.

### Traces — Honeycomb (all spans) + Langfuse (LLM spans)

`instrumentation-node.ts` registers `@vercel/otel` with
`spanProcessors: ["auto", langfuseSpanProcessor]`:

- `"auto"` keeps the default export processor, which wraps the
  `OTLPHttpJsonTraceExporter` → Honeycomb `/v1/traces` (ALL spans).
- `LangfuseSpanProcessor` (`src/lib/telemetry/langfuse.ts`, singleton,
  only constructed when `LANGFUSE_PUBLIC_KEY`+`LANGFUSE_SECRET_KEY` are
  set) rides the same pipeline → cloud.langfuse.com. Its built-in
  `shouldExportSpan` filter exports ONLY GenAI/Langfuse spans — infra
  spans (HTTP, Supabase fetch) never reach Langfuse.

Span sources:
- HTTP request spans — auto (`@vercel/otel`) → Honeycomb only
- fetch spans — auto (Supabase, Gemini HTTP) → Honeycomb only
- `gen_ai.*` LLM spans — AI SDK `generateText({ ...,
  experimental_telemetry: { isEnabled: true, functionId, metadata } })`.
  GenAI semantic conventions: model, prompt, completion, input/output
  tokens, latency, finish_reason. → Honeycomb **and** Langfuse.
  All THREE LLM call sites carry this: `ai.parse-query`,
  `ai.rank-results`, `ai.generate-profile` (lib — runs under both the
  enrich route and the refresh cron).

**Langfuse trace-level fields** (name, user, tags) are stamped via
`propagateAttributes({ traceName, userId, tags }, () => generateText(…))`
(`@langfuse/tracing`) at each call site: `ai-search` (parse-query +
rank-results — one merged trace via the traceparent below),
`place-profile` (enrich step=profile), `cron-refresh-places` (cron).

**Serverless flush:** Langfuse batches span exports; Vercel can suspend
the function right after the response. Every route that produces LLM
spans calls `after(flushLangfuse)` (`next/server`) so the batch is
force-flushed once the response is sent. `flushLangfuse()` no-ops when
the processor is unconfigured and swallows its own errors — telemetry
never breaks the request path.

> **File location:** the project uses a `src/` directory, so Next.js
> looks for `src/instrumentation.ts` — NOT a root-level one. A root
> `instrumentation.ts` is silently ignored (build still passes, but
> `register()` never runs → OTel never initializes → zero telemetry).
> Both `instrumentation.ts` and `instrumentation-node.ts` live in `src/`.
>
> **Runtime gating:** `instrumentation.ts` is loaded by Next.js for
> EVERY runtime including Edge (middleware). The OTel log packages
> (`@opentelemetry/sdk-logs`, `exporter-logs-otlp-http`) are Node-only —
> importing them in Edge crashes middleware with
> `MIDDLEWARE_INVOCATION_FAILED`. `instrumentation.ts` therefore only
> `await import("./instrumentation-node")` when
> `NEXT_RUNTIME === "nodejs"`. Middleware (Edge) runs un-instrumented.

## Trace propagation — AI search pipeline

AI search fires three sequential server calls from the browser —
`parse-query` → `/api/places` → `rank-results`. Each is a separate
Vercel function invocation, so without a shared trace context each
opens its own trace: three disconnected waterfalls.

`src/lib/telemetry/trace-context.ts` `newTraceparent()` mints one W3C
`traceparent` (`00-<trace-id>-<span-id>-01`) per AI search.
`useAiSearch` stores it on `ai-search-store` and sends it as a request
header on all three fetches (`use-ai-search.ts` → parse-query +
rank-results; `use-places.ts` → `/api/places`).

`@vercel/otel` extracts the header via its default W3C Trace Context
propagator, so the three request spans — and their children
(`ai.generateText`, Supabase + Gemini `fetch` spans) — stitch into ONE
trace. The whole pipeline becomes a single waterfall.

The parent span the `traceparent` points at is **synthetic** — the
browser never exports a span for it, so Honeycomb renders the three
server spans under a generated root. A real, named browser-side root
span would need a full browser OpenTelemetry SDK + exporter (future
add).

The context is scoped to one search: minted at search start, dropped on
completion (`applyRankings` / `failRerank`), on `reset`, and for
no-rerank queries (parse-query only) — so it never leaks onto later
unrelated `/api/places` fetches.

## Required env vars (Vercel — Production + Preview scopes)

| Env var | Purpose | Default |
|---|---|---|
| `HONEYCOMB_API_KEY` | Honeycomb **ingest** key, `production` environment | (required for the OTel pipe) |
| `HONEYCOMB_DATASET` | Honeycomb dataset name | `map-organiser` |
| `HONEYCOMB_API_URL` | Base URL — US default; EU = `https://api.eu1.honeycomb.io` | `https://api.honeycomb.io` |
| `LANGFUSE_PUBLIC_KEY` | Langfuse project public key (`pk-lf-…`) | (required for the Langfuse pipe) |
| `LANGFUSE_SECRET_KEY` | Langfuse project secret key (`sk-lf-…`) | (required for the Langfuse pipe) |
| `LANGFUSE_BASE_URL` | Langfuse endpoint — EU cloud | `https://cloud.langfuse.com` |

Vercel only applies env vars to deployments built AFTER they were
added. Adding a var requires a fresh deploy (or Redeploy) to take
effect.

When `HONEYCOMB_API_KEY` is absent, `instrumentation-node.ts` registers
OTel with no Honeycomb exporter — the console-log pipe still works
fully; only the Honeycomb pipe is dark. The Langfuse processor degrades
independently the same way (absent keys → processor skipped, everything
else unaffected).

`instrumentation-node.ts` prints a one-line boot diagnostic to stdout
(`[instrumentation-node] boot · …`) reporting whether the key reached
the runtime. Visible in the Vercel dashboard Logs view on cold start.

## Four places to look

| Where | What | When to use |
|---|---|---|
| **Vercel dashboard → Logs** | Raw stdout JSON lines | Quick "is anything happening", 1h retention |
| **Axiom** (`vercel_parsed` view) | Structured, queryable logs (APL) | Log search/aggregation, 30-day retention |
| **Honeycomb** | Traces + gen_ai LLM spans + OTel logs | Trace waterfalls across the WHOLE request (HTTP + DB + LLM) |
| **Langfuse** (cloud.langfuse.com) | LLM-only traces: prompts, completions, tokens, cost, per-user/per-tag filtering | Prompt debugging, LLM cost/quality analysis, eval workflows (future) |

The Axiom Vercel Log Drain may be left enabled (it costs ~$0.50/GB but
F&F volume is ~$1–2/mo) — it is the structured-log search surface while
Honeycomb is the trace/LLM surface. Disabling the drain is optional;
the Vercel dashboard view and Honeycomb both keep working without it.

## Event taxonomy

Predictable `event` names (= console JSON `event` field = OTel record
body) → stable queries on both backends:

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

## Known follow-ups

- **Serverless log flush:** the OTel log pipe uses
  `BatchLogRecordProcessor` (as of `@opentelemetry/sdk-logs` 0.220 its
  constructor takes a single options object `{ exporter }` — updated in
  `instrumentation-node.ts`, v1.15.0). In Vercel's freeze-after-response model,
  buffered records may be lost if `@vercel/otel` doesn't force-flush
  the LoggerProvider on suspend. To verify after deploy: compare
  Honeycomb log-record count against the (reliable) console/Axiom
  count. If Honeycomb logs lag, switch to `SimpleLogRecordProcessor`.
  The dual-write means this can never black out monitoring — the
  console pipe is the guarantee.
- Other API routes (`parse-link`, `enrich`, `import-batch`) still use
  ad-hoc `console.log` — they reach the Vercel dashboard + Axiom but
  unstructured, and never reach Honeycomb. Migrate to `log.*`
  opportunistically.
- Browser-side root span: AI search now propagates a `traceparent`
  across its three calls so the pipeline forms one trace (see "Trace
  propagation — AI search pipeline"), but that root is synthetic. A
  real exported browser span needs a full browser OpenTelemetry SDK —
  still a future add.

## Diagnostic toggles

| Surface | Production default | Enable |
|---|---|---|
| Server `log.*` → stdout | ON | always |
| Server `log.*` → OTel/Honeycomb | ON when `HONEYCOMB_API_KEY` set | env var |
| OTel spans → Honeycomb | ON when `HONEYCOMB_API_KEY` set | env var |
| gen_ai.* spans → Langfuse | ON when `LANGFUSE_PUBLIC_KEY`+`SECRET_KEY` set (independent of Honeycomb) | env vars |
| Client `[ai-search/*]` console logs | OFF | `localStorage.setItem("ai-debug","1")` |
| `window.__aiSearchStore` | OFF | same localStorage flag |
