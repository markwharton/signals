import type { SummaryCounters, SummaryResponse } from "@signals/shared";
import {
  DIRECT_SENTINEL,
  decodePathRowKey,
  rollupMonthlyPartitionKey,
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

type DailyDimension = "path" | "referrer" | "device" | "country";
type MonthlyDimension = "referrer" | "device" | "country";

/**
 * The sparkline needs per-day granularity (the dashboard chart plots one
 * point per day), so the path dimension is always read from the daily tier
 * — that gives us `dayTotals` for free. Referrer and device rarely need
 * per-day resolution, so full calendar months within the window are served
 * from the monthly tier, and only the edge days (outside any full month)
 * fall back to daily reads.
 */
interface DailyRead {
  dayIndex: number;
  dim: DailyDimension;
  rows: Array<{ rowKey: string | undefined } & SummaryCounters>;
}

interface MonthlyRead {
  dim: MonthlyDimension;
  rows: Array<{ rowKey: string | undefined } & SummaryCounters>;
}

interface WindowSplit {
  /** Day indices into dayList that must be read from the daily tier for
   * referrer+device (the path dim always reads all dayList entries). */
  tailDayIndices: number[];
  /** First-of-month UTC dates for full months inside the window. */
  fullMonthStarts: Date[];
}

/**
 * Split `dayList` into (a) whole calendar months fully contained in the
 * window and (b) the edge days that flank them. Used to route
 * referrer/device reads through the monthly tier when we can, and fall
 * back to daily for the partial months at each end.
 */
function splitWindow(dayList: Date[]): WindowSplit {
  if (dayList.length === 0) {
    return { tailDayIndices: [], fullMonthStarts: [] };
  }
  const start = dayList[0];
  const end = dayList[dayList.length - 1];

  // First day of the first full month: the first-of-month on/after start.
  let firstFullMonth = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1),
  );
  if (start.getUTCDate() !== 1) {
    firstFullMonth = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1),
    );
  }

  // Last day of the last full month: the last-of-month on/before end.
  const endMonthLast = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0),
  );
  let lastFullMonthEnd: Date;
  if (end.getTime() === endMonthLast.getTime()) {
    lastFullMonthEnd = endMonthLast;
  } else {
    // Last day of the previous month.
    lastFullMonthEnd = new Date(
      Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 0),
    );
  }

  const fullMonthStarts: Date[] = [];
  if (firstFullMonth.getTime() <= lastFullMonthEnd.getTime()) {
    for (
      let m = new Date(firstFullMonth);
      m.getTime() <= lastFullMonthEnd.getTime();
      m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))
    ) {
      fullMonthStarts.push(new Date(m));
    }
  }

  const tailDayIndices: number[] = [];
  for (let i = 0; i < dayList.length; i++) {
    const d = dayList[i];
    const inFullMonths =
      fullMonthStarts.length > 0 &&
      d.getTime() >= firstFullMonth.getTime() &&
      d.getTime() <= lastFullMonthEnd.getTime();
    if (!inFullMonths) tailDayIndices.push(i);
  }

  return { tailDayIndices, fullMonthStarts };
}

async function readPartition(
  rollups: ReturnType<typeof getTableClient>,
  partitionKey: string,
): Promise<Array<{ rowKey: string | undefined } & SummaryCounters>> {
  const out: Array<{ rowKey: string | undefined } & SummaryCounters> = [];
  for await (const row of rollups.listEntities<SummaryCounters>({
    queryOptions: { filter: `PartitionKey eq '${partitionKey}'` },
  })) {
    out.push({
      rowKey: row.rowKey,
      pageviews: row.pageviews ?? 0,
      notFounds: row.notFounds ?? 0,
      botPageviews: row.botPageviews ?? 0,
      botNotFounds: row.botNotFounds ?? 0,
      visitors: row.visitors,
      sessions: row.sessions,
      bounces: row.bounces,
    });
  }
  return out;
}

function addReferrer(
  totals: Map<string, SummaryCounters>,
  row: { rowKey: string | undefined } & SummaryCounters,
): void {
  const host = row.rowKey ?? DIRECT_SENTINEL;
  const entry = totals.get(host) ?? newCounters();
  addCounters(entry, row);
  totals.set(host, entry);
}

