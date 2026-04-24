import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkline } from "@/components/Sparkline";
import { formatCount } from "@/lib/format";
import type { SummaryResponse } from "@signals/shared";

interface Props {
  data: SummaryResponse;
}

export function VisitorsTile({ data }: Props) {
  const total = data.totals.visitors ?? 0;
  const sparkData = data.sparkline.map((d) => d.visitors ?? 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Visitors</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-4xl font-semibold tabular-nums">
          {formatCount(total)}
        </div>
        <Sparkline data={sparkData} />
      </CardContent>
    </Card>
  );
}
