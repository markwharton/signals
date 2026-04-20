import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCount } from "@/lib/format";
import type { SummaryResponse } from "@signals/shared";

interface Props {
  data: SummaryResponse;
  showBots: boolean;
}

export function TopPathsTile({ data, showBots }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Top paths</CardTitle>
      </CardHeader>
      <CardContent>
        {data.topPaths.length === 0 ? (
          <p className="text-sm text-muted-foreground">No data yet.</p>
        ) : (
          <ul className="space-y-2">
            {data.topPaths.map((p) => {
              const total = showBots
                ? p.pageviews + p.botPageviews
                : p.pageviews;
              return (
                <li
                  key={p.path}
                  className="flex items-center justify-between gap-3"
                >
                  <span
                    className="truncate font-mono text-sm"
                    title={p.path}
                  >
                    {p.path}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="tabular-nums text-sm font-medium">
                      {formatCount(total)}
                    </span>
                    {showBots && p.botPageviews > 0 ? (
                      <Badge variant="secondary">
                        {formatCount(p.botPageviews)} bot
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
