import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCount } from "@/lib/format";
import type { SummaryResponse } from "@signals/shared";

interface Props {
  data: SummaryResponse;
  showBots: boolean;
}

export function TopReferrersTile({ data, showBots }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Top referrers</CardTitle>
      </CardHeader>
      <CardContent>
        {data.topReferrers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No data yet.</p>
        ) : (
          <ul className="space-y-2">
            {data.topReferrers.map((r) => {
              const total = showBots
                ? r.pageviews + r.botPageviews
                : r.pageviews;
              const isDirect = r.referrerHost === "(direct)";
              return (
                <li
                  key={r.referrerHost}
                  className="flex items-center justify-between gap-3"
                >
                  <span
                    className={
                      isDirect
                        ? "text-sm text-muted-foreground italic"
                        : "truncate text-sm"
                    }
                    title={r.referrerHost}
                  >
                    {r.referrerHost}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="tabular-nums text-sm font-medium">
                      {formatCount(total)}
                    </span>
                    {showBots && r.botPageviews > 0 ? (
                      <Badge variant="secondary">
                        {formatCount(r.botPageviews)} bot
                      </Badge>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
