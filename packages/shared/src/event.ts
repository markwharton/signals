import { ulid } from "ulid";

/** Current wire-format version. Bump if the CollectRequest shape changes. */
export const EVENT_VERSION = 1 as const;

/** Fields present on every stored event. */
export interface BaseStoredEvent {
  v: 1;
  kind: string;
  site: string;
  /** ISO 8601 UTC timestamp, set server-side on receipt. */
  ts: string;
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

/** Wire format — what the beacon POSTs to /api/collect. */
export interface CollectRequest {
  v: 1;
  kind: "pageview" | "404";
  site: string;
  path: string;
  referrerHost: string | null;
  isMobile: boolean;
}

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
