/**
 * Next.js OpenTelemetry instrumentation entry point.
 *
 * `register()` runs once per server process boot — for EVERY runtime,
 * including the Edge runtime that powers middleware.
 *
 * The actual OTel setup (`instrumentation-node.ts`) imports Node-only
 * OpenTelemetry packages (`@opentelemetry/sdk-logs`,
 * `@opentelemetry/exporter-logs-otlp-http`). Importing those in the Edge
 * runtime crashes middleware invocation with MIDDLEWARE_INVOCATION_FAILED
 * (observed in production after the Honeycomb pivot).
 *
 * Fix: gate by `NEXT_RUNTIME` and dynamic-import the Node setup ONLY in
 * the Node runtime. The Edge bundle never evaluates the Node-only
 * packages. This is the documented Next.js pattern for runtime-specific
 * instrumentation. Middleware (Edge) simply runs un-instrumented — it's
 * just the Supabase auth hop, low telemetry value.
 *
 * See docs/05-flows/observability-flow.md for the full architecture.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
