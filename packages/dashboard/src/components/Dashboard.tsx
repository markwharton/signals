import type { SummaryResponse } from "@signals/shared";
import { BotSummaryTile } from "./tiles/BotSummaryTile";
import { DeviceTile } from "./tiles/DeviceTile";
import { PageviewsTile } from "./tiles/PageviewsTile";
import { SessionsTile } from "./tiles/SessionsTile";
import { TopBrokenTile } from "./tiles/TopBrokenTile";
import { TopCountriesTile } from "./tiles/TopCountriesTile";
import { TopPathsTile } from "./tiles/TopPathsTile";
import { TopReferrersTile } from "./tiles/TopReferrersTile";
import { VisitorsTile } from "./tiles/VisitorsTile";

interface DashboardProps {
  data: SummaryResponse | null;
  loading: boolean;
  error: Error | null;
  showBots: boolean;
}

export function Dashboard({ data, loading, error, showBots }: DashboardProps) {
  if (error) {
    return (
      <div className="p-6 text-sm text-destructive">
        Failed to load summary: {error.message}
      </div>
    );
  }
  if (loading || !data) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Loading…</div>
    );
  }
  // Signal-mode tiles only render when the response carries signal
  // counters. On counter-mode deploys `sessions` is undefined and the
  // layout is exactly what it was before signal mode existed.
  const hasSignal = (data.totals.sessions ?? 0) > 0;
  return (
    <div className="grid gap-4 p-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 md:p-6">
      <PageviewsTile data={data} showBots={showBots} />
      {hasSignal ? <VisitorsTile data={data} /> : null}
      {hasSignal ? <SessionsTile data={data} /> : null}
      <TopPathsTile data={data} showBots={showBots} />
      <TopReferrersTile data={data} showBots={showBots} />
      {hasSignal ? <TopCountriesTile data={data} showBots={showBots} /> : null}
      <TopBrokenTile data={data} />
      <DeviceTile data={data} showBots={showBots} />
      <BotSummaryTile data={data} />
    </div>
  );
}
