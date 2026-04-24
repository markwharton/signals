import type { HttpRequest, HttpResponseInit } from "@azure/functions";
import { app } from "@azure/functions";
import type { CollectRequest, CollectRequestV2 } from "@signals/shared";
import {
  eventPartitionKey,
  eventRowKey,
  normalizePath,
} from "@signals/shared";
import { extractClientIp } from "../shared/clientIp.js";
import { checkRateLimit } from "../shared/rateLimit.js";
import { getTodaySalt, hashVisitor } from "../shared/salt.js";
import { getAllowedSites, originMatchesSite } from "../shared/sites.js";
import { TABLE_EVENTS, getTableClient } from "../shared/tables.js";
import { parseCollectRequest } from "./validate.js";

type SignalsMode = "counter" | "signal";

/**
 * Read once at module load. `SIGNALS_MODE` is written by the Bicep SWA
 * deployment from the `signalsMode` parameter. A missing/unknown value
 * falls back to `counter` so a misconfigured deploy stays on the safer
 * privacy envelope rather than accidentally enabling signal-mode
 * hashing.
 */
const SIGNALS_MODE: SignalsMode =
  process.env.SIGNALS_MODE === "signal" ? "signal" : "counter";

/**
 * Throttle the "v1 payload received on a signal-mode deploy" warning to
 * once per cold start. Operators see the signal but logs don't flood
 * when an old cached beacon lingers during rollout.
 */
let warnedV1OnSignal = false;

app.http("collect", {
  route: "collect",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (req, ctx): Promise<HttpResponseInit> => {
    try {
      // Honour Do Not Track / Global Privacy Control before any other
      // work: no rate-limit accounting, no body read, no site lookup.
      // Applies in both counter and signal modes. 204 keeps the beacon
      // path quiet — a fire-and-forget POST shouldn't surface an error.
      if (isOptedOut(req)) {
        return { status: 204 };
      }

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

      let allowed: Set<string>;
      try {
        allowed = getAllowedSites();
      } catch (err) {
        ctx.error(`collect: ${(err as Error).message}`);
        return { status: 500 };
      }
      if (!allowed.has(request.site)) {
        ctx.warn(`collect: site "${request.site}" not in allowlist`);
        return { status: 400 };
      }
      const origin = req.headers.get("origin");
      if (!originMatchesSite(origin, request.site)) {
        ctx.warn(
          `collect: Origin "${origin}" does not match site "${request.site}"`,
        );
        return { status: 400 };
      }

      // Mode gate. v2 requires signal-mode; v1 is tolerated on signal-mode
      // deploys for the beacon-cache rollover window (old cached scripts
      // still send v1 until their max-age expires).
      if (request.v === 2 && SIGNALS_MODE !== "signal") {
        ctx.warn("collect: v2 payload rejected on counter-mode deploy");
        return { status: 400 };
      }
      if (request.v === 1 && SIGNALS_MODE === "signal" && !warnedV1OnSignal) {
        ctx.warn(
          "collect: v1 payload on signal-mode deploy — stale beacon cache;" +
            " visitor/country columns will be empty until the cache rolls over",
        );
        warnedV1OnSignal = true;
      }

      const now = new Date();
      const entity = buildEntity(request, now);

      if (SIGNALS_MODE === "signal") {
        await applyVisitorHash(req, entity, now);
      }

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

/**
 * DNT:1 (legacy) and Sec-GPC:1 (current) both signal that the user has
 * opted out of tracking at the UA level. Either alone is sufficient —
 * the two specs overlap. Values other than "1" (including "0" and
 * missing) mean no opt-out signal was expressed.
 */
function isOptedOut(req: HttpRequest): boolean {
  return (
    req.headers.get("dnt") === "1" || req.headers.get("sec-gpc") === "1"
  );
}

interface EventEntity {
  partitionKey: string;
  rowKey: string;
  v: 1 | 2;
  kind: "pageview" | "404";
  site: string;
  path: string;
  referrerHost: string | null;
  isMobile: boolean;
  isBot: boolean;
  ts: string;
  // Signal-mode columns. v2 wire payloads carry screen/lang/tz from the
  // browser — flattened here so Table Storage primitive columns hold
  // the values directly. `visitorHash` is server-derived from the
  // request IP/UA + today's salt and is `null` when the IP or UA
  // header was missing. `country` lands in commit 3.
  visitorHash?: string | null;
  screenW?: number;
  screenH?: number;
  lang?: string | null;
  tz?: string | null;
}

/**
 * Compute the visitor hash and attach it to the entity. Reads IP and
 * User-Agent from request headers, feeds them into a sha256 with
 * today's salt, and discards both at end-of-block — neither value is
 * logged or persisted anywhere.
 *
 * A missing IP or UA header produces `visitorHash: null` rather than a
 * 400: the event still counts toward pageview totals, it just can't be
 * attributed to a visitor. Fail-fast applies to malformed payload
 * structure, not to an absent optional hop.
 */
async function applyVisitorHash(
  req: HttpRequest,
  entity: EventEntity,
  now: Date,
): Promise<void> {
  const ip = extractClientIp(req);
  const ua = req.headers.get("user-agent");
  if (!ip || !ua) {
    entity.visitorHash = null;
    return;
  }
  const salt = await getTodaySalt(entity.site, now);
  entity.visitorHash = hashVisitor(salt, ip, ua, entity.site);
}

function buildEntity(request: CollectRequest, now: Date): EventEntity {
  const entity: EventEntity = {
    partitionKey: eventPartitionKey(request.site, now),
    rowKey: eventRowKey(),
    v: request.v,
    kind: request.kind,
    site: request.site,
    path: normalizePath(request.path),
    referrerHost: request.referrerHost,
    isMobile: request.isMobile,
    // Default `false` covers the beacon-cache transition window:
    // old cached beacons don't emit `isBot`, and the stored schema
    // requires a concrete boolean so rollups don't have to guess.
    isBot: request.isBot ?? false,
    ts: now.toISOString(),
  };
  if (request.v === 2) applySignalColumns(entity, request);
  return entity;
}

function applySignalColumns(
  entity: EventEntity,
  request: CollectRequestV2,
): void {
  if (request.screen) {
    entity.screenW = request.screen.w;
    entity.screenH = request.screen.h;
  }
  if (request.lang !== undefined) entity.lang = request.lang;
  if (request.tz !== undefined) entity.tz = request.tz;
}
