import type { HttpRequest } from "@azure/functions";

/**
 * Extract the client IP from the incoming request headers.
 *
 * Azure Front Door / SWA prepends the real client IP to `x-forwarded-for`
 * on the way through. `x-azure-clientip` is a fallback for proxy paths
 * that surface only that header. Returns `null` when neither header is
 * present — the caller stores `visitorHash: null` rather than fabricate
 * an input.
 *
 * The returned string is only ever used to update a sha256 hash inside
 * the collect handler. It must never be logged, never persisted, and
 * must drop out of scope as soon as the hash is computed.
 */
export function extractClientIp(req: HttpRequest): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const leftmost = xff.split(",")[0]?.trim();
    if (leftmost) return normalize(leftmost);
  }
  const azure = req.headers.get("x-azure-clientip");
  if (azure) {
    const trimmed = azure.trim();
    if (trimmed) return normalize(trimmed);
  }
  return null;
}

/**
 * Lowercase, strip IPv6 zone identifiers (`%eth0`), strip bracketed
 * IPv6 literals (`[::1]` → `::1`), and drop any trailing port. No
 * `::ffff:` unwrapping — a v4 address reaching XFF via v6 is still a
 * distinct observation and shouldn't be canonicalized across families.
 */
function normalize(raw: string): string {
  let ip = raw.toLowerCase();
  if (ip.startsWith("[")) {
    const end = ip.indexOf("]");
    if (end > 0) ip = ip.slice(1, end);
  } else if (ip.includes(".")) {
    // IPv4 with optional ":port". IPv6 without brackets is ambiguous
    // (contains colons by design), so only strip a port on v4.
    const colon = ip.indexOf(":");
    if (colon >= 0) ip = ip.slice(0, colon);
  }
  const zone = ip.indexOf("%");
  if (zone >= 0) ip = ip.slice(0, zone);
  return ip;
}
