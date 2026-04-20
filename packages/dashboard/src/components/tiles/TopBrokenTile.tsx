import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCount } from "@/lib/format";
import type { SummaryResponse } from "@signals/shared";

interface Props {
  data: SummaryResponse;
}

/**
 * Broken paths — 404 traffic only. The "show bots" toggle doesn't
 * apply; this tile's whole point is surfacing broken links, and
 * whether those 404s came from bots or humans is rarely actionable
 * differently. Bot 404s are usually vuln-scanners on paths you never
 * owned; human 404s are usually stale external links worth fixing.
 * Summing them as the headline number is the right call.
 */
export function TopBrokenTile({ data }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Broken paths</CardTitle>
      </CardHeader>
      <CardContent>
        {data.topBrokenPaths.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No 404s in this window.
          </p>
        ) : (
          <ul className="space-y-2">
            {data.topBrokenPaths.map((p) => {
              const total = p.notFounds + p.botNotFounds;
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
                  <span className="tabular-nums text-sm font-medium">
                    {formatCount(total)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
