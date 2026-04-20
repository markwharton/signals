import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCount } from "@/lib/format";
import type { SummaryResponse } from "@signals/shared";

interface Props {
  data: SummaryResponse;
}

/**
 * Always shows bot traffic regardless of the "show bots" toggle —
 * this tile exists to answer "how much are we filtering?" A zero
 * bot count is itself useful information.
 */
export function BotSummaryTile({ data }: Props) {
  const botTotal = data.totals.botPageviews + data.totals.botNotFounds;
  const humanTotal = data.totals.pageviews + data.totals.notFounds;
  const grandTotal = botTotal + humanTotal;
  const pct = grandTotal > 0 ? (botTotal / grandTotal) * 100 : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bots filtered</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-semibold tabular-nums">
            {formatCount(botTotal)}
          </span>
          <span className="text-sm text-muted-foreground">
            {pct.toFixed(1)}% of all events
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Client-side isbot check on the beacon; raw user-agent never
          reaches the server.
        </p>
      </CardContent>
    </Card>
  );
}
