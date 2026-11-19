/**
 * Next.js OpenTelemetry instrumentation entry point.
 *
 * `register()` runs once per server process boot — for EVERY runtime. Since
 * v1.44.0 the proxy (src/proxy.ts, was middleware) runs on Node.js too, so it
 * is instrumented like the routes; no code here runs on Edge any more, but
 * the gate stays for any future Edge route.
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
 * instrumentation. (Until v1.44.0 the middleware ran on Edge and so
 * un-instrumented.)
 *
 * See docs/05-flows/observability-flow.md for the full architecture.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
