/**
 * Next.js OpenTelemetry instrumentation entry point.
 *
 * `register()` runs once per server process boot. We configure `@vercel/otel`
 * which:
 *   - Auto-detects Vercel's OTel platform integration (since the Vercel-
 *     Axiom marketplace integration is installed, traces forward to Axiom
 *     via Vercel's transparent pipe).
 *   - Wires AI SDK's `experimental_telemetry: { isEnabled: true, ... }`
 *     to the same trace pipeline. Each `generateText` call emits OTel
 *     spans with GenAI semantic conventions (gen_ai.system,
 *     gen_ai.prompt, gen_ai.completion, gen_ai.usage.* etc.).
 *   - Captures fetch / DB / route spans automatically.
 *
 * Service name = service.name attribute on every span. Used as a filter
 * in Axiom Stream / Dashboard.
 *
 * See docs/05-flows/observability-flow.md for the full architecture.
 */
import { registerOTel } from "@vercel/otel";

export function register() {
  registerOTel({
    serviceName: "map-organiser",
  });
}
