import Anthropic from "@anthropic-ai/sdk";

/**
 * Why a turn couldn't run, by who has to act. Each code has a message for
 * the user; the door decides how to show it.
 */
export type AgentErrorCode =
  | "budget_exhausted" // the platform's own monthly cap (assistant_spend) is reached
  | "spend_limit" // the Console's monthly limit on the Anthropic organisation is reached
  | "billing" // the Anthropic account can't be charged
  | "busy" // rate limited or overloaded, after the SDK's own retries
  | "auth" // the API key is missing, wrong or not allowed
  | "rejected" // the API refused the request as malformed — a bug on our side
  | "upstream" // the API failed
  | "connection" // the API couldn't be reached, or the stream broke twice
  | "aborted" // the caller cancelled
  | "conflict" // the conversation changed in another tab or request
  | "nothing_pending" // an approval arrived but no tool call is waiting for one
  | "not_found"; // no such conversation for this user

const USER_MESSAGES: Record<AgentErrorCode, string> = {
  budget_exhausted: "The assistant has used this month's budget. It will be back on the 1st.",
  spend_limit: "The assistant's monthly Claude API limit has been reached.",
  billing: "The assistant's Claude API account has a billing problem.",
  busy: "Claude is busy right now. Try again in a minute.",
  auth: "The assistant isn't set up correctly (Claude API key).",
  rejected: "The assistant couldn't process this request.",
  upstream: "Claude hit an error. Try again.",
  connection: "Couldn't reach Claude. Try again.",
  aborted: "Stopped.",
  conflict: "This conversation changed somewhere else. Reload to see the latest.",
  nothing_pending: "There's nothing waiting for approval.",
  not_found: "Conversation not found.",
};

export class AgentError extends Error {
  readonly userMessage: string;
  /** The API's request id, when the API answered — for support. */
  readonly requestId: string | null;
  constructor(
    readonly code: AgentErrorCode,
    detail?: string,
    options?: { cause?: unknown; requestId?: string | null }
  ) {
    super(detail ?? USER_MESSAGES[code], options);
    this.userMessage = USER_MESSAGES[code];
    this.requestId = options?.requestId ?? null;
  }
}

/** Maps an error from the Anthropic SDK to an AgentError. The SDK has
 *  already retried 408, 409, 429 and 5xx twice, with backoff. */
export function fromAnthropicError(err: unknown): AgentError {
  if (err instanceof AgentError) return err;
  if (err instanceof Anthropic.APIUserAbortError) return new AgentError("aborted", undefined, { cause: err });
  if (err instanceof Anthropic.APIConnectionError) {
    return new AgentError("connection", err.message, { cause: err });
  }
  if (err instanceof Anthropic.APIError) {
    const requestId = err.requestID ?? null;
    const detail = `${err.status ?? "?"} ${err.type ?? ""}: ${err.apiMessage ?? err.message}`;
    if (err.status === 429 && err.errorCode === "enforced_spend_limit_reached") {
      return new AgentError("spend_limit", detail, { cause: err, requestId });
    }
    switch (err.type) {
      case "billing_error":
        return new AgentError("billing", detail, { cause: err, requestId });
      case "rate_limit_error":
      case "overloaded_error":
        return new AgentError("busy", detail, { cause: err, requestId });
      case "authentication_error":
      case "permission_error":
        return new AgentError("auth", detail, { cause: err, requestId });
      case "invalid_request_error":
      case "not_found_error":
        return new AgentError("rejected", detail, { cause: err, requestId });
    }
    if (err.status === 402) return new AgentError("billing", detail, { cause: err, requestId });
    if (err.status === 429 || err.status === 529) return new AgentError("busy", detail, { cause: err, requestId });
    if (err.status === 401 || err.status === 403) return new AgentError("auth", detail, { cause: err, requestId });
    if (err.status !== undefined && err.status >= 400 && err.status < 500) {
      return new AgentError("rejected", detail, { cause: err, requestId });
    }
    return new AgentError("upstream", detail, { cause: err, requestId });
  }
  return new AgentError("upstream", err instanceof Error ? err.message : String(err), { cause: err });
}
