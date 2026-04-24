import { createHash, randomBytes } from "node:crypto";
import { RestError } from "@azure/data-tables";
import { TABLE_SALTS, getTableClient } from "./tables.js";

interface SaltCacheEntry {
  ymd: string;
  salt: Buffer;
}

/**
 * Per-instance cache: one Azure Tables round-trip per site per UTC day
 * per warm instance. Signal-mode is read-mostly once today's row
 * exists.
 */
const cache = new Map<string, SaltCacheEntry>();

interface SaltEntity {
  value: string;
  createdAt: string;
}

/**
 * Return today's 32-byte salt for a site, minting a new row in the
 * `salts` table on the first collect of the day.
 *
 * Race semantics: `createEntity` is atomic — on duplicate the SDK
 * surfaces a 409. The first instance to hit the table wins; later
 * instances catch the 409, read the winner's value, and reuse it. No
 * ETag gymnastics required.
 *
 * "Rotation" is implicit: a different `rowKey` (yyyymmdd, UTC) each
 * day. Yesterday's salt is deleted by the daily rollup job's GC step
 * ~48h after the visit, at which point that day's visitor hashes are
 * cryptographically orphaned.
 */
export async function getTodaySalt(site: string, now: Date): Promise<Buffer> {
  const ymd = ymdUTC(now);
  const cached = cache.get(site);
  if (cached && cached.ymd === ymd) return cached.salt;

  const client = getTableClient(TABLE_SALTS);
  const fresh = randomBytes(32);

  try {
    await client.createEntity({
      partitionKey: site,
      rowKey: ymd,
      value: fresh.toString("hex"),
      createdAt: now.toISOString(),
    });
    cache.set(site, { ymd, salt: fresh });
    return fresh;
  } catch (err) {
    if (!(err instanceof RestError) || err.statusCode !== 409) throw err;
  }

  const existing = await client.getEntity<SaltEntity>(site, ymd);
  if (typeof existing.value !== "string" || existing.value.length === 0) {
    throw new Error(`salt row ${site}/${ymd} is missing a value column`);
  }
  const salt = Buffer.from(existing.value, "hex");
  cache.set(site, { ymd, salt });
  return salt;
}

/**
 * Compute a visitor hash: `sha256(salt ‖ ip ‖ ua ‖ site)` with null
 * delimiters between fields. The null byte can't appear inside any of
 * the field values (IPs have dots/colons, UAs are printable ASCII,
 * site names are DNS labels), so there's no collision risk from a
 * field containing another field's separator.
 */
export function hashVisitor(
  salt: Buffer,
  ip: string,
  ua: string,
  site: string,
): string {
  const h = createHash("sha256");
  h.update(salt);
  h.update("\0");
  h.update(ip);
  h.update("\0");
  h.update(ua);
  h.update("\0");
  h.update(site);
  return h.digest("hex");
}

function ymdUTC(now: Date): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}
