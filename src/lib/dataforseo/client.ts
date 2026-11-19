/**
 * DataForSEO HTTP Client.
 *
 * Handles Basic Auth, request formatting, error handling.
 * Rate limit: 2000 calls/min, max 100 tasks per POST.
 */

const DATAFORSEO_BASE = "https://api.dataforseo.com/v3";

export interface DataForSEOCredentials {
  login: string;
  password: string;
}

/**
 * Any DataForSEO failure. `statusCode` is the HTTP status (3 digits), a
 * DataForSEO status code (5 digits, top-level or task-level), or 0 when
 * there was no usable answer: network failure, timeout, abort, a body that
 * isn't JSON, a task that didn't finish in time.
 */
export class DataForSEOError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "DataForSEOError";
  }

  /**
   * Is DataForSEO itself failing, rather than this one request? Then every
   * request fails the same way until it recovers or the account is fixed —
   * retry later, and don't hold it against the item being processed
   * (v1.45.0):
   *  - no usable answer (0);
   *  - HTTP 401, 402, 403, 429 and 5xx;
   *  - DataForSEO 401xx (access) and 402xx (balance, rate limits) — 40102
   *    "No Search Results" is an answer, not an error — and 5xxxx (internal).
   * Anything else (404xx bad path, 405xx invalid field, …) is this request's
   * own fault.
   */
  get serviceFailure(): boolean {
    const c = this.statusCode;
    if (c === 0) return true;
    if (c < 1000) return c >= 500 || c === 401 || c === 402 || c === 403 || c === 429;
    if (c >= 50000) return true;
    return c >= 40100 && c < 40300 && c !== 40102;
  }
}

/** True for a DataForSEO failure of the service as a whole (see `DataForSEOError.serviceFailure`). */
export function isServiceFailure(error: unknown): boolean {
  return error instanceof DataForSEOError && error.serviceFailure;
}

export class DataForSEOClient {
  private authHeader: string;

  constructor(creds: DataForSEOCredentials) {
    this.authHeader =
      "Basic " +
      Buffer.from(`${creds.login}:${creds.password}`).toString("base64");
  }

  async post<T>(endpoint: string, body: unknown[], opts: { signal?: AbortSignal } = {}): Promise<T> {
    console.log(`[DataForSEO REQUEST] POST ${DATAFORSEO_BASE}${endpoint} | tasks: ${body.length}`);
    return this.request<T>(endpoint, {
      method: "POST",
      headers: { Authorization: this.authHeader, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  }

  async get<T>(endpoint: string): Promise<T> {
    console.log(`[DataForSEO REQUEST] GET ${DATAFORSEO_BASE}${endpoint}`);
    return this.request<T>(endpoint, { method: "GET", headers: { Authorization: this.authHeader } });
  }

  /**
   * Every failure comes out as a DataForSEOError — the network, a timeout or
   * an abort, and a body that isn't JSON too (status 0), so callers can tell
   * a failing service from a bad request (`serviceFailure`).
   */
  private async request<T>(endpoint: string, init: RequestInit): Promise<T> {
    let res: Response;
    let responseBody: string;
    try {
      res = await fetch(`${DATAFORSEO_BASE}${endpoint}`, init);
      responseBody = await res.text();
    } catch (error) {
      const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      throw new DataForSEOError(`DataForSEO unreachable — ${reason}`, 0, { cause: error });
    }
    console.log(
      `[DataForSEO RESPONSE] ${res.status} ${res.statusText} | ${responseBody.substring(0, 500)}${responseBody.length > 500 ? "...[truncated]" : ""}`
    );

    if (!res.ok) {
      throw new DataForSEOError(`HTTP ${res.status}: ${res.statusText}`, res.status);
    }

    let data: { status_code?: number; status_message?: string };
    try {
      data = JSON.parse(responseBody);
    } catch (error) {
      throw new DataForSEOError("DataForSEO answered something that isn't JSON", 0, { cause: error });
    }

    if (data.status_code && data.status_code >= 40000) {
      throw new DataForSEOError(
        data.status_message || `API error: ${data.status_code}`,
        data.status_code
      );
    }

    return data as T;
  }
}

/** The system DataForSEO account (DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD), or
 *  null when the server has no credentials. */
export function dataForSeoClientFromEnv(): DataForSEOClient | null {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return null;
  return new DataForSEOClient({ login, password });
}
