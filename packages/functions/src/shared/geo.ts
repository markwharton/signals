import { readFileSync } from "node:fs";
import { Reader, type CountryResponse } from "mmdb-lib";

/**
 * Path to the MaxMind GeoLite2-Country MMDB. Resolved relative to this
 * compiled module so the same URL works in local `tsc` output
 * (`dist/shared/geo.js`) and in the deployed Function bundle
 * (`out/api/dist/shared/geo.js`) — both sit two dirs below the
 * package root where the `geo/` directory lives.
 */
const mmdbUrl = new URL("../../geo/GeoLite2-Country.mmdb", import.meta.url);

let reader: Reader<CountryResponse> | null = null;
let loadAttempted = false;
let warnedLoadFail = false;
let warnedMiss = false;

function getReader(): Reader<CountryResponse> | null {
  if (loadAttempted) return reader;
  loadAttempted = true;
  try {
    const buf = readFileSync(mmdbUrl);
    reader = new Reader<CountryResponse>(buf);
  } catch (err) {
    if (!warnedLoadFail) {
      warnedLoadFail = true;
      console.warn(
        `geo: MMDB unavailable at ${mmdbUrl.pathname} — country lookups` +
          ` will return null. Cause: ${(err as Error).message}`,
      );
    }
    reader = null;
  }
  return reader;
}

/**
 * Look up an ISO 3166-1 alpha-2 country code for an IP. Returns `null`
 * for any miss — private IP range, unmapped address, missing MMDB,
 * malformed input. The caller stores `country: null` on the event
 * rather than falling back to `Accept-Language` (explicit project
 * rule: no silent defaults derived from a different signal).
 *
 * A throttled one-liner is emitted the first time a miss is recorded
 * per cold start so operators notice if the database is stale or
 * absent, without flooding logs on every hit.
 */
export function lookupCountry(ip: string | null): string | null {
  if (!ip) return null;
  const r = getReader();
  if (!r) return null;
  let code: string | null = null;
  try {
    const record = r.get(ip);
    code = record?.country?.iso_code ?? null;
  } catch {
    code = null;
  }
  if (code === null && !warnedMiss) {
    warnedMiss = true;
    console.warn("geo:miss — first country lookup miss this cold start");
  }
  return code;
}
