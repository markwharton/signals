import type { SummaryCounters, SummaryResponse } from "@signals/shared";
import {
  DIRECT_SENTINEL,
  decodePathRowKey,
  rollupPartitionKey,
} from "@signals/shared";
import { TABLE_ROLLUPS, getTableClient } from "./tables.js";

const TOP_N = 5;

// "all" caps at a year back; if the site has been running longer a future
// migration can raise this or track the earliest-seen day in table state.
export const ALL_DAYS = 365;

function newCounters(): SummaryCounters {
  return { pageviews: 0, notFounds: 0, botPageviews: 0, botNotFounds: 0 };
}

function addCounters(a: SummaryCounters, b: Partial<SummaryCounters>): void {
  a.pageviews += b.pageviews ?? 0;
  a.notFounds += b.notFounds ?? 0;
  a.botPageviews += b.botPageviews ?? 0;
  a.botNotFounds += b.botNotFounds ?? 0;
}

function isoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function utcMidnightDaysAgo(now: Date, days: number): Date {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function nextUtcDay(d: Date): Date {
  const n = new Date(d);
  n.setUTCDate(n.getUTCDate() + 1);
  return n;
}

/**
 * Build a SummaryResponse for `site` over `days` UTC days ending at
 * yesterday UTC. Reads from the `rollups` table — today isn't covered
 * because the daily timer fires at 17:00 UTC for the day just ended,
 * so today's rollup doesn't exist yet.
 *
 * Called by the /api/summary HTTP handler and the /api/mcp tool;
 * keeps one source of truth for the dashboard shape.
 */
export async function buildSummary(
  site: string,
  days: number,
): Promise<SummaryResponse> {
  const now = new Date();
  const endDate = utcMidnightDaysAgo(now, 1);
  const startDate = utcMidnightDaysAgo(endDate, days - 1);

  const rollups = getTableClient(TABLE_ROLLUPS);

  const totals = newCounters();
  const sparkline: Array<{ date: string } & SummaryCounters> = [];
  const pathTotals = new Map<string, SummaryCounters>();
  const referrerTotals = new Map<string, SummaryCounters>();
  const device = { mobile: 0, desktop: 0, botMobile: 0, botDesktop: 0 };

  for (let d = new Date(startDate); d <= endDate; d = nextUtcDay(d)) {
    const dayTotals = newCounters();

    const pathPk = rollupPartitionKey(site, d, "path");
    for await (const row of rollups.listEntities<SummaryCounters>({
      queryOptions: { filter: `PartitionKey eq '${pathPk}'` },
    })) {
      if (!row.rowKey) continue;
      const path = decodePathRowKey(row.rowKey);
      const entry = pathTotals.get(path) ?? newCounters();
      addCounters(entry, row);
      pathTotals.set(path, entry);
      addCounters(dayTotals, row);
    }

    const refPk = rollupPartitionKey(site, d, "referrer");
    for await (const row of rollups.listEntities<SummaryCounters>({
      queryOptions: { filter: `PartitionKey eq '${refPk}'` },
    })) {
      const host = row.rowKey ?? DIRECT_SENTINEL;
      const entry = referrerTotals.get(host) ?? newCounters();
      addCounters(entry, row);
      referrerTotals.set(host, entry);
    }

    const devPk = rollupPartitionKey(site, d, "device");
    for await (const row of rollups.listEntities<SummaryCounters>({
      queryOptions: { filter: `PartitionKey eq '${devPk}'` },
    })) {
      const traffic = (row.pageviews ?? 0) + (row.notFounds ?? 0);
      const botTraffic = (row.botPageviews ?? 0) + (row.botNotFounds ?? 0);
      if (row.rowKey === "mobile") {
        device.mobile += traffic;
        device.botMobile += botTraffic;
      } else if (row.rowKey === "desktop") {
        device.desktop += traffic;
        device.botDesktop += botTraffic;
      }
    }

    addCounters(totals, dayTotals);
    sparkline.push({ date: isoDate(d), ...dayTotals });
  }

  const pathEntries = Array.from(pathTotals.entries(), ([path, c]) => ({
    path,
    ...c,
  }));
  pathEntries.sort(
    (a, b) => b.pageviews + b.notFounds - (a.pageviews + a.notFounds),
  );
  const topPaths = pathEntries.slice(0, TOP_N);

  const refEntries = Array.from(
    referrerTotals.entries(),
    ([referrerHost, c]) => ({ referrerHost, ...c }),
  );
  refEntries.sort(
    (a, b) => b.pageviews + b.notFounds - (a.pageviews + a.notFounds),
  );
  const topReferrers = refEntries.slice(0, TOP_N);

  const brokenEntries = pathEntries
    .filter((p) => p.notFounds > 0 || p.botNotFounds > 0)
    .map((p) => ({
      path: p.path,
      notFounds: p.notFounds,
      botNotFounds: p.botNotFounds,
    }))
    .sort((a, b) => b.notFounds - a.notFounds);
  const topBrokenPaths = brokenEntries.slice(0, TOP_N);

  return {
    timespan: {
      days,
      startDate: isoDate(startDate),
      endDate: isoDate(endDate),
    },
    totals,
    sparkline,
    topPaths,
    topReferrers,
    topBrokenPaths,
    device,
  };
}

/**
 * Parse the `days` query string value. Accepts "all" (caps at
 * ALL_DAYS) and any positive integer in [1, ALL_DAYS]; defaults to 7
 * when absent. Returns either the resolved day count or an
 * error-shaped object for the handler to forward as 400.
 */
export function parseDays(raw: string | null): number | { error: string } {
  const value = raw ?? "7";
  if (value === "all") return ALL_DAYS;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > ALL_DAYS) {
    return {
      error: `days must be an integer between 1 and ${ALL_DAYS}, or "all"`,
    };
  }
  return n;
}
