---
title: Observability Flow (Honeycomb + Vercel/Axiom + Langfuse)
type: flow
domain: infra
version: 3.9.0
last_updated: 25.11.2026
status: stable
sources:
  - src/instrumentation.ts
  - src/instrumentation-node.ts
  - src/lib/telemetry/logger.ts
  - src/lib/telemetry/langfuse.ts
  - src/lib/agent/run-turn.ts
  - src/lib/agent/structured.ts
  - src/app/api/assistant/chat/route.ts
  - src/app/api/places/[id]/enrich/route.ts
  - src/app/api/cron/refresh-places/route.ts
  - src/lib/instagram/read-post.ts
  - src/app/api/instagram/import/route.ts
related:
  - "[[ai-search-flow]]"
  - "[[ai-chat-flow]]"
  - "[[../04-integrations/claude-agent]]"
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
   └──────────────────────────┘     │  ── LLM observations         │
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
   │   Claude calls → Langfuse observations (@langfuse/tracing)               │
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
  set) rides the same pipeline → cloud.langfuse.com, with Langfuse's
  built-in filter (`isDefaultExportSpan`): only Langfuse observations and
  GenAI spans reach it — infra spans (HTTP, Supabase fetch) never do.
  `@langfuse/tracing` writes its observations through the global tracer
  provider that `@vercel/otel` registers, so Honeycomb receives them too.
  (Until v1.55.0 a composed filter also dropped the AI SDK's umbrella
  span of each Gemini call: `…:ai.generateText` lost its token counts in
  emission but kept `reasoningTokens`, and Langfuse priced those a second
  time — ~37% trace-cost inflation, 15.07.2026. No AI SDK model call is
  left.)

Span sources:
- HTTP request spans — auto (`@vercel/otel`) → Honeycomb only
- fetch spans — auto (Supabase and the other outgoing calls) → Honeycomb only
- Claude calls — Langfuse observations (`@langfuse/tracing`) → Honeycomb
  **and** Langfuse:
  - an assistant turn (`src/lib/agent/run-turn.ts`): an `assistant-turn`
    observation with the user's input and the reply, a `claude` generation
    per model call and an observation per tool call, named by the tool;
  - a one-shot structured call (`src/lib/agent/structured.ts`): a
    generation named by its label — `profile.write` (the enrich route, the
    refresh cron, the import drain's `profile` stage), `instagram.read` —
    and a JSON log line `claude.structured` (model, effort, tokens,
    thinking tokens, cost, ms).
- Until v1.55.0 the Gemini calls were AI SDK `gen_ai.*` spans
  (`experimental_telemetry`, one `functionId` per call site:
  `ai.parse-query`, `ai.rank-results`, `ai.generate-profile`, `ai.compare`,
  `ai.chat`, `ai.trip-plan`, `ai.instagram-read-post`); each went with its
  feature (v1.48.0–v1.55.0).

**Langfuse trace-level fields** (name, user, tags) are stamped via
`propagateAttributes({ traceName, userId, tags }, …)` (`@langfuse/tracing`)
around each call site: `assistant` (every turn, `run-turn.ts` — with the
conversation as `sessionId` and the purpose as a tag), `place-profile`
(enrich step=profile), `cron-refresh-places` (cron). Until they went:
`ai-search` (parse-query + rank-results, until v1.54.0) and `ai-compare`
(v1.19.0–v1.51.0).

**Serverless flush:** Langfuse batches span exports; Vercel can suspend
the function right after the response. Code that produces LLM spans
force-flushes the batch once its work is done — `after(flushLangfuse)`
(`next/server`) in the assistant chat route, the enrich route and the
refresh cron; `flushLangfuse()` at the end of the Instagram import's
`after()` job and of `add_places`' Instagram read (the `/api/ai/*` routes
did too, until they went). `flushLangfuse()` no-ops when the processor is
unconfigured and swallows its own errors — telemetry never breaks the
request path. **One LLM-producing route does not flush (checked
25.11.2026):** `/api/cron/drain-imports` (the `profile` stage). Its spans
rely on the processor's batching and can be lost when the function is
suspended. Neither the drain nor the Instagram import sets a
`propagateAttributes` trace name.

