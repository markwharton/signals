import type { SummaryCounters, SummaryResponse } from "@signals/shared";
import {
  DIRECT_SENTINEL,
  decodePathRowKey,
  rollupPartitionKey,
} from "@signals/shared";
import { runWithConcurrency } from "./concurrency.js";
import { TABLE_ROLLUPS, getTableClient } from "./tables.js";

const TOP_N = 5;

// "all" caps at a year back; if the site has been running longer a future
// migration can raise this or track the earliest-seen day in table state.
export const ALL_DAYS = 365;

// Cap in-flight partition reads. At days=365 this loop dispatches ~1095
// tiny queries; serial would be ~45s at measured ~150-200ms/query. 20 is
// comfortably under SDK socket defaults and leaves headroom for the Function
// host. Raise only if profiling shows queries queuing at the client.
const READ_CONCURRENCY = 20;

type Dimension = "path" | "referrer" | "device";

interface DayDimResult {
  dayIndex: number;
  dim: Dimension;
  rows: Array<{ rowKey: string | undefined } & SummaryCounters>;
}

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

  const dayList: Date[] = [];
  for (let d = new Date(startDate); d <= endDate; d = nextUtcDay(d)) {
    dayList.push(new Date(d));
  }

  // Build the fan-out: one task per (day, dimension). Run with a bounded
  // pool so long windows don't open 1000+ concurrent sockets.
  const dims: Dimension[] = ["path", "referrer", "device"];
  const tasks: Array<() => Promise<DayDimResult>> = [];
  for (let i = 0; i < dayList.length; i++) {
    const d = dayList[i];
    for (const dim of dims) {
      const pk = rollupPartitionKey(site, d, dim);
      tasks.push(async () => {
        const rows: Array<{ rowKey: string | undefined } & SummaryCounters> = [];
        for await (const row of rollups.listEntities<SummaryCounters>({
          queryOptions: { filter: `PartitionKey eq '${pk}'` },
        })) {
          rows.push({
            rowKey: row.rowKey,
            pageviews: row.pageviews ?? 0,
            notFounds: row.notFounds ?? 0,
            botPageviews: row.botPageviews ?? 0,
            botNotFounds: row.botNotFounds ?? 0,
          });
        }
        return { dayIndex: i, dim, rows };
      });
    }
  }

  const results = await runWithConcurrency(tasks, READ_CONCURRENCY);

  const totals = newCounters();
  const pathTotals = new Map<string, SummaryCounters>();
  const referrerTotals = new Map<string, SummaryCounters>();
  const device = { mobile: 0, desktop: 0, botMobile: 0, botDesktop: 0 };

  // Per-day totals rebuilt from the path dimension (same as pre-parallel code
  // which derived dayTotals from path rows). Indexed by dayList position so
  // the sparkline stays in calendar order regardless of completion order.
  const dayTotals: SummaryCounters[] = dayList.map(() => newCounters());

  for (const res of results) {
    if (res.dim === "path") {
      for (const row of res.rows) {
        if (!row.rowKey) continue;
        const path = decodePathRowKey(row.rowKey);
        const entry = pathTotals.get(path) ?? newCounters();
        addCounters(entry, row);
        pathTotals.set(path, entry);
        addCounters(dayTotals[res.dayIndex], row);
      }
    } else if (res.dim === "referrer") {
      for (const row of res.rows) {
        const host = row.rowKey ?? DIRECT_SENTINEL;
        const entry = referrerTotals.get(host) ?? newCounters();
        addCounters(entry, row);
        referrerTotals.set(host, entry);
      }
    } else {
      for (const row of res.rows) {
        const traffic = row.pageviews + row.notFounds;
        const botTraffic = row.botPageviews + row.botNotFounds;
        if (row.rowKey === "mobile") {
          device.mobile += traffic;
          device.botMobile += botTraffic;
        } else if (row.rowKey === "desktop") {
          device.desktop += traffic;
          device.botDesktop += botTraffic;
        }
      }
    }
  }

  const sparkline: Array<{ date: string } & SummaryCounters> = dayList.map(
    (d, i) => ({ date: isoDate(d), ...dayTotals[i] }),
  );
  for (const dt of dayTotals) addCounters(totals, dt);

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
