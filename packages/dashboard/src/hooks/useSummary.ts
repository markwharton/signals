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
 * in dev is handled by the AbortController cleanup.
 *
 * Aborting matters because summary responses can take seconds: without
 * it, a rapid 7→30→All tab click fires three concurrent slow requests
 * and the last one to resolve wins the UI — potentially a stale window.
 */
export function useSummary(days: TimespanParam): SummaryState {
  const [state, setState] = useState<SummaryState>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    fetchSummary(days, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setState({ data, loading: false, error: null });
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setState({
          data: null,
          loading: false,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      });
    return () => {
      controller.abort();
    };
  }, [days]);

  return state;
}
