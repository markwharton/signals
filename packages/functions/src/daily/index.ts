import type { TableClient } from "@azure/data-tables";
import type {
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { app } from "@azure/functions";
import type { RollupDimension } from "@signals/shared";
import {
  deviceRowKey,
  pathRowKey,
  pathxReferrerRowKey,
  referrerRowKey,
  rollupPartitionKey,
} from "@signals/shared";
import { validateApiKey } from "../shared/apiKey.js";
import { TABLE_EVENTS, TABLE_ROLLUPS, getTableClient } from "../shared/tables.js";

// HTTP-triggered; a Logic App POSTs here at 17:00 UTC daily with an
// x-api-key header validated against DAILY_API_KEYS. SWA Managed
// Functions support HTTP triggers only, which is why this isn't a
// native timer. Logic App's recurrence engine stands in for the
// missing timer trigger.

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

    const site = process.env.SIGNALS_SITE_ID;
    if (!site) {
      ctx.error("daily: SIGNALS_SITE_ID not set");
      return { status: 500 };
    }

    const now = new Date();
    const target = utcDaysAgo(now, 1);
    const targetYmd = yyyymmdd(target);

    ctx.log(`daily: rolling up ${site} ${targetYmd} (source=${sourceId})`);

    const events = getTableClient(TABLE_EVENTS);
    const rollups = getTableClient(TABLE_ROLLUPS);

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

    const cleanupTarget = utcDaysAgo(now, RAW_RETENTION_DAYS + 1);
    const cleanupYmd = yyyymmdd(cleanupTarget);
    let deleted = 0;
    for (let h = 0; h < 24; h++) {
      const pk = `${site}_${cleanupYmd}_${String(h).padStart(2, "0")}`;
      deleted += await deletePartition(events, pk);
    }
    ctx.log(`daily: deleted ${deleted} raw event(s) from ${cleanupYmd}`);
    ctx.log("daily: complete");

    return {
      status: 200,
      jsonBody: {
        date: targetYmd,
        events: eventCount,
        rollupRows: {
          path: pathRows,
          referrer: refRows,
          device: deviceRows,
          pathxreferrer: pathxRefRows,
        },
        rawDeleted: deleted,
      },
    };
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
