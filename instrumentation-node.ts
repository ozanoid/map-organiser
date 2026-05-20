/**
 * Node-runtime-only OpenTelemetry setup.
 *
 * Dynamically imported by `instrumentation.ts` ONLY when
 * `NEXT_RUNTIME === "nodejs"`. Never loaded in the Edge runtime, so the
 * Node-only OpenTelemetry packages below (`@opentelemetry/sdk-logs`,
 * `@opentelemetry/exporter-logs-otlp-http`) are never evaluated there.
 * See instrumentation.ts for the why.
 *
 * Configures `@vercel/otel` with BOTH:
 *   1. Trace pipeline → Honeycomb /v1/traces
 *        - HTTP request spans (auto)
 *        - fetch spans (Supabase, Gemini)
 *        - gen_ai.* spans from AI SDK `experimental_telemetry`
 *   2. Log pipeline → Honeycomb /v1/logs
 *        - `log.{debug,info,warn,error}` records, trace-correlated
 *
 * Required env vars (Vercel):
 *   - HONEYCOMB_API_KEY  — ingest token, production environment
 *   - HONEYCOMB_DATASET  — dataset name (default: "map-organiser")
 *   - HONEYCOMB_API_URL  — base URL (default US; EU = api.eu1.honeycomb.io)
 *
 * When HONEYCOMB_API_KEY is absent (local dev), exporters are omitted —
 * the OTel SDK still runs so logger trace-context still works.
 */
import { registerOTel, OTLPHttpJsonTraceExporter } from "@vercel/otel";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";

const apiKey = process.env.HONEYCOMB_API_KEY;
const dataset = process.env.HONEYCOMB_DATASET ?? "map-organiser";
const baseUrl = process.env.HONEYCOMB_API_URL ?? "https://api.honeycomb.io";

if (!apiKey) {
  // Local dev / no-key path: SDK runs, in-memory spans only.
  registerOTel({ serviceName: "map-organiser" });
} else {
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
