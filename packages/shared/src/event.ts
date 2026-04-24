import { ulid } from "ulid";

/** Counter-mode wire-format version. */
export const EVENT_VERSION = 1 as const;

/** Signal-mode wire-format version. */
export const EVENT_VERSION_SIGNAL = 2 as const;

/**
 * Fields present on every stored event.
 *
 * Signal-mode-only columns (`visitorHash`, `country`, `screenW`, `screenH`,
 * `lang`, `tz`) are optional on the stored shape so one type covers both
 * counter-mode and signal-mode deployments. Counter-mode deploys leave
 * them undefined; signal-mode deploys populate them at `/api/collect`.
 */
export interface BaseStoredEvent {
  v: 1 | 2;
  kind: string;
  site: string;
  /** ISO 8601 UTC timestamp, set server-side on receipt. */
  ts: string;
  /** True when the beacon's isbot check flagged this request's UA. Stored
   *  as a concrete boolean on every row so rollups can split non-bot and
   *  bot traffic into distinct counter columns without defaulting at
   *  read time. */
  isBot: boolean;
  /** sha256(salt_today ‖ ip ‖ ua ‖ site) hex digest. `null` when the
   *  request had no usable IP header. Only populated on signal-mode
   *  deploys. The salt row is deleted ~48h after the visit, after which
   *  this value is cryptographically orphaned. */
  visitorHash?: string | null;
  /** ISO 3166-1 alpha-2 country from a GeoLite2 lookup on the request
   *  IP. `null` when the lookup missed (private IP, unmapped range, or
   *  MMDB unavailable). Never derived from `Accept-Language`. */
  country?: string | null;
  /** Browser-reported screen pixel dimensions, flattened from the wire
   *  `screen: { w, h }` shape. */
  screenW?: number | null;
  screenH?: number | null;
  /** `navigator.language` at collection time. */
  lang?: string | null;
  /** IANA tz database name from `Intl.DateTimeFormat().resolvedOptions()`. */
  tz?: string | null;
}

/** A pageview — a successfully served page. */
export interface PageviewEvent extends BaseStoredEvent {
  kind: "pageview";
  path: string;
  referrerHost: string | null;
  isMobile: boolean;
}

/**
 * A soft-404 view. GitHub Pages (and similar static hosts) serve the 404
 * document with the URL bar still showing the attempted path, so `path`
 * here is the attempted path — not the 404 page's own URL. Emitted when
 * the embedded beacon tag has `data-kind="404"`, which in practice lives
 * only on the site's 404.html.
 */
export interface NotFoundEvent extends BaseStoredEvent {
  kind: "404";
  path: string;
  referrerHost: string | null;
  isMobile: boolean;
}

/** Union of all stored event kinds. Extend as new kinds land. */
export type Event = PageviewEvent | NotFoundEvent;

/** Counter-mode wire format — what a `data-mode="counter"` beacon POSTs.
 *
 *  `isBot` is optional during the beacon-cache transition window after
 *  adding the field: old cached beacons don't emit it. The server
 *  defaults missing to `false` when writing the stored entity, so every
 *  stored row carries a concrete boolean. */
export interface CollectRequestV1 {
  v: 1;
  kind: "pageview" | "404";
  site: string;
  path: string;
  referrerHost: string | null;
  isMobile: boolean;
  isBot?: boolean;
}

/** Signal-mode wire format — what a `data-mode="signal"` beacon POSTs.
 *
 *  Adds optional browser context (`screen`, `lang`, `tz`). The visitor
 *  hash and country are server-derived from the request IP/UA and never
 *  cross the wire from the browser. */
export interface CollectRequestV2 {
  v: 2;
  kind: "pageview" | "404";
  site: string;
  path: string;
  referrerHost: string | null;
  isMobile: boolean;
  isBot?: boolean;
  /** Browser-reported screen dimensions, or `null` when unavailable. */
  screen?: { w: number; h: number } | null;
  /** `navigator.language` or `null`. */
  lang?: string | null;
  /** IANA tz database name or `null`. */
  tz?: string | null;
}

export type CollectRequest = CollectRequestV1 | CollectRequestV2;

/**
 * Azure Tables partition key for raw events.
 * Pattern: `{site}_{yyyymmdd}_{hh}` — 24 partitions per day per site, so
 * writes spread across the Azure Tables per-partition cap and per-hour
 * queries + partition-aligned deletes stay cheap.
 */
export function eventPartitionKey(site: string, date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const h = String(date.getUTCHours()).padStart(2, "0");
  return `${site}_${y}${m}${d}_${h}`;
}

/** ULID row key — lexicographically sortable by creation time. */
export function eventRowKey(): string {
  return ulid();
}

/**
 * Normalize a pageview path at the write boundary so every reader
 * trusts the stored form — no re-normalization downstream.
 *
 * Rules: lowercase; strip trailing slashes except on the root path `/`.
 */
export function normalizePath(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower === "/") return "/";
  return lower.replace(/\/+$/, "");
}
