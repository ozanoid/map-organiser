/**
 * Minimal declaration for tz-lookup (no bundled types).
 * Offline coordinate → IANA timezone lookup (~70KB data, no API).
 * Throws RangeError on out-of-range coordinates — wrap in try/catch.
 */
declare module "tz-lookup" {
  export default function tzLookup(latitude: number, longitude: number): string;
}
