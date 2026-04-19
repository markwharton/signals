import type { HttpRequest, HttpResponseInit } from "@azure/functions";
import { app } from "@azure/functions";
import type { CollectRequest } from "@signals/shared";
import {
  eventPartitionKey,
  eventRowKey,
  normalizePath,
} from "@signals/shared";
import { checkRateLimit } from "../shared/rateLimit.js";
import { TABLE_EVENTS, getTableClient } from "../shared/tables.js";

app.http("collect", {
  route: "collect",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (req, ctx): Promise<HttpResponseInit> => {
    try {
      const rate = await checkRateLimit(req);
      if (!rate.allowed) {
        return {
          status: 429,
          headers: rate.retryAfterSeconds
            ? { "retry-after": String(rate.retryAfterSeconds) }
            : undefined,
        };
      }

      const raw = await readBody(req);
      const request = raw !== null ? parseCollectRequest(raw) : null;
      if (!request) {
        ctx.warn("collect: invalid or unparseable body");
        return { status: 400 };
      }

      const expectedSite = process.env.SIGNALS_SITE_ID;
      if (expectedSite && request.site !== expectedSite) {
        ctx.warn(
          `collect: site mismatch (got "${request.site}", expected "${expectedSite}")`,
        );
        return { status: 400 };
      }

      const now = new Date();
      const entity = {
        partitionKey: eventPartitionKey(request.site, now),
        rowKey: eventRowKey(),
        v: request.v,
        kind: request.kind,
        site: request.site,
        path: normalizePath(request.path),
        referrerHost: request.referrerHost,
        isMobile: request.isMobile,
        ts: now.toISOString(),
      };

      await getTableClient(TABLE_EVENTS).createEntity(entity);
      return { status: 204 };
    } catch (err) {
      ctx.error("collect: handler failed", err);
      throw err;
    }
  },
});

async function readBody(req: HttpRequest): Promise<string | null> {
  try {
    return await req.text();
  } catch {
    return null;
  }
}

function parseCollectRequest(raw: string): CollectRequest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isCollectRequest(parsed)) return null;
  return parsed;
}

function isCollectRequest(x: unknown): x is CollectRequest {
  if (typeof x !== "object" || x === null) return false;
  const r = x as Record<string, unknown>;
  if (r.v !== 1) return false;
  if (r.kind !== "pageview") return false;
  if (typeof r.site !== "string" || r.site.length === 0) return false;
  if (typeof r.path !== "string" || r.path.length === 0) return false;
  if (r.referrerHost !== null && typeof r.referrerHost !== "string") {
    return false;
  }
  if (typeof r.isMobile !== "boolean") return false;
  return true;
}
