import type { TableClient } from "@azure/data-tables";
import type {
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { app } from "@azure/functions";
import type { MonthlyRollupDimension, RollupDimension } from "@signals/shared";
import {
  countryRowKey,
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
import {
  TABLE_EVENTS,
  TABLE_ROLLUPS,
  TABLE_SALTS,
  getTableClient,
} from "../shared/tables.js";

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

const MONTHLY_DIMS: MonthlyRollupDimension[] = [
  "path",
  "referrer",
  "device",
  "country",
];

/**
 * Sessions split on gaps wider than this. 30 minutes is the
 * near-universal convention (GA, Plausible, Fathom). Short enough that
 * "came back after lunch" counts as a new session, long enough that
 * "went to make coffee" doesn't.
 */
const SESSION_GAP_MS = 30 * 60 * 1000;

interface Counts {
  pageviews: number;
  notFounds: number;
  botPageviews: number;
  botNotFounds: number;
  // Signal-mode derived counters — set post-scan from the (visitor, ts)
  // tuples collected during the hour-by-hour read. Undefined on
  // counter-mode deploys because there's no visitorHash to track.
  visitors?: number;
  sessions?: number;
  bounces?: number;
}

/** visitor hash → timestamps seen today for that visitor (unsorted). */
type VisitorTimestamps = Map<string, number[]>;

/** dimension row key → per-visitor timestamp timeline. */
type DimVisitors = Map<string, VisitorTimestamps>;

interface DayResult {
  date: string;
  events: number;
  skipped: boolean;
  rollupRows: {
    path: number;
    referrer: number;
    device: number;
    pathxreferrer: number;
    country: number;
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

function trackVisitor(
  visitors: DimVisitors,
  rowKey: string,
  visitorHash: string,
  tsMs: number,
): void {
  let perVisitor = visitors.get(rowKey);
  if (!perVisitor) {
    perVisitor = new Map();
    visitors.set(rowKey, perVisitor);
  }
  const tss = perVisitor.get(visitorHash);
  if (tss) tss.push(tsMs);
  else perVisitor.set(visitorHash, [tsMs]);
}

/**
 * Split a sorted timestamp list into session sizes (events per
 * session). A gap wider than `SESSION_GAP_MS` starts a new session; an
 * empty input yields no sessions.
 */
function sessionSizes(sortedTss: number[]): number[] {
  if (sortedTss.length === 0) return [];
  const sizes: number[] = [];
  let size = 1;
  let last = sortedTss[0];
  for (let i = 1; i < sortedTss.length; i++) {
    if (sortedTss[i] - last > SESSION_GAP_MS) {
      sizes.push(size);
      size = 1;
    } else {
      size++;
    }
    last = sortedTss[i];
  }
  sizes.push(size);
  return sizes;
}

/**
 * Derive visitor/session/bounce counts from a dimension's per-visitor
 * timestamp timelines. Visitors = distinct hash count; sessions =
 * total sessions across all visitors; bounces = sessions with exactly
 * one event.
 *
 * Cross-day session stitching is intentionally absent — the daily salt
 * rotates at 00:00 UTC, so yesterday's visitor hash and today's are
 * disjoint by construction. A visitor crossing midnight ends up as two
 * visitors with one session each. That's the privacy-over-fidelity
 * trade the design signs up for.
 */
function applySessionCounters(
  counts: Map<string, Counts>,
  visitors: DimVisitors,
): void {
  for (const [rowKey, perVisitor] of visitors) {
    const c = counts.get(rowKey);
    if (!c) continue;
    let totalSessions = 0;
    let totalBounces = 0;
    for (const tss of perVisitor.values()) {
      tss.sort((a, b) => a - b);
      const sizes = sessionSizes(tss);
      totalSessions += sizes.length;
      for (const size of sizes) {
        if (size === 1) totalBounces++;
      }
    }
    c.visitors = perVisitor.size;
    c.sessions = totalSessions;
    c.bounces = totalBounces;
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
    const salts = getTableClient(TABLE_SALTS);

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
    let saltsDeleted = 0;
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
      saltsDeleted = await cleanupSalts(salts, now, ctx);
    }

    ctx.log("daily: complete");

    return {
      status: 200,
      jsonBody: {
        sites: results,
        rawDeleted: deleted,
        cleanupDate: cleanupYmd,
        saltsDeleted,
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
  const countryCounts = new Map<string, Counts>();

  // Per-dimension visitor timelines — accumulated during the scan and
  // then folded into visitors/sessions/bounces counters post-scan.
  // Only `device` and `country` carry session counts in v1; per-path
  // sessions are deferred to avoid the "which path does a multi-path
  // session belong to" ambiguity.
  const deviceVisitors: DimVisitors = new Map();
  const countryVisitors: DimVisitors = new Map();

  let eventCount = 0;

  for (let h = 0; h < 24; h++) {
    const pk = `${site}_${targetYmd}_${String(h).padStart(2, "0")}`;
    const iter = events.listEntities<{
      kind?: string;
      path?: string;
      referrerHost?: string | null;
      isMobile?: boolean;
      isBot?: boolean;
      visitorHash?: string | null;
      country?: string | null;
      ts?: string;
    }>({ queryOptions: { filter: `PartitionKey eq '${pk}'` } });

    for await (const e of iter) {
      eventCount++;
      const kind = e.kind ?? "pageview";
      const isBot = e.isBot ?? false;
      const path = e.path ?? "";
      const ref = e.referrerHost ?? null;
      const isMobile = e.isMobile ?? false;
      const country = e.country ?? null;
      const visitorHash = e.visitorHash ?? null;

      if (path) {
        incr(pathCounts, pathRowKey(path), kind, isBot);
        incr(pathxRefCounts, pathxReferrerRowKey(path, ref), kind, isBot);
      }
      incr(refCounts, referrerRowKey(ref), kind, isBot);
      incr(deviceCounts, deviceRowKey(isMobile), kind, isBot);
      incr(countryCounts, countryRowKey(country), kind, isBot);

      // Only non-bot events with a visitor hash contribute to
      // visitor/session/bounce counts. Bots aren't "visitors"; rows
      // without a hash (counter-mode history, or signal-mode events
      // with a missing IP/UA hop) aren't attributable to a visitor.
      if (!isBot && visitorHash && e.ts) {
        const tsMs = Date.parse(e.ts);
        if (!Number.isNaN(tsMs)) {
          trackVisitor(
            deviceVisitors,
            deviceRowKey(isMobile),
            visitorHash,
            tsMs,
          );
          trackVisitor(
            countryVisitors,
            countryRowKey(country),
            visitorHash,
            tsMs,
          );
        }
      }
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
      rollupRows: {
        path: 0,
        referrer: 0,
        device: 0,
        pathxreferrer: 0,
        country: 0,
      },
    };
  }

  applySessionCounters(deviceCounts, deviceVisitors);
  applySessionCounters(countryCounts, countryVisitors);

  const [pathRows, refRows, deviceRows, pathxRefRows, countryRows] =
    await Promise.all([
      upsertDimension(rollups, site, target, "path", pathCounts),
      upsertDimension(rollups, site, target, "referrer", refCounts),
      upsertDimension(rollups, site, target, "device", deviceCounts),
      upsertDimension(rollups, site, target, "pathxreferrer", pathxRefCounts),
      upsertDimension(rollups, site, target, "country", countryCounts),
    ]);

  ctx.log(
    `daily: ${targetYmd} rollup rows written — path=${pathRows} ` +
      `referrer=${refRows} device=${deviceRows} pathxreferrer=${pathxRefRows} ` +
      `country=${countryRows}`,
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
      country: countryRows,
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
    await rollups.upsertEntity(rollupEntity(partitionKey, rowKey, c), "Replace");
    written++;
  }
  return written;
}

interface RollupEntity {
  partitionKey: string;
  rowKey: string;
  pageviews: number;
  notFounds: number;
  botPageviews: number;
  botNotFounds: number;
  visitors?: number;
  sessions?: number;
  bounces?: number;
}

/**
 * Build the Table Storage entity for a rollup row. Core counters are
 * always present; signal-mode derived counters (`visitors`, `sessions`,
 * `bounces`) are only included when set, so counter-mode rows don't
 * carry a wall of zero columns.
 */
function rollupEntity(
  partitionKey: string,
  rowKey: string,
  c: Counts,
): RollupEntity {
  const entity: RollupEntity = {
    partitionKey,
    rowKey,
    pageviews: c.pageviews,
    notFounds: c.notFounds,
    botPageviews: c.botPageviews,
    botNotFounds: c.botNotFounds,
  };
  if (c.visitors !== undefined) entity.visitors = c.visitors;
  if (c.sessions !== undefined) entity.sessions = c.sessions;
  if (c.bounces !== undefined) entity.bounces = c.bounces;
  return entity;
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
          visitors?: number;
          sessions?: number;
          bounces?: number;
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
              visitors: row.visitors,
              sessions: row.sessions,
              bounces: row.bounces,
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
    country: new Map(),
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
      // Monthly aggregation sums visitors/sessions/bounces across days.
      // Because each day has a disjoint visitor-hash namespace (daily
      // salt rotation), a visitor seen on day 1 and day 2 is two
      // visitors in the monthly view — the sum is the right shape for
      // the "visits per month" intuition the design can honestly
      // support.
      if (r.counts.visitors !== undefined) {
        c.visitors = (c.visitors ?? 0) + r.counts.visitors;
      }
      if (r.counts.sessions !== undefined) {
        c.sessions = (c.sessions ?? 0) + r.counts.sessions;
      }
      if (r.counts.bounces !== undefined) {
        c.bounces = (c.bounces ?? 0) + r.counts.bounces;
      }
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
        await rollups.upsertEntity(rollupEntity(mpk, rowKey, counts), "Replace");
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

/**
 * Delete salt rows older than 2 UTC days. Today's salt stays live;
 * yesterday's is kept so late-arriving events from the previous day
 * can still be hashed consistently during the brief overlap window.
 * Anything earlier is cryptographically unneeded — the events hashed
 * against those salts have been rolled up and the hashes are now
 * orphaned, which is the design's privacy guarantee.
 *
 * Row keys are yyyymmdd strings which sort lexically the same way they
 * sort chronologically, so a single `RowKey lt` filter handles the
 * whole range in one query.
 */
async function cleanupSalts(
  salts: TableClient,
  now: Date,
  ctx: InvocationContext,
): Promise<number> {
  const cutoff = utcDaysAgo(now, 2);
  const cutoffYmd = yyyymmdd(cutoff);
  let deleted = 0;
  const iter = salts.listEntities({
    queryOptions: { filter: `RowKey lt '${cutoffYmd}'` },
  });
  for await (const row of iter) {
    if (row.partitionKey && row.rowKey) {
      await salts.deleteEntity(row.partitionKey, row.rowKey);
      deleted++;
    }
  }
  ctx.log(`daily: salt GC deleted ${deleted} row(s) older than ${cutoffYmd}`);
  return deleted;
}
