import type { TableClient } from "@azure/data-tables";
import type {
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { app } from "@azure/functions";
import type { MonthlyRollupDimension, RollupDimension } from "@signals/shared";
import {
  deviceRowKey,
  pathRowKey,
  pathxReferrerRowKey,
  referrerRowKey,
  rollupMonthlyPartitionKey,
  rollupPartitionKey,
} from "@signals/shared";
import { validateApiKey } from "../shared/apiKey.js";
import { runWithConcurrency } from "../shared/concurrency.js";
import { getAllowedSites } from "../shared/sites.js";
import { TABLE_EVENTS, TABLE_ROLLUPS, getTableClient } from "../shared/tables.js";

// HTTP-triggered; a Logic App POSTs here at 17:00 UTC daily with an
// x-api-key header validated against DAILY_API_KEYS. SWA Managed
// Functions support HTTP triggers only, which is why this isn't a
// native timer. Logic App's recurrence engine stands in for the
// missing timer trigger.
//
// Query params (optional, for manual re-rolls via scripts/rollup.ts):
//   ?date=YYYYMMDD  target end-date (default: yesterday UTC)
//   ?days=N         consecutive days ending at date (default: 1, cap 30)
// Raw-events cleanup only runs on the default invocation (no ?date
// override); manual re-rolls never delete source data.

// 30 days gives a month of re-roll latitude: if the rollup logic
// changes, a bug surfaces, or a test run needs to replay past data,
// the raw events are still in the events table to re-process. Pre-30
// this was 7 days, which bit us during phase-5 testing when we
// wanted to manually replay a window and the events were already
// GC'd. Cost is a few MB of Table Storage at plankit.com volume —
// pennies per month — so the wider safety net is the obvious trade.
const RAW_RETENTION_DAYS = 30;

const MAX_DAYS = 30;

// Cap in-flight reads during monthly rebuild. 3 dims × up to 31 days = 93
// partition queries; 20 in flight is the same budget the summary reader uses.
const MONTHLY_REBUILD_CONCURRENCY = 20;

const MONTHLY_DIMS: MonthlyRollupDimension[] = ["path", "referrer", "device"];

interface Counts {
  pageviews: number;
  notFounds: number;
  botPageviews: number;
  botNotFounds: number;
}

interface DayResult {
  date: string;
  events: number;
  skipped: boolean;
  rollupRows: {
    path: number;
    referrer: number;
    device: number;
    pathxreferrer: number;
  };
}

function newCounts(): Counts {
  return { pageviews: 0, notFounds: 0, botPageviews: 0, botNotFounds: 0 };
}

function incr(
  map: Map<string, Counts>,
  key: string,
  kind: string,
  isBot: boolean,
): void {
  let c = map.get(key);
  if (!c) {
    c = newCounts();
    map.set(key, c);
  }
  if (kind === "pageview") {
    if (isBot) c.botPageviews++;
    else c.pageviews++;
  } else if (kind === "404") {
    if (isBot) c.botNotFounds++;
    else c.notFounds++;
  }
}

function yyyymmdd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function utcDaysAgo(now: Date, days: number): Date {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

function parseYmd(ymd: string): Date | null {
  if (!/^\d{8}$/.test(ymd)) return null;
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(4, 6));
  const d = Number(ymd.slice(6, 8));
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    return null;
  }
  return date;
}