function addDevice(
  device: { mobile: number; desktop: number; botMobile: number; botDesktop: number },
  row: { rowKey: string | undefined } & SummaryCounters,
): void {
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

function newCounters(): SummaryCounters {
  return { pageviews: 0, notFounds: 0, botPageviews: 0, botNotFounds: 0 };
}

function addCounters(a: SummaryCounters, b: Partial<SummaryCounters>): void {
  a.pageviews += b.pageviews ?? 0;
  a.notFounds += b.notFounds ?? 0;
  a.botPageviews += b.botPageviews ?? 0;
  a.botNotFounds += b.botNotFounds ?? 0;
  // Signal-mode counters: add only when the incoming row carries them,
  // so counter-mode summaries leave `visitors/sessions/bounces`
  // undefined on the response rather than surfacing as 0.
  if (b.visitors !== undefined) a.visitors = (a.visitors ?? 0) + b.visitors;
  if (b.sessions !== undefined) a.sessions = (a.sessions ?? 0) + b.sessions;
  if (b.bounces !== undefined) a.bounces = (a.bounces ?? 0) + b.bounces;
}

function addCountry(
  totals: Map<string, SummaryCounters>,
  row: { rowKey: string | undefined } & SummaryCounters,
): void {
  const country = row.rowKey;
  if (!country) return;
  const entry = totals.get(country) ?? newCounters();
  addCounters(entry, row);
  totals.set(country, entry);
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

  const split = splitWindow(dayList);

  // Daily reads: the full path dim (every day, needed for sparkline), plus
  // referrer + device for tail days outside any full calendar month.
  const dailyTasks: Array<() => Promise<DailyRead>> = [];
  for (let i = 0; i < dayList.length; i++) {
    const d = dayList[i];
    const pk = rollupPartitionKey(site, d, "path");
    dailyTasks.push(async () => ({
      dayIndex: i,
      dim: "path",
      rows: await readPartition(rollups, pk),
    }));
  }
  for (const i of split.tailDayIndices) {
    const d = dayList[i];
    for (const dim of ["referrer", "device", "country"] as const) {
      const pk = rollupPartitionKey(site, d, dim);
      dailyTasks.push(async () => ({
        dayIndex: i,
        dim,
        rows: await readPartition(rollups, pk),
      }));
    }
  }

  // Monthly reads: referrer + device + country for each full calendar
  // month inside the window. The monthly writer keeps these in sync
  // with the dailies.
  const monthlyTasks: Array<() => Promise<MonthlyRead>> = [];
  for (const m of split.fullMonthStarts) {
    for (const dim of ["referrer", "device", "country"] as const) {
      const pk = rollupMonthlyPartitionKey(site, m, dim);
      monthlyTasks.push(async () => ({
        dim,
        rows: await readPartition(rollups, pk),
      }));
    }
  }

  // Route both sets through a single concurrency pool so the in-flight
  // cap applies across tiers, not independently per tier.
  type MixedRead =
    | { kind: "daily"; r: DailyRead }
    | { kind: "monthly"; r: MonthlyRead };
  const mixed: Array<() => Promise<MixedRead>> = [
    ...dailyTasks.map(
      (t) => async (): Promise<MixedRead> => ({ kind: "daily", r: await t() }),
    ),
    ...monthlyTasks.map(
      (t) => async (): Promise<MixedRead> => ({
        kind: "monthly",
        r: await t(),
      }),
    ),
  ];
  const results = await runWithConcurrency(mixed, READ_CONCURRENCY);

  const totals = newCounters();
  const pathTotals = new Map<string, SummaryCounters>();
  const referrerTotals = new Map<string, SummaryCounters>();
  const countryTotals = new Map<string, SummaryCounters>();
  const device = { mobile: 0, desktop: 0, botMobile: 0, botDesktop: 0 };

  // Device-dim row accumulator — exactly two rowKeys (mobile, desktop)
  // covering 100% of traffic. Summing gives site-level visitor/session/
  // bounce counts in signal mode; undefined on counter-mode deploys
  // where the rows don't carry those fields.
  const siteSignal: SummaryCounters = newCounters();

  // Per-day totals rebuilt from the path dimension. Indexed by dayList
  // position so the sparkline stays in calendar order regardless of
  // completion order.
  const dayTotals: SummaryCounters[] = dayList.map(() => newCounters());

  for (const res of results) {
    if (res.kind === "daily") {
      const { dim, rows, dayIndex } = res.r;
      if (dim === "path") {
        for (const row of rows) {
          if (!row.rowKey) continue;
          const path = decodePathRowKey(row.rowKey);
          const entry = pathTotals.get(path) ?? newCounters();
          addCounters(entry, row);
          pathTotals.set(path, entry);
          addCounters(dayTotals[dayIndex], row);
        }
      } else if (dim === "referrer") {
        for (const row of rows) {
          addReferrer(referrerTotals, row);
        }
      } else if (dim === "device") {
        for (const row of rows) {
          addDevice(device, row);
          addCounters(siteSignal, row);
        }
      } else {
        for (const row of rows) {
          addCountry(countryTotals, row);
        }
      }
    } else {
      const { dim, rows } = res.r;
      if (dim === "referrer") {
        for (const row of rows) addReferrer(referrerTotals, row);
      } else if (dim === "device") {
        for (const row of rows) {
          addDevice(device, row);
          addCounters(siteSignal, row);
        }
      } else {
        for (const row of rows) addCountry(countryTotals, row);
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

  // Site-level signal counters from the device-dim sum. Only surface
  // them when they're non-zero so counter-mode deploys don't render
  // misleading `visitors: 0` tiles.
  if ((siteSignal.sessions ?? 0) > 0) {
    totals.visitors = siteSignal.visitors;
    totals.sessions = siteSignal.sessions;
    totals.bounces = siteSignal.bounces;
  }

  const countryEntries = Array.from(countryTotals.entries(), ([country, c]) => ({
    country,
    ...c,
  }));
  countryEntries.sort(
    (a, b) => b.pageviews + b.notFounds - (a.pageviews + a.notFounds),
  );
  const topCountries = countryEntries.length
    ? countryEntries.slice(0, TOP_N)
    : undefined;

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
    topCountries,
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
