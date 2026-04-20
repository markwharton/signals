/**
 * Rollup schema — one row per (dimension, value, UTC day).
 *
 * All rollups live in the `rollups` table. The dimension is baked into the
 * partition key (e.g. `plankit.com_20260420_path`) so a single partition
 * query returns every value for that dimension on that day.
 *
 * Each row carries four counter columns: `pageviews`, `notFounds`,
 * `botPageviews`, `botNotFounds`. Non-bot and bot counts are split so a
 * reader can answer "real traffic" and "how much are we filtering" from
 * the same row without a second query. The `isBot` discriminator comes
 * from the wire (beacon-derived via isbot), not from a rollup-time
 * decision.
 *
 * Azure Tables RowKey restrictions: `/`, `\`, `#`, `?`, and control
 * characters are forbidden. Paths always start with `/`, so path-bearing
 * row keys are URL-encoded on write and decoded on read.
 */

export type RollupDimension =
  | "path"
  | "referrer"
  | "device"
  | "pathxreferrer";

/**
 * Literal used in place of a null `referrerHost` — readable in the portal,
 * sorts naturally, can't collide with a real hostname (parentheses are
 * invalid in DNS). Inherits the wire-format conflation of typed-URL and
 * referrer-stripped traffic; distinguishing the two would require a new
 * wire field, not a rollup-time change.
 */
export const DIRECT_SENTINEL = "(direct)";

/** The stored rollup shape — kind × bot counts on every row. */
export interface RollupRow {
  partitionKey: string;
  rowKey: string;
  pageviews: number;
  notFounds: number;
  botPageviews: number;
  botNotFounds: number;
}

/** Build a rollup partition key. UTC. */
export function rollupPartitionKey(
  site: string,
  date: Date,
  dimension: RollupDimension,
): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${site}_${y}${m}${d}_${dimension}`;
}

/** URL-encode the path so it can live in a row key (paths contain `/`). */
export function pathRowKey(path: string): string {
  return encodeURIComponent(path);
}

/** Reverse of pathRowKey — decode on read. */
export function decodePathRowKey(encoded: string): string {
  return decodeURIComponent(encoded);
}

/** Canonical rowKey for the referrer dimension. */
export function referrerRowKey(referrerHost: string | null): string {
  return referrerHost ?? DIRECT_SENTINEL;
}

/** Canonical device label. */
export function deviceRowKey(isMobile: boolean): string {
  return isMobile ? "mobile" : "desktop";
}

/**
 * Composite rowKey for the path × referrer rollup. Path is URL-encoded
 * first (so its slashes don't violate Azure Tables rules), then joined
 * with a `|` separator to the referrer (or DIRECT_SENTINEL). URL encoding
 * never produces `|`, so the separator stays unambiguous.
 */
export function pathxReferrerRowKey(
  path: string,
  referrerHost: string | null,
): string {
  return `${encodeURIComponent(path)}|${referrerHost ?? DIRECT_SENTINEL}`;
}