app.http("daily", {
  route: "daily",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (
    req: HttpRequest,
    ctx: InvocationContext,
  ): Promise<HttpResponseInit> => {
    const sourceId = validateApiKey(
      "DAILY_API_KEYS",
      req.headers.get("x-api-key"),
    );
    if (!sourceId) {
      ctx.warn("daily: missing or invalid x-api-key");
      return { status: 401 };
    }

    let allowed: Set<string>;
    try {
      allowed = getAllowedSites();
    } catch (err) {
      ctx.error(`daily: ${(err as Error).message}`);
      return { status: 500 };
    }

    const url = new URL(req.url);
    const dateParam = url.searchParams.get("date");
    const daysParam = url.searchParams.get("days");

    let days = 1;
    if (daysParam) {
      if (!/^\d+$/.test(daysParam)) {
        return { status: 400, jsonBody: { error: "days must be a positive integer" } };
      }
      const parsed = Number(daysParam);
      if (parsed < 1 || parsed > MAX_DAYS) {
        return { status: 400, jsonBody: { error: `days must be 1..${MAX_DAYS}` } };
      }
      days = parsed;
    }

    const now = new Date();
    let endDate: Date;
    if (dateParam) {
      const parsed = parseYmd(dateParam);
      if (!parsed) {
        return { status: 400, jsonBody: { error: "date must be YYYYMMDD" } };
      }
      endDate = parsed;
    } else {
      endDate = utcDaysAgo(now, 1);
    }

    const sites = [...allowed];
    ctx.log(
      `daily: source=${sourceId} sites=[${sites.join(",")}] ` +
        `endDate=${yyyymmdd(endDate)} days=${days}` +
        (dateParam ? " (manual re-roll)" : ""),
    );

    const events = getTableClient(TABLE_EVENTS);
    const rollups = getTableClient(TABLE_ROLLUPS);

    const results: Record<string, DayResult[]> = {};
    for (const site of sites) {
      results[site] = [];
      // yyyymm → one representative date (1st of that month) so the rebuild
      // knows which month to rebuild. Using a Map dedupes re-rolls that all
      // land in the same month down to one rebuild per month per site.
      const affectedMonths = new Map<string, Date>();
      for (let i = days - 1; i >= 0; i--) {
        const target = new Date(endDate);
        target.setUTCDate(target.getUTCDate() - i);
        const res = await rollupDay(events, rollups, site, target, ctx);
        results[site].push(res);
        // Skipped days still flag the month — a re-roll of a past day
        // with no raw events can still warrant a monthly rebuild if
        // something upstream changed. (Cheap: 93 reads, idempotent.)
        const monthKey = `${target.getUTCFullYear()}${String(target.getUTCMonth() + 1).padStart(2, "0")}`;
        if (!affectedMonths.has(monthKey)) {
          affectedMonths.set(
            monthKey,
            new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), 1)),
          );
        }
      }
      for (const month of affectedMonths.values()) {
        await rebuildMonthlyTier(rollups, site, month, ctx);
      }
    }

    // Cleanup only on the default invocation. Manual re-rolls via
    // ?date=... don't trigger retention GC — the caller is targeting
    // a specific historical window and shouldn't cause surprising
    // raw-event deletions elsewhere.
    const deleted: Record<string, number> = {};
    let cleanupYmd: string | null = null;
    if (!dateParam) {
      const cleanupTarget = utcDaysAgo(now, RAW_RETENTION_DAYS + 1);
      cleanupYmd = yyyymmdd(cleanupTarget);
      for (const site of sites) {
        let perSite = 0;
        for (let h = 0; h < 24; h++) {
          const pk = `${site}_${cleanupYmd}_${String(h).padStart(2, "0")}`;
          perSite += await deletePartition(events, pk);
        }
        deleted[site] = perSite;
        ctx.log(
          `daily: deleted ${perSite} raw event(s) from ${cleanupYmd} for ${site}`,
        );
      }
    }

    ctx.log("daily: complete");

    return {
      status: 200,
      jsonBody: {
        sites: results,
        rawDeleted: deleted,
        cleanupDate: cleanupYmd,
      },
    };
  },
});

