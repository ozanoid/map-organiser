/**
 * Data Provider factory.
 *
 * Reads DATA_PROVIDER env var to determine which provider to use.
 * Default: "google" (no behavior change from existing system).
 */

import type { PlaceDataProvider, DataProviderName } from "./types";

export type { PlaceDataProvider, ProviderCredentials, PlaceDetailsResult, ExtendedPlaceData } from "./types";

function getProviderName(): DataProviderName {
  const env = process.env.DATA_PROVIDER?.toLowerCase();
  if (env === "dataforseo") return "dataforseo";
  return "google";
}

export async function getProvider(): Promise<PlaceDataProvider> {
  const name = getProviderName();

  if (name === "dataforseo") {
    const { DataForSEOProvider } = await import("@/lib/dataforseo/provider");
    return new DataForSEOProvider();
  }

  const { GoogleProvider } = await import("./google-adapter");
  return new GoogleProvider();
}

export function getProviderNameSync(): DataProviderName {
  return getProviderName();
}
