/**
 * Client-side W3C Trace Context for the AI search pipeline.
 *
 * AI search runs three sequential server calls from the browser —
 * parse-query → /api/places → rank-results. Without a shared trace
 * context each lands in Honeycomb as its own disconnected trace.
 *
 * `useAiSearch` mints one `traceparent` per search (see `newTraceparent`)
 * and attaches it to all three fetches; `@vercel/otel` on the server
 * extracts it via its default W3C Trace Context propagator, so the three
 * requests stitch into ONE trace — a single waterfall for the whole
 * pipeline.
 *
 * The parent span the `traceparent` points at is synthetic — the browser
 * never exports a span for it. Honeycomb renders the three server spans
 * under a generated root. A real, named browser-side root span would
 * need a full browser OpenTelemetry SDK + exporter, which is
 * intentionally out of scope here.
 *
 * See docs/05-flows/observability-flow.md.
 */

/** Lowercase-hex string of `bytes` cryptographically-random bytes. */
function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let hex = "";
  for (const b of buf) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/**
 * Mint a fresh W3C `traceparent` header value for one AI search.
 *
 * Format: `00-<32-hex trace-id>-<16-hex parent-id>-01`
 *   - version   `00`
 *   - trace-id  16 random bytes — shared by all three pipeline requests
 *   - parent-id  8 random bytes — the synthetic browser-side root span
 *   - flags     `01` (sampled — Honeycomb keeps the trace)
 */
export function newTraceparent(): string {
  return `00-${randomHex(16)}-${randomHex(8)}-01`;
}
