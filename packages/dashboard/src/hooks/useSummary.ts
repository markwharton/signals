import { useEffect, useState } from "react";
import type { SummaryResponse } from "@signals/shared";
import { fetchSummary, type TimespanParam } from "@/lib/api";

interface SummaryState {
  data: SummaryResponse | null;
  loading: boolean;
  error: Error | null;
}

/**
 * Fetch /api/summary when the timespan changes. No cache layer and
 * no retry — the dashboard re-fetches on mount and on toggle, which
 * is the only surface we have. React 18 StrictMode double-invoking
 * in dev is handled by the `cancelled` guard.
 */
export function useSummary(days: TimespanParam): SummaryState {
  const [state, setState] = useState<SummaryState>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetchSummary(days)
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            data: null,
            loading: false,
            error: err instanceof Error ? err : new Error(String(err)),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [days]);

  return state;
}
