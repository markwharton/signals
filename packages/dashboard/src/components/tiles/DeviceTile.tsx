import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCount } from "@/lib/format";
import type { SummaryResponse } from "@signals/shared";

interface Props {
  data: SummaryResponse;
  showBots: boolean;
}

function percent(part: number, total: number): string {
  if (total === 0) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

export function DeviceTile({ data, showBots }: Props) {
  const mobile = data.device.mobile + (showBots ? data.device.botMobile : 0);
  const desktop = data.device.desktop + (showBots ? data.device.botDesktop : 0);
  const total = mobile + desktop;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Device</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Row label="Desktop" value={desktop} total={total} />
        <Row label="Mobile" value={mobile} total={total} />
      </CardContent>
    </Card>
  );
}

interface RowProps {
  label: string;
  value: number;
  total: number;
}

function Row({ label, value, total }: RowProps) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="tabular-nums font-medium">
          {formatCount(value)}
          <span className="ml-1 text-muted-foreground">
            {percent(value, total)}
          </span>
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