async function rollupDay(
  events: TableClient,
  rollups: TableClient,
  site: string,
  target: Date,
  ctx: InvocationContext,
): Promise<DayResult> {
  const targetYmd = yyyymmdd(target);
  ctx.log(`daily: rolling up ${site} ${targetYmd}`);

  const pathCounts = new Map<string, Counts>();
  const refCounts = new Map<string, Counts>();
  const deviceCounts = new Map<string, Counts>();
  const pathxRefCounts = new Map<string, Counts>();

  let eventCount = 0;

  for (let h = 0; h < 24; h++) {
    const pk = `${site}_${targetYmd}_${String(h).padStart(2, "0")}`;
    const iter = events.listEntities<{
      kind?: string;
      path?: string;
      referrerHost?: string | null;
      isMobile?: boolean;
      isBot?: boolean;
    }>({ queryOptions: { filter: `PartitionKey eq '${pk}'` } });

    for await (const e of iter) {
      eventCount++;
      const kind = e.kind ?? "pageview";
      const isBot = e.isBot ?? false;
      const path = e.path ?? "";
      const ref = e.referrerHost ?? null;
      const isMobile = e.isMobile ?? false;

      if (path) {
        incr(pathCounts, pathRowKey(path), kind, isBot);
        incr(pathxRefCounts, pathxReferrerRowKey(path, ref), kind, isBot);
      }
      incr(refCounts, referrerRowKey(ref), kind, isBot);
      incr(deviceCounts, deviceRowKey(isMobile), kind, isBot);
    }
  }

  ctx.log(`daily: ${targetYmd} aggregated ${eventCount} event(s)`);

  // Empty-partition skip: if the raw events for this day are gone
  // (past retention) or never existed, leave existing rollup rows
  // untouched. Writing zeros would clobber a previously-good rollup.
  if (eventCount === 0) {
    ctx.log(`daily: ${targetYmd} no events — rollup rows untouched`);
    return {
      date: targetYmd,
      events: 0,
      skipped: true,
      rollupRows: { path: 0, referrer: 0, device: 0, pathxreferrer: 0 },
    };
  }

  const [pathRows, refRows, deviceRows, pathxRefRows] = await Promise.all([
    upsertDimension(rollups, site, target, "path", pathCounts),
    upsertDimension(rollups, site, target, "referrer", refCounts),
    upsertDimension(rollups, site, target, "device", deviceCounts),
    upsertDimension(rollups, site, target, "pathxreferrer", pathxRefCounts),
  ]);

  ctx.log(
    `daily: ${targetYmd} rollup rows written — path=${pathRows} ` +
      `referrer=${refRows} device=${deviceRows} pathxreferrer=${pathxRefRows}`,
  );

  return {
    date: targetYmd,
    events: eventCount,
    skipped: false,
    rollupRows: {
      path: pathRows,
      referrer: refRows,
      device: deviceRows,
      pathxreferrer: pathxRefRows,
    },
  };
}

async function upsertDimension(
  rollups: TableClient,
  site: string,
  date: Date,
  dimension: RollupDimension,
  counts: Map<string, Counts>,
): Promise<number> {
  const partitionKey = rollupPartitionKey(site, date, dimension);
  let written = 0;
  for (const [rowKey, c] of counts) {
    await rollups.upsertEntity(
      {
        partitionKey,
        rowKey,
        pageviews: c.pageviews,
        notFounds: c.notFounds,
        botPageviews: c.botPageviews,
        botNotFounds: c.botNotFounds,
      },
      "Replace",
    );
    written++;
  }
  return written;
}

async function deletePartition(
  client: TableClient,
  partitionKey: string,
): Promise<number> {
  let count = 0;
  const iter = client.listEntities({
    queryOptions: { filter: `PartitionKey eq '${partitionKey}'` },
  });
  for await (const e of iter) {
    if (e.partitionKey && e.rowKey) {
      await client.deleteEntity(e.partitionKey, e.rowKey);
      count++;
    }
  }
  return count;
}

/**
 * Rebuild the three monthly partitions (path, referrer, device) for the UTC
 * month containing `target`. The rebuild reads every daily partition for
 * days 1..last-of-month of that month, re-accumulates counters, upserts the
 * monthly rows, and deletes monthly row keys that no longer appear in the
 * dailies (a path that 404'd on day 3 and then got fixed shouldn't linger).
 *
 * Idempotent and state-free: a re-rolled day correctly propagates, since
 * the whole month is rederived from the daily source of truth each time.
 * Cost is ~93 partition reads plus O(unique-row-keys) writes per invocation
 * — bounded and cheap at signals' volume.
 */
