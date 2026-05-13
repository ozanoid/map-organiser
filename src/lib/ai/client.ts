import "server-only";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

/**
 * Gemini API client for AI features.
 * Uses the GOOGLE_GENERATIVE_AI_API_KEY env var (server-only).
 *
 * Model: gemini-flash-latest (Gemini 2.5 Flash family).
 * See docs/04-integrations/gemini.md (to be written in Phase 7).
 */
if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
  // Don't throw at module load — the env may be intentionally missing in
  // certain deployments (e.g. when ai_features_enabled is false globally).
  // Route handlers must check getAiClient() returns non-null before use.
  console.warn(
    "[ai/client] GOOGLE_GENERATIVE_AI_API_KEY is not set. AI features will be disabled at runtime."
  );
}

let _google: ReturnType<typeof createGoogleGenerativeAI> | null = null;

export function getAiClient() {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) return null;
  if (!_google) {
    _google = createGoogleGenerativeAI({
      apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    });
  }
  return _google;
}

/** Default model slug. Centralized so swapping models is a one-line change. */
export const FLASH_MODEL = "gemini-flash-latest";

/** Version string stored in place_profile.model_version for cache invalidation. */
export const MODEL_VERSION = "gemini-flash-latest";

/** Is AI globally available (env var present)? */
export function isAiAvailable(): boolean {
  return Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY);
}