> **File location:** the project uses a `src/` directory, so Next.js
> looks for `src/instrumentation.ts` — NOT a root-level one. A root
> `instrumentation.ts` is silently ignored (build still passes, but
> `register()` never runs → OTel never initializes → zero telemetry).
> Both `instrumentation.ts` and `instrumentation-node.ts` live in `src/`.
>
> **Runtime gating:** `instrumentation.ts` is loaded by Next.js for
> EVERY runtime. The OTel log packages (`@opentelemetry/sdk-logs`,
> `exporter-logs-otlp-http`) are Node-only — importing them in Edge
> crashed the then-Edge middleware with `MIDDLEWARE_INVOCATION_FAILED`.
> `instrumentation.ts` therefore only `await import("./instrumentation-node")`
> when `NEXT_RUNTIME === "nodejs"`. Since v1.44.0 nothing runs on Edge: the
> proxy (`src/proxy.ts`, was middleware) is Node and instrumented like the
> routes — its request and Supabase-auth `fetch` spans reach Honeycomb.

## Trace propagation — AI search pipeline (removed in v1.54.0)

The Gemini AI search fired `parse-query` → `/api/places` → `rank-results` from the browser and stitched them into one trace with a `traceparent` minted per search (`trace-context.ts`, deleted with it). Nothing in the app chains browser calls into one trace any more; the assistant's turn is one request with its own Langfuse trace ([[../04-integrations/claude-agent]]).

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
| **Honeycomb** | Traces (the Claude calls' observations included) + OTel logs | Trace waterfalls across the WHOLE request (HTTP + DB + LLM) |
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
| `assistant.turn` | chat route — how a turn ended: input kind, status, steps, cost | info |
| `assistant.turn_refused`, `assistant.turn_failed` | chat route | warn |
| `assistant.turn_open_failed`, `assistant.subject_failed` | chat route | error |
| `assistant.conversation_load_failed`, `assistant.conversation_create_failed` | conversation route | error |
| `assistant.tool` | `run-tool.ts` — every tool call, from either door (`door`), with its time | info |
| `assistant.tool_failed` | `run-tool.ts` | warn |
| `assistant.plan_read_back_failed`, `assistant.list_read_back_failed` | `get_plans`, `get_lists` | warn |
| `agent.step` | `run-turn.ts` — one model call: model, stop reason, tokens, cache, web searches, cost, ms | info |
| `agent.stream_retry`, `agent.refusal`, `agent.unexpected_stop`, `agent.budget_exhausted`, `agent.unpriced_model`, `agent.event_handler_failed`, `agent.record_turn_failed`, `agent.release_turn_failed` | `run-turn.ts` | warn |
| `agent.spend_write_failed` | `run-turn.ts` | error |
| `agent.turn_failed` | `ui-stream.ts` | error |
| `agent.preview_failed` | `ui-stream.ts`, conversation route — an approval card's preview couldn't be built | warn |
| `agent.verify_failed` | `describe-writes.ts` | warn |
| `claude.structured` | `structured.ts` — one one-shot call: model, effort, tokens, thinking tokens, cost, ms | info |
| `claude.spend_record_failed` | `structured.ts` | error |
| `cron.refresh_places` | refresh cron | info |
| `cron.refresh_places.scan_failed`, `cron.refresh_places.optin_scan_failed` | refresh cron | error |
| `places.add_failed`, `places.enrichment_not_queued` | `src/lib/places/add.ts` | warn |
| `places.create.lists_failed`, `places.create.lists_missing` | `POST /api/places` | warn |
| `import.lists_failed` | `src/lib/import/process-place.ts` | warn |
| `usage.assistant_spend_failed` | `GET /api/user/usage` | warn |

Until v1.54.0 the table held the Gemini AI search's events (`ai.parse-query`, `ai.rank-results.*`, `api.places`).

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
- Other API routes (`parse-link`, `enrich`, `drain-imports`) still use
  ad-hoc `console.log` — they reach the Vercel dashboard + Axiom but
  unstructured, and never reach Honeycomb. Migrate to `log.*`
  opportunistically.

## Diagnostic toggles

| Surface | Production default | Enable |
|---|---|---|
| Server `log.*` → stdout | ON | always |
| Server `log.*` → OTel/Honeycomb | ON when `HONEYCOMB_API_KEY` set | env var |
| OTel spans → Honeycomb | ON when `HONEYCOMB_API_KEY` set | env var |
| LLM observations → Langfuse | ON when `LANGFUSE_PUBLIC_KEY`+`SECRET_KEY` set (independent of Honeycomb) | env vars |
| `window.__filterPersistStore` | OFF in production (on in dev) | `localStorage.setItem("ai-debug","1")` |
