import type { TableClient } from "@azure/data-tables";
import type { InvocationContext, Timer } from "@azure/functions";
import { app } from "@azure/functions";
import type { RollupDimension } from "@signals/shared";
import {
  deviceRowKey,
  pathRowKey,
  pathxReferrerRowKey,
  referrerRowKey,
  rollupPartitionKey,
} from "@signals/shared";
import { TABLE_EVENTS, TABLE_ROLLUPS, getTableClient } from "../shared/tables.js";

// Events are kept on the raw table for this many days after rollup so the
// rollup logic can be re-run if a bug surfaces early. After the window,
// the partition for day-(N+1) is deleted on each run so storage doesn't
// grow unbounded.
const RAW_RETENTION_DAYS = 7;

interface Counts {
  pageviews: number;
  notFounds: number;
  botPageviews: number;
  botNotFounds: number;
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

app.timer("daily", {
  // Six-field CRON: sec min hour day mo dow. 17:00 UTC = 03:00 Brisbane
  // next day (Queensland is UTC+10 year-round, no DST). By 17:00 UTC the
  // previous UTC day is definitively closed, so yesterday's partitions
  // contain no late arrivals.
  schedule: "0 0 17 * * *",
  handler: async (timer: Timer, ctx: InvocationContext): Promise<void> => {
    const site = process.env.SIGNALS_SITE_ID;
    if (!site) {
      ctx.error("daily: SIGNALS_SITE_ID is not set; aborting");
      return;
    }

    const now = new Date();
    const target = utcDaysAgo(now, 1);
    const targetYmd = yyyymmdd(target);

    ctx.log(
      `daily: rolling up ${site} ${targetYmd} (isPastDue=${timer.isPastDue})`,
    );

    const events = getTableClient(TABLE_EVENTS);
    const rollups = getTableClient(TABLE_ROLLUPS);

    // In-memory counters. Map keys are pre-computed row keys so writing to
    // Azure Tables is a straight pass-through — no second round of encoding.
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

    ctx.log(`daily: aggregated ${eventCount} event(s)`);

    const [pathRows, refRows, deviceRows, pathxRefRows] = await Promise.all([
      upsertDimension(rollups, site, target, "path", pathCounts),
      upsertDimension(rollups, site, target, "referrer", refCounts),
      upsertDimension(rollups, site, target, "device", deviceCounts),
      upsertDimension(rollups, site, target, "pathxreferrer", pathxRefCounts),
    ]);

    ctx.log(
      `daily: rollup rows written — path=${pathRows} referrer=${refRows} ` +
        `device=${deviceRows} pathxreferrer=${pathxRefRows}`,
    );

    // Retention sweep: drop the single partition that just fell outside the
    // retention window. Steady-state this deletes one UTC day's raw
    // partitions per run; if the function hasn't run for a while, older
    // days stay until caught up manually. Idempotent — deleting an
    // already-empty partition is a no-op.
    const cleanupTarget = utcDaysAgo(now, RAW_RETENTION_DAYS + 1);
    const cleanupYmd = yyyymmdd(cleanupTarget);
    let deleted = 0;
    for (let h = 0; h < 24; h++) {
      const pk = `${site}_${cleanupYmd}_${String(h).padStart(2, "0")}`;
      deleted += await deletePartition(events, pk);
    }
    ctx.log(`daily: deleted ${deleted} raw event(s) from ${cleanupYmd}`);
    ctx.log("daily: complete");
  },
});

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
    // InsertOrReplace — re-running for the same date overwrites with the
    // same numbers, keeping retries / manual re-runs idempotent.
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
