import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkline } from "@/components/Sparkline";
import { formatCount } from "@/lib/format";
import type { SummaryResponse } from "@signals/shared";

interface Props {
  data: SummaryResponse;
  showBots: boolean;
}

export function PageviewsTile({ data, showBots }: Props) {
  const human = data.totals.pageviews;
  const bot = data.totals.botPageviews;
  const total = showBots ? human + bot : human;
  const sparkData = data.sparkline.map((d) =>
    showBots ? d.pageviews + d.botPageviews : d.pageviews,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pageviews</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-semibold tabular-nums">
            {formatCount(total)}
          </span>
          {showBots && bot > 0 ? (
            <Badge variant="secondary">+{formatCount(bot)} bot</Badge>
          ) : null}
        </div>
        <Sparkline data={sparkData} />
      </CardContent>
    </Card>
  );
}
