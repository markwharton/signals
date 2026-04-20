import { cn } from "@/lib/utils";

interface SparklineProps {
  data: number[];
  className?: string;
  height?: number;
}

/**
 * Hand-rolled SVG sparkline: polyline over the normalized data range,
 * rendered at a fixed viewBox and scaled to container width via
 * preserveAspectRatio="none". `stroke="currentColor"` picks up whatever
 * text color is in scope, so the line follows light/dark theme without
 * explicit per-mode CSS.
 */
export function Sparkline({ data, className, height = 40 }: SparklineProps) {
  if (data.length === 0) return null;
  const VIEW_WIDTH = 200;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const xStep = VIEW_WIDTH / Math.max(data.length - 1, 1);
  const points = data
    .map(
      (v, i) =>
        `${(i * xStep).toFixed(2)},${(height - ((v - min) / range) * height).toFixed(2)}`,
    )
    .join(" ");

  return (
    <svg
      className={cn("w-full text-primary", className)}
      height={height}
      viewBox={`0 0 ${VIEW_WIDTH} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        points={points}
      />
    </svg>
  );
}
