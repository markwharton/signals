import { useEffect, useState } from "react";
import { Dashboard } from "./components/Dashboard";
import { Header } from "./components/Header";
import { useSites } from "./hooks/useSites";
import { useSummary } from "./hooks/useSummary";
import type { TimespanParam } from "./lib/api";

/**
 * Read the current site from the URL hash, e.g. `#site=plankit.com`.
 * Returns null if absent or malformed; the caller falls back to the
 * first allowlisted site once the sites list resolves.
 */
function readSiteFromHash(): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  return params.get("site");
}

function writeSiteToHash(site: string): void {
  const hash = `#site=${encodeURIComponent(site)}`;
  if (window.location.hash !== hash) {
    window.history.replaceState(null, "", hash);
  }
}

export function App() {
  const [timespan, setTimespan] = useState<TimespanParam>("7");
  const [showBots, setShowBots] = useState(false);
  const [selectedSite, setSelectedSite] = useState<string>(
    () => readSiteFromHash() ?? "",
  );

  const { sites, error: sitesError } = useSites();

  // Once the sites list lands, pick a default if none selected (or
  // if the URL hash named a site that isn't in the allowlist).
  useEffect(() => {
    if (sites.length === 0) return;
    if (!selectedSite || !sites.includes(selectedSite)) {
      setSelectedSite(sites[0]);
    }
  }, [sites, selectedSite]);

  // Mirror the selection to the URL hash so reloads/bookmarks land
  // back on the same site.
  useEffect(() => {
    if (selectedSite) writeSiteToHash(selectedSite);
  }, [selectedSite]);

  const { data, loading, error } = useSummary(selectedSite, timespan);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header
        sites={sites}
        selectedSite={selectedSite}
        onSelectedSiteChange={setSelectedSite}
        timespan={timespan}
        onTimespanChange={setTimespan}
        showBots={showBots}
        onShowBotsChange={setShowBots}
      />
      <main>
        <Dashboard
          data={data}
          loading={loading}
          error={error ?? sitesError}
          showBots={showBots}
        />
      </main>
    </div>
  );
}
