/**
 * Format a count for tile rendering. Below 10K we show the full number
 * with locale grouping; beyond that we collapse to compact notation
 * (1.2K / 3.4M) because the tile real-estate is tight and the exact
 * digits stop mattering past a thousand pageviews.
 */
export function formatCount(n: number): string {
  if (n < 10000) return n.toLocaleString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
