import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCount } from "@/lib/format";
import type { SummaryResponse } from "@signals/shared";

interface Props {
  data: SummaryResponse;
  showBots: boolean;
}

const UNKNOWN = "(unknown)";

export function TopCountriesTile({ data, showBots }: Props) {
  const countries = data.topCountries ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Top countries</CardTitle>
      </CardHeader>
      <CardContent>
        {countries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No data yet.</p>
        ) : (
          <ul className="space-y-2">
            {countries.map((c) => {
              const total = showBots
                ? c.pageviews + c.botPageviews
                : c.pageviews;
              const isUnknown = c.country === UNKNOWN;
              return (
                <li
                  key={c.country}
                  className="flex items-center justify-between gap-3"
                >
                  <span
                    className={
                      isUnknown
                        ? "text-sm text-muted-foreground italic"
                        : "truncate text-sm"
                    }
                    title={c.country}
                  >
                    {c.country}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="tabular-nums text-sm font-medium">
                      {formatCount(total)}
                    </span>
                    {showBots && c.botPageviews > 0 ? (
                      <Badge variant="secondary">
                        {formatCount(c.botPageviews)} bot
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
