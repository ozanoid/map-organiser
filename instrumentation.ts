/**
 * Next.js OpenTelemetry instrumentation entry point — single-tool
 * (Honeycomb) architecture.
 *
 * `register()` runs once per server process boot. Configures BOTH:
 *
 *   1. Trace pipeline (OTLP/HTTP → Honeycomb /v1/traces)
 *        - HTTP request spans (auto, @vercel/otel)
 *        - fetch spans (Supabase, Gemini calls)
 *        - gen_ai.* spans from AI SDK `experimental_telemetry: true`
 *          (prompt, completion, input/output tokens, model, latency)
 *
 *   2. Log pipeline (OTLP/HTTP → Honeycomb /v1/logs)
 *        - All `log.{debug,info,warn,error}` calls from
 *          `lib/telemetry/logger.ts` flow through OTel Logger API
 *        - Trace context (traceId, spanId) auto-attached by SDK
 *        - Severity + body + attributes preserved on Honeycomb side
 *
 * Single OTLP pipe, single Honeycomb destination. Vercel Log Drain to
 * Axiom is no longer needed and should be disabled in Vercel project
 * settings to avoid the $0.50/GB cost.
 *
 * Required env vars (set on Vercel):
 *   - HONEYCOMB_API_KEY     — write token from honeycomb.io
 *   - HONEYCOMB_DATASET     — dataset name (default: "map-organiser")
 *   - HONEYCOMB_API_URL     — base URL (default: "https://api.honeycomb.io",
 *                             use "https://api.eu1.honeycomb.io" for EU)
 *
 * When HONEYCOMB_API_KEY is absent (local `next dev` without env), no
 * exporters are configured — OTel SDK still runs and produces in-memory
 * spans, so logger's trace context attachment still works for stdout
 * fallback logging in dev.
 *
 * See docs/05-flows/observability-flow.md for the full architecture.
 */
import { registerOTel, OTLPHttpJsonTraceExporter } from "@vercel/otel";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";

export function register() {
  const apiKey = process.env.HONEYCOMB_API_KEY;
  const dataset = process.env.HONEYCOMB_DATASET ?? "map-organiser";
  const baseUrl =
    process.env.HONEYCOMB_API_URL ?? "https://api.honeycomb.io";

  // No-op exporter path: local dev without env vars. OTel SDK still
  // creates spans + log records in memory so the logger's trace
  // context (traceId/spanId) propagation works for stdout logs.
  if (!apiKey) {
    registerOTel({ serviceName: "map-organiser" });
    return;
  }

  const headers = {
    "x-honeycomb-team": apiKey,
    "x-honeycomb-dataset": dataset,
  };

  registerOTel({
    serviceName: "map-organiser",
    traceExporter: new OTLPHttpJsonTraceExporter({
      url: `${baseUrl}/v1/traces`,
      headers,
    }),
    logRecordProcessors: [
      new BatchLogRecordProcessor(
        new OTLPLogExporter({
          url: `${baseUrl}/v1/logs`,
          headers,
        })
      ),
    ],
  });
}
