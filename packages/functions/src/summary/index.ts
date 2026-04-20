import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { app } from "@azure/functions";
import type { SummaryCounters, SummaryResponse } from "@signals/shared";
import {
  DIRECT_SENTINEL,
  decodePathRowKey,
  rollupPartitionKey,
} from "@signals/shared";
import { TABLE_ROLLUPS, getTableClient } from "../shared/tables.js";

const TOP_N = 5;

// "all" caps at a year back; if the site has been running longer a future
// migration can raise this or track the earliest-seen day in table state.
const ALL_DAYS = 365;

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

app.http("summary", {
  route: "summary",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (
    req: HttpRequest,
    ctx: InvocationContext,
  ): Promise<HttpResponseInit> => {
    const site = process.env.SIGNALS_SITE_ID;
    if (!site) {
      ctx.error("summary: SIGNALS_SITE_ID not set");
      return { status: 500 };
    }

    const daysRaw = req.query.get("days") ?? "7";
    let days: number;
    if (daysRaw === "7") days = 7;
    else if (daysRaw === "30") days = 30;
    else if (daysRaw === "all") days = ALL_DAYS;
    else {
      return {
        status: 400,
        jsonBody: { error: "days must be 7, 30, or all" },
      };
    }

    // Yesterday is the most recent complete UTC day; earlier days cover
    // the requested window. Today's rollup hasn't been written yet by
    // design — the daily timer runs at 17:00 UTC for the day just ended.
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

    const response: SummaryResponse = {
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

    return { status: 200, jsonBody: response };
  },
});
