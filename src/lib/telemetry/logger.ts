import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { trace } from "@opentelemetry/api";

/**
 * Structured server-side logger — DUAL-WRITE.
 *
 * Every `log.*` call writes to TWO independent destinations:
 *
 *   1. stdout / stderr — a single-line JSON string via console.log /
 *      console.warn.
 *        → visible in the Vercel dashboard "Logs" view (Vercel only
 *          surfaces stdout/stderr there)
 *        → shipped to Axiom by the Vercel Log Drain (when enabled);
 *          the Axiom `vercel_parsed` view runs `parse_json(message)`
 *          to surface every field as a queryable column.
 *
 *   2. OTel log record — via the OTel Logs API (`logs.getLogger().emit`).
 *        → routed by instrumentation-node.ts's LoggerProvider to
 *          Honeycomb's /v1/logs endpoint, trace-correlated.
 *
 * WHY DUAL-WRITE (the v1.9.0 post-mortem):
 *   The first Honeycomb cut rewrote this logger to emit ONLY OTel log
 *   records and gated console.log to dev. The OTel Logs API never
 *   touches stdout — so the moment that shipped, the Vercel dashboard
 *   Logs view AND the Axiom drain both went dark, while Honeycomb
 *   wasn't receiving anything either (env-var timing). Total monitoring
 *   blackout from a hard cutover to an unverified pipe.
 *   The otel-migration skill (Phase 5) is explicit: "you almost
 *   certainly want logs going to BOTH stderr AND OTel." This logger now
 *   does exactly that. The console path needs no env vars and is
 *   captured synchronously by Vercel — it is the always-on safety net.
 *   The OTel path is best-effort on top.
 *
 * Usage (unchanged across every revision of this file):
 *   log.info("ai.parse-query", { userId, query, hard });
 *   log.warn("ai.rank-results.skipped_candidates", { count: 2 });
 *   log.error("ai.rank-results.llm_failed", err, { userId });
 *
 * Server-only. Client-side logs use `orchLog` in
 * `lib/hooks/use-ai-search.ts`.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const SEVERITY: Record<LogLevel, SeverityNumber> = {
  debug: SeverityNumber.DEBUG,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
};

interface LogAttrs {
  [key: string]: unknown;
}

type Primitive = string | number | boolean;
type OtelAttrValue = Primitive | Primitive[];

/**
 * Active OTel trace context. Stamped onto the console JSON line so
 * Axiom-side records correlate by traceId. The OTel emit path does NOT
 * need this — the SDK auto-attaches trace context to the LogRecord.
 */
function traceContext(): { traceId?: string; spanId?: string } {
  const ctx = trace.getActiveSpan()?.spanContext();
  if (!ctx) return {};
  // The "invalid" trace ID is all zeros — drop it to avoid noise.
  if (/^0+$/.test(ctx.traceId)) return {};
  return { traceId: ctx.traceId, spanId: ctx.spanId };
}

/**
 * Flatten nested attrs into OTel-compatible attributes (primitives or
 * arrays of primitives only):
 *   - nested plain object → dot-notation keys ({a:{b:1}} → {"a.b":1})
 *   - array of primitives → kept as-is
 *   - array of objects    → JSON-stringified
 *   - null / undefined    → dropped
 * Used for the OTel path only; the console path keeps nested objects
 * (Axiom's parse_json handles nesting natively).
 */
function flatten(
  input: LogAttrs,
  prefix = ""
): Record<string, OtelAttrValue> {
  const out: Record<string, OtelAttrValue> = {};
  for (const [k, v] of Object.entries(input)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) {
      const allPrimitive = v.every(
        (x) => x === null || typeof x !== "object"
      );
      out[key] = allPrimitive
        ? (v.filter((x) => x != null) as Primitive[])
        : JSON.stringify(v);
    } else if (typeof v === "object") {
      Object.assign(out, flatten(v as LogAttrs, key));
    } else {
      out[key] = v as Primitive;
    }
  }
  return out;
}

function write(level: LogLevel, event: string, attrs?: LogAttrs) {
  // Telemetry must NEVER throw into a request handler. The whole body is
  // guarded; a logging failure is swallowed (with a last-ditch raw log).
  try {
    const ctx = traceContext();
    const a = attrs ?? {};

    // ── Destination 1: stdout/stderr JSON line ──
    // Nested objects preserved — Axiom's parse_json handles nesting.
    // warn/error → stderr (console.warn) so Vercel/Axiom can split them.
    const line = JSON.stringify({
      level,
      event,
      timestamp: new Date().toISOString(),
      ...ctx,
      ...a,
    });
    if (level === "warn" || level === "error") {
      console.warn(line);
    } else {
      console.log(line);
    }

    // ── Destination 2: OTel log record → Honeycomb ──
    // getLogger() is called PER WRITE (not cached at module load) so it
    // always resolves to the LoggerProvider registered by
    // instrumentation-node.ts, regardless of module import ordering.
    // Trace context (traceId/spanId) is auto-attached by the SDK from
    // the active span — no need to pass it in attributes.
    logs.getLogger("map-organiser").emit({
      severityNumber: SEVERITY[level],
      severityText: level.toUpperCase(),
      body: event,
      attributes: flatten(a),
    });
  } catch (e) {
    try {
      console.error(`[logger] write failed for event "${event}":`, e);
    } catch {
      /* nothing left to do */
    }
  }
}

export const log = {
  debug: (event: string, attrs?: LogAttrs) => write("debug", event, attrs),
  info: (event: string, attrs?: LogAttrs) => write("info", event, attrs),
  warn: (event: string, attrs?: LogAttrs) => write("warn", event, attrs),
  /**
   * Error logger. Second arg is an Error (or unknown); rest are normal
   * attrs. The error is flattened to `error.name` / `error.message` /
   * `error.stack`.
   */
  error: (event: string, err: unknown, attrs?: LogAttrs) => {
    const e =
      err instanceof Error
        ? { name: err.name, message: err.message, stack: err.stack }
        : { message: String(err) };
    write("error", event, { ...(attrs ?? {}), error: e });
  },
};

export type Logger = typeof log;
