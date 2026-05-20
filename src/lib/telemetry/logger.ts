import { logs, SeverityNumber } from "@opentelemetry/api-logs";

/**
 * Structured server-side logger — OTel-native (Honeycomb single-tool).
 *
 * Emits OpenTelemetry log records via the OTel Logs API. The
 * LoggerProvider + OTLP log exporter are configured in
 * `instrumentation.ts`; records ship to Honeycomb's /v1/logs endpoint.
 *
 * Why OTel log records instead of `console.log`:
 *   - The OTel SDK auto-attaches the active span's trace context
 *     (traceId, spanId) to every record. One AI search's parse-query
 *     log + rerank log + gen_ai spans + DB spans all correlate under
 *     one traceId in Honeycomb — no manual plumbing.
 *   - Severity is first-class (severityNumber/severityText), queryable.
 *   - No Vercel Log Drain needed → no $0.50/GB drain cost.
 *
 * Usage (unchanged from the previous console.log-based logger):
 *   log.info("ai.parse-query", { userId, query, hard });
 *   log.warn("ai.rank-results.skipped_candidates", { count: 2 });
 *   log.error("ai.rank-results.llm_failed", err, { userId });
 *
 * `event` → log record body (the primary searchable name in Honeycomb).
 * `attrs` → log record attributes (flattened, see below).
 *
 * Attribute flattening: OTel log attributes must be primitives or arrays
 * of primitives — nested objects aren't allowed. `flatten()` converts
 * nested plain objects to dot-notation keys (`hard.city`) and JSON-
 * stringifies arrays of objects (`top5`). Honeycomb's data model is
 * flat anyway, so this is the natural shape.
 *
 * Server-only. Client-side logs use the `orchLog` helper in
 * `lib/hooks/use-ai-search.ts`.
 */

const otelLogger = logs.getLogger("map-organiser");

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
 * Flatten a nested attrs object into OTel-compatible attributes:
 *   - nested plain object  → dot-notation keys ({a:{b:1}} → {"a.b":1})
 *   - array of primitives  → kept as-is (OTel allows string[]/number[])
 *   - array of objects     → JSON-stringified (Honeycomb queries the
 *                            string; nesting isn't first-class anyway)
 *   - null / undefined     → dropped
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
      if (allPrimitive) {
        out[key] = v.filter((x) => x != null) as Primitive[];
      } else {
        out[key] = JSON.stringify(v);
      }
    } else if (typeof v === "object") {
      Object.assign(out, flatten(v as LogAttrs, key));
    } else {
      out[key] = v as Primitive;
    }
  }
  return out;
}

function write(level: LogLevel, event: string, attrs?: LogAttrs) {
  otelLogger.emit({
    severityNumber: SEVERITY[level],
    severityText: level.toUpperCase(),
    body: event,
    attributes: flatten(attrs ?? {}),
  });
  // Dev fallback: in local `next dev` there's no OTLP exporter, so the
  // emit() above goes nowhere visible. Mirror to stdout for DX. In
  // production this is skipped — Honeycomb is the single sink.
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.log(`[${level}] ${event}`, attrs ?? "");
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
