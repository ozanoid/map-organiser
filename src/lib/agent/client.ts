import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { AgentError } from "@/lib/agent/errors";

let client: Anthropic | null = null;

/** The Claude API client, from ANTHROPIC_API_KEY. The SDK retries
 *  connection errors, 408, 409, 429 and 5xx twice with backoff. */
export function anthropicClient(): Anthropic {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new AgentError("auth", "ANTHROPIC_API_KEY is not set");
  client = new Anthropic({ apiKey });
  return client;
}
