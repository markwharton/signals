import type { SummaryResponse } from "@signals/shared";
import { BotSummaryTile } from "./tiles/BotSummaryTile";
import { DeviceTile } from "./tiles/DeviceTile";
import { PageviewsTile } from "./tiles/PageviewsTile";
import { TopBrokenTile } from "./tiles/TopBrokenTile";
import { TopPathsTile } from "./tiles/TopPathsTile";
import { TopReferrersTile } from "./tiles/TopReferrersTile";

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
  return (
    <div className="grid gap-4 p-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 md:p-6">
      <PageviewsTile data={data} showBots={showBots} />
      <TopPathsTile data={data} showBots={showBots} />
      <TopReferrersTile data={data} showBots={showBots} />
      <TopBrokenTile data={data} />
      <DeviceTile data={data} showBots={showBots} />
      <BotSummaryTile data={data} />
    </div>
  );
}
