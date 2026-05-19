import { trace } from "@opentelemetry/api";

/**
 * Structured JSON logger for server-side code.
 *
 * Why: Vercel's log drain (Axiom integration) ships every `console.log`
 * line into Axiom. Plain strings work but you can't query them
 * efficiently — Axiom has to regex-parse the message field. Structured
 * JSON makes each attribute a first-class queryable field:
 *
 *   log.info("ai.parse-query", { query, hard, requires_rerank: true });
 *
 * lands in Axiom as:
 *
 *   { event: "ai.parse-query", query: "...", hard: {...},
 *     requires_rerank: true, level: "info", traceId: "abc123",
 *     spanId: "def456", timestamp: "2026-..." }
 *
 * Then Axiom queries become trivial:
 *   ['vercel'] | where event == "ai.parse-query" | summarize count() by bin(_time, 1h)
 *
 * Trace correlation: when `@vercel/otel` is active, every log line gets
 * the current OTel trace context attached (traceId, spanId). One AI
 * search's parse-query log + rerank log + DB span + LLM call span all
 * share the same `traceId` → end-to-end timeline in Axiom.
 *
 * Levels:
 *   debug — verbose dev info, skip in production unless debugging
 *   info  — normal lifecycle events ("AI search started", "rerank done")
 *   warn  — recoverable anomalies (skipped candidates, salvaged response)
 *   error — failures (LLM call rejected, schema validation failed)
 *
 * Server-only. For client-side logs, see the `orchLog` helper in
 * `lib/hooks/use-ai-search.ts` (gated by NODE_ENV / localStorage).
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogAttrs {
  [key: string]: unknown;
}

function getTraceContext(): { traceId?: string; spanId?: string } {
  // OTel context is request-scoped. Outside a request (e.g. boot) this
  // returns the invalid span (traceId all zeros), which we filter out.
  const ctx = trace.getActiveSpan()?.spanContext();
  if (!ctx) return {};
  // The "invalid" trace ID is all zeros — skip it so Axiom doesn't get
  // misleading correlation noise.
  if (/^0+$/.test(ctx.traceId)) return {};
  return { traceId: ctx.traceId, spanId: ctx.spanId };
}

function write(level: LogLevel, event: string, attrs?: LogAttrs) {
  const payload = {
    level,
    event,
    timestamp: new Date().toISOString(),
    ...getTraceContext(),
    ...(attrs ?? {}),
  };
  // Use stderr for warn/error so Vercel separates them, stdout for the rest.
  const line = JSON.stringify(payload);
  // eslint-disable-next-line no-console
  if (level === "warn" || level === "error") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const log = {
  debug: (event: string, attrs?: LogAttrs) => write("debug", event, attrs),
  info: (event: string, attrs?: LogAttrs) => write("info", event, attrs),
  warn: (event: string, attrs?: LogAttrs) => write("warn", event, attrs),
  /**
   * Error logger. Accepts an Error or unknown as second arg; the rest
   * are normal attrs. Stack trace is stringified and stored under
   * `error.stack`; name + message under `error.name` / `error.message`.
   */
  error: (event: string, err: unknown, attrs?: LogAttrs) => {
    const e =
      err instanceof Error
        ? {
            name: err.name,
            message: err.message,
            stack: err.stack,
          }
        : { message: String(err) };
    write("error", event, { ...(attrs ?? {}), error: e });
  },
};

export type Logger = typeof log;
