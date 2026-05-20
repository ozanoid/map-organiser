/**
 * Next.js OpenTelemetry instrumentation entry point.
 *
 * `register()` runs once per server process boot. Two roles:
 *
 *   1. Activate OTel context for the request lifecycle — without this,
 *      `trace.getActiveSpan()` returns undefined inside route handlers
 *      and our logger can't attach traceId/spanId to logs.
 *
 *   2. Export OTel spans to Axiom via OTLP/HTTP. Spans include:
 *        - HTTP request spans (auto-instrumented by @vercel/otel)
 *        - fetch spans (e.g., calls to Supabase, Gemini)
 *        - gen_ai.* spans from AI SDK `experimental_telemetry: true`
 *          (prompt, completion, input/output tokens, model, latency)
 *
 * Required env vars (set on Vercel via marketplace integration + manual):
 *   - AXIOM_TOKEN   — Axiom ingest API token (xat-...)
 *   - AXIOM_DATASET — Axiom dataset name (default: "vercel")
 *
 * When AXIOM_TOKEN is absent (e.g., local `next dev` without
 * env), exporter is omitted — OTel still produces spans in memory
 * (so logger trace context still works) but doesn't ship them.
 *
 * See docs/05-flows/observability-flow.md for the full architecture.
 */
import { registerOTel, OTLPHttpJsonTraceExporter } from "@vercel/otel";

export function register() {
  const token = process.env.AXIOM_TOKEN;
  const dataset = process.env.AXIOM_DATASET ?? "vercel";

  registerOTel({
    serviceName: "map-organiser",
    traceExporter: token
      ? new OTLPHttpJsonTraceExporter({
          url: "https://api.axiom.co/v1/traces",
          headers: {
            Authorization: `Bearer ${token}`,
            "X-Axiom-Dataset": dataset,
          },
        })
      : undefined,
  });
}
