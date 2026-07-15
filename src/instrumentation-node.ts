/**
 * Node-runtime-only OpenTelemetry setup.
 *
 * Dynamically imported by `instrumentation.ts` ONLY when
 * `NEXT_RUNTIME === "nodejs"`. Never loaded in the Edge runtime, so the
 * Node-only OpenTelemetry packages below (`@opentelemetry/sdk-logs`,
 * `@opentelemetry/exporter-logs-otlp-http`) are never evaluated there.
 * See instrumentation.ts for the why.
 *
 * Configures `@vercel/otel` with:
 *   1. Trace pipeline → Honeycomb /v1/traces
 *        - HTTP request spans (auto)
 *        - fetch spans (Supabase, Gemini)
 *        - gen_ai.* spans from AI SDK `experimental_telemetry`
 *   2. Log pipeline → Honeycomb /v1/logs
 *        - `log.{debug,info,warn,error}` records, trace-correlated
 *   3. Langfuse span processor → cloud.langfuse.com (LLM observability)
 *        - SAME trace pipeline, additional processor: `spanProcessors:
 *          ["auto", …]` keeps the default Honeycomb export processor and
 *          adds Langfuse alongside. Langfuse's built-in filter exports
 *          ONLY GenAI/Langfuse spans — infra spans never leave for it.
 *        - See src/lib/telemetry/langfuse.ts.
 *
 * Required env vars (Vercel):
 *   - HONEYCOMB_API_KEY  — ingest token, production environment
 *   - HONEYCOMB_DATASET  — dataset name (default: "map-organiser")
 *   - HONEYCOMB_API_URL  — base URL (default US; EU = api.eu1.honeycomb.io)
 *   - LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY / LANGFUSE_BASE_URL
 *
 * Each backend degrades independently: missing Honeycomb key → no
 * Honeycomb exporters; missing Langfuse keys → no Langfuse processor.
 * The OTel SDK itself always runs so logger trace-context still works.
 */
import { registerOTel, OTLPHttpJsonTraceExporter } from "@vercel/otel";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { langfuseSpanProcessor } from "@/lib/telemetry/langfuse";

const apiKey = process.env.HONEYCOMB_API_KEY;
const dataset = process.env.HONEYCOMB_DATASET ?? "map-organiser";
const baseUrl = process.env.HONEYCOMB_API_URL ?? "https://api.honeycomb.io";

// ─── Boot diagnostic (TEMPORARY) ───
// Prints once per cold start to Vercel's runtime logs. Confirms whether
// the Honeycomb env vars actually reached the running function — the
// #1 suspect when "no data in Honeycomb". The key value is NEVER
// printed, only presence + length. Remove once telemetry is verified.
console.log(
  `[instrumentation-node] boot · NEXT_RUNTIME=${process.env.NEXT_RUNTIME} ` +
    `· HONEYCOMB_API_KEY=${apiKey ? `present(${apiKey.length} chars)` : "MISSING"} ` +
    `· HONEYCOMB_DATASET=${dataset} · baseUrl=${baseUrl} ` +
    `· LANGFUSE=${langfuseSpanProcessor ? "CONFIGURED" : "off (no keys)"} ` +
    `· → ${apiKey ? "exporters CONFIGURED" : "NO-OP (no exporter, nothing ships)"}`
);

// "auto" = the default span processors @vercel/otel would configure on its
// own (incl. the batch processor wrapping `traceExporter` below). Langfuse
// rides alongside; omitted entirely when its keys are absent.
const spanProcessors = [
  "auto" as const,
  ...(langfuseSpanProcessor ? [langfuseSpanProcessor] : []),
];

if (!apiKey) {
  // Local dev / no-Honeycomb path: no Honeycomb exporters. Langfuse (if
  // configured) still exports LLM spans via its own processor.
  registerOTel({ serviceName: "map-organiser", spanProcessors });
} else {
  const headers = {
    "x-honeycomb-team": apiKey,
    "x-honeycomb-dataset": dataset,
  };

  registerOTel({
    serviceName: "map-organiser",
    spanProcessors,
    traceExporter: new OTLPHttpJsonTraceExporter({
      url: `${baseUrl}/v1/traces`,
      headers,
    }),
    logRecordProcessors: [
      // @opentelemetry/sdk-logs ≥0.220 takes a single options object
      // ({ exporter, ... }) instead of a positional exporter argument.
      new BatchLogRecordProcessor({
        exporter: new OTLPLogExporter({
          url: `${baseUrl}/v1/logs`,
          headers,
        }),
      }),
    ],
  });
}
