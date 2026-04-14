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

export class DataForSEOError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message);
    this.name = "DataForSEOError";
  }
}

export class DataForSEOClient {
  private authHeader: string;

  constructor(creds: DataForSEOCredentials) {
    this.authHeader =
      "Basic " +
      Buffer.from(`${creds.login}:${creds.password}`).toString("base64");
  }

  async post<T>(endpoint: string, body: unknown[]): Promise<T> {
    const url = `${DATAFORSEO_BASE}${endpoint}`;
    console.log(`[DataForSEO REQUEST] POST ${url} | tasks: ${body.length}`);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const responseBody = await res.text();
    console.log(
      `[DataForSEO RESPONSE] ${res.status} ${res.statusText} | ${responseBody.substring(0, 500)}${responseBody.length > 500 ? "...[truncated]" : ""}`
    );

    if (!res.ok) {
      throw new DataForSEOError(
        `HTTP ${res.status}: ${res.statusText}`,
        res.status
      );
    }

    const data = JSON.parse(responseBody);

    if (data.status_code && data.status_code >= 40000) {
      throw new DataForSEOError(
        data.status_message || `API error: ${data.status_code}`,
        data.status_code
      );
    }

    return data as T;
  }

  async get<T>(endpoint: string): Promise<T> {
    const url = `${DATAFORSEO_BASE}${endpoint}`;
    console.log(`[DataForSEO REQUEST] GET ${url}`);

    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: this.authHeader,
      },
    });

    const responseBody = await res.text();
    console.log(
      `[DataForSEO RESPONSE] ${res.status} ${res.statusText} | ${responseBody.substring(0, 500)}${responseBody.length > 500 ? "...[truncated]" : ""}`
    );

    if (!res.ok) {
      throw new DataForSEOError(
        `HTTP ${res.status}: ${res.statusText}`,
        res.status
      );
    }

    const data = JSON.parse(responseBody);

    if (data.status_code && data.status_code >= 40000) {
      throw new DataForSEOError(
        data.status_message || `API error: ${data.status_code}`,
        data.status_code
      );
    }

    return data as T;
  }
}
