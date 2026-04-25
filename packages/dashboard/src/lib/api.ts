import type { SitesResponse, SummaryResponse } from "@signals/shared";

export type TimespanParam = "7" | "30" | "all";

/**
 * Fetch the dashboard summary for a given site and timespan. Relative
 * URL — SWA Managed Functions are same-origin, so no CORS handshake
 * and the SWA auth cookies ride along automatically.
 *
 * Optional `signal` lets the caller abort in-flight requests when the
 * timespan or site changes — summary calls can take seconds, and
 * without an abort a rapid switch spawns multiple concurrent slow
 * Function invocations.
 */
export async function fetchSummary(
  site: string,
  days: TimespanParam,
  signal?: AbortSignal,
): Promise<SummaryResponse> {
  const path = `/api/${encodeURIComponent(site)}/summary?days=${days}`;
  const res = await fetch(path, { credentials: "same-origin", signal });
  if (!res.ok) {
    throw new Error(`${path} returned ${res.status}`);
  }
  return (await res.json()) as SummaryResponse;
}

/**
 * Fetch the list of sites this deploy serves. Anonymous endpoint;
 * no auth header required. Used to populate the header's site
 * selector on dashboard mount.
 */
export async function fetchSites(signal?: AbortSignal): Promise<string[]> {
  const res = await fetch("/api/sites", {
    credentials: "same-origin",
    signal,
  });
  if (!res.ok) {
    throw new Error(`/api/sites returned ${res.status}`);
  }
  const body = (await res.json()) as SitesResponse;
  return body.sites;
}