async function rebuildMonthlyTier(
  rollups: TableClient,
  site: string,
  target: Date,
  ctx: InvocationContext,
): Promise<void> {
  const year = target.getUTCFullYear();
  const monthIdx = target.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();
  const monthDates: Date[] = [];
  for (let d = 1; d <= lastDay; d++) {
    monthDates.push(new Date(Date.UTC(year, monthIdx, d)));
  }

  // Fan out: every (day, dim) → daily partition rows.
  interface ReadRow {
    dim: MonthlyRollupDimension;
    rowKey: string;
    counts: Counts;
  }
  const readTasks: Array<() => Promise<ReadRow[]>> = [];
  for (const d of monthDates) {
    for (const dim of MONTHLY_DIMS) {
      const pk = rollupPartitionKey(site, d, dim);
      readTasks.push(async () => {
        const rows: ReadRow[] = [];
        for await (const row of rollups.listEntities<{
          pageviews?: number;
          notFounds?: number;
          botPageviews?: number;
          botNotFounds?: number;
        }>({ queryOptions: { filter: `PartitionKey eq '${pk}'` } })) {
          if (!row.rowKey) continue;
          rows.push({
            dim,
            rowKey: row.rowKey,
            counts: {
              pageviews: row.pageviews ?? 0,
              notFounds: row.notFounds ?? 0,
              botPageviews: row.botPageviews ?? 0,
              botNotFounds: row.botNotFounds ?? 0,
            },
          });
        }
        return rows;
      });
    }
  }

  const dailyBatches = await runWithConcurrency(
    readTasks,
    MONTHLY_REBUILD_CONCURRENCY,
  );

  const perDim: Record<MonthlyRollupDimension, Map<string, Counts>> = {
    path: new Map(),
    referrer: new Map(),
    device: new Map(),
  };
  for (const batch of dailyBatches) {
    for (const r of batch) {
      const map = perDim[r.dim];
      let c = map.get(r.rowKey);
      if (!c) {
        c = newCounts();
        map.set(r.rowKey, c);
      }
      c.pageviews += r.counts.pageviews;
      c.notFounds += r.counts.notFounds;
      c.botPageviews += r.counts.botPageviews;
      c.botNotFounds += r.counts.botNotFounds;
    }
  }

  // For each dim, read current monthly row keys (for orphan detection),
  // upsert the recomputed rows, delete orphans. Reads are parallel across
  // dims; writes per dim run through the same concurrency pool.
  for (const dim of MONTHLY_DIMS) {
    const mpk = rollupMonthlyPartitionKey(site, target, dim);
    const before = new Set<string>();
    for await (const row of rollups.listEntities<{ partitionKey?: string }>({
      queryOptions: { filter: `PartitionKey eq '${mpk}'` },
    })) {
      if (row.rowKey) before.add(row.rowKey);
    }

    const after = perDim[dim];
    const writeTasks: Array<() => Promise<void>> = [];
    for (const [rowKey, counts] of after) {
      writeTasks.push(async () => {
        await rollups.upsertEntity(
          {
            partitionKey: mpk,
            rowKey,
            pageviews: counts.pageviews,
            notFounds: counts.notFounds,
            botPageviews: counts.botPageviews,
            botNotFounds: counts.botNotFounds,
          },
          "Replace",
        );
      });
    }
    for (const rowKey of before) {
      if (!after.has(rowKey)) {
        writeTasks.push(async () => {
          await rollups.deleteEntity(mpk, rowKey);
        });
      }
    }
    await runWithConcurrency(writeTasks, MONTHLY_REBUILD_CONCURRENCY);

    const orphans = Array.from(before).filter((k) => !after.has(k)).length;
    ctx.log(
      `daily: monthly ${mpk} rebuilt — ${after.size} row(s), ${orphans} orphan(s) purged`,
    );
  }
}
