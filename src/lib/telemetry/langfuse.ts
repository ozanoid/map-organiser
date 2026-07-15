import "server-only";
import { LangfuseSpanProcessor, isDefaultExportSpan } from "@langfuse/otel";

/**
 * Langfuse span processor singleton.
 *
 * Plugged into the SAME OTel pipeline as Honeycomb (see
 * instrumentation-node.ts): `registerOTel({ spanProcessors: ["auto", …] })`
 * keeps the default Honeycomb export processor and adds this one alongside.
 * Dual-write, zero interference.
 *
 * By default the processor exports ONLY Langfuse + GenAI/LLM spans
 * (`shouldExportSpan` built-in filter) — infra spans (HTTP, Supabase fetch,
 * …) keep flowing to Honeycomb but never reach Langfuse, so the Langfuse
 * dashboard stays LLM-only. Auth + endpoint come from env:
 *   - LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY
 *   - LANGFUSE_BASE_URL (EU cloud: https://cloud.langfuse.com)
 *
 * When the keys are absent (e.g. local dev without Langfuse), the singleton
 * is null and everything downstream no-ops — same pattern as the
 * HONEYCOMB_API_KEY gate.
 *
 * WHY the globalThis stash (don't simplify this away): Turbopack compiles
 * the instrumentation hook and the app routes into DISJOINT bundle graphs,
 * each with its own copy of this module. A plain `export const … = new
 * LangfuseSpanProcessor()` therefore creates TWO instances — the
 * instrumentation copy gets registered with the tracer provider and
 * receives all spans, while the copy the routes import (for
 * `flushLangfuse`) is a never-registered empty shell, silently making
 * `after(flushLangfuse)` a no-op. `Symbol.for` + `globalThis` is
 * process-global across bundle graphs, so both sides resolve the SAME
 * instance (instrumentation boots first and wins the race).
 */
const GLOBAL_KEY: unique symbol = Symbol.for(
  "map-organiser.langfuse-span-processor"
);

type GlobalWithLangfuse = typeof globalThis & {
  [GLOBAL_KEY]?: LangfuseSpanProcessor | null;
};

const g = globalThis as GlobalWithLangfuse;

/**
 * AI SDK v6 emits TWO nested spans per LLM call: an outer umbrella
 * (`ai.generateText`, prefixed by functionId → `ai.parse-query:ai.generateText`)
 * and the provider call (`…ai.generateText.doGenerate`). The umbrella
 * span's aggregated input/output token attributes get lost in emission
 * (AI SDK v6 `totalUsage` aggregation bug), but `ai.usage.reasoningTokens`
 * survives — so Langfuse sees a reasoning-only usage on the umbrella and
 * prices those reasoning tokens a SECOND time on top of the child's
 * complete cost (~37% trace-cost inflation observed on live data,
 * 15.07.2026). The doGenerate span carries the complete usage + full
 * message IO, so it is the single source of truth: drop the umbrella.
 *
 * NOTE: a custom shouldExportSpan REPLACES the default filter entirely,
 * so we compose with `isDefaultExportSpan` to keep the LLM-only behavior.
 */
const AI_SDK_UMBRELLA_SPAN =
  /(^|:)ai\.(generateText|streamText|generateObject|streamObject)$/;

if (g[GLOBAL_KEY] === undefined) {
  g[GLOBAL_KEY] =
    process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY
      ? new LangfuseSpanProcessor({
          shouldExportSpan: ({ otelSpan }) =>
            isDefaultExportSpan(otelSpan) &&
            !AI_SDK_UMBRELLA_SPAN.test(otelSpan.name),
        })
      : null;
}

export const langfuseSpanProcessor: LangfuseSpanProcessor | null =
  g[GLOBAL_KEY];

/**
 * Flush pending Langfuse spans. Call inside `after(...)` in every route
 * that produces LLM spans — serverless functions can suspend right after
 * the response is sent, and unflushed OTel batches are lost with them.
 *
 * (On Vercel, @vercel/otel's CompositeSpanProcessor ALSO force-flushes all
 * registered processors per request via waitUntil — an undocumented vendor
 * internal. This explicit flush is the documented, portable guarantee.)
 */
export async function flushLangfuse(): Promise<void> {
  if (!langfuseSpanProcessor) return;
  try {
    await langfuseSpanProcessor.forceFlush();
  } catch (e) {
    // Telemetry must never break the request path.
    console.warn("[telemetry/langfuse] forceFlush failed:", e);
  }
}
