import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCount } from "@/lib/format";
import type { SummaryResponse } from "@signals/shared";

interface Props {
  data: SummaryResponse;
}

export function SessionsTile({ data }: Props) {
  const sessions = data.totals.sessions ?? 0;
  const bounces = data.totals.bounces ?? 0;
  // Sessions of one event / total sessions. 0 sessions → no meaningful
  // rate, show a muted em-dash rather than a misleading 0%.
  const bounceRate =
    sessions > 0 ? Math.round((bounces / sessions) * 100) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sessions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-4xl font-semibold tabular-nums">
          {formatCount(sessions)}
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Bounce rate</span>
          <span className="tabular-nums font-medium">
            {bounceRate === null ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              `${bounceRate}%`
            )}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
