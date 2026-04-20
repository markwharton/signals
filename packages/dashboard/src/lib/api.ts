import type { SummaryResponse } from "@signals/shared";

export type TimespanParam = "7" | "30" | "all";

/**
 * Fetch the dashboard summary for the given timespan. Relative URL —
 * SWA Managed Functions are same-origin, so no CORS handshake and the
 * SWA auth cookies ride along automatically.
 */
export async function fetchSummary(
  days: TimespanParam,
): Promise<SummaryResponse> {
  const res = await fetch(`/api/summary?days=${days}`, {
    credentials: "same-origin",
  });
  if (!res.ok) {
    throw new Error(`/api/summary returned ${res.status}`);
  }
  return (await res.json()) as SummaryResponse;
}
