import { useEffect, useState } from "react";
import { fetchSites } from "@/lib/api";

interface SitesState {
  sites: string[];
  loading: boolean;
  error: Error | null;
}

/**
 * Fetch /api/sites once on mount. The list is small and stable for
 * the lifetime of a deploy, so no refresh logic — operators editing
 * `SIGNALS_SITES` already trigger a redeploy that drops the
 * dashboard's bundle anyway.
 */
export function useSites(): SitesState {
  const [state, setState] = useState<SitesState>({
    sites: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    const controller = new AbortController();
    fetchSites(controller.signal)
      .then((sites) => {
        if (!controller.signal.aborted) {
          setState({ sites, loading: false, error: null });
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setState({
          sites: [],
          loading: false,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      });
    return () => {
      controller.abort();
    };
  }, []);

  return state;
}
