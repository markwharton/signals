import type { SummaryResponse } from "@signals/shared";

export type TimespanParam = "7" | "30" | "all";

/**
 * Fetch the dashboard summary for the given timespan. Relative URL —
 * SWA Managed Functions are same-origin, so no CORS handshake and the
 * SWA auth cookies ride along automatically.
 *
 * Optional `signal` lets the caller abort in-flight requests when the
 * timespan changes — summary calls can take seconds, and without an
 * abort a rapid 7→30→All tab click spawns three concurrent slow
 * Function invocations.
 */
export async function fetchSummary(
  days: TimespanParam,
  signal?: AbortSignal,
): Promise<SummaryResponse> {
  const res = await fetch(`/api/summary?days=${days}`, {
    credentials: "same-origin",
    signal,
  });
  if (!res.ok) {
    throw new Error(`/api/summary returned ${res.status}`);
  }
  return (await res.json()) as SummaryResponse;
}
