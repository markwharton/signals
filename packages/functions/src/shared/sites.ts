// Operator-managed multi-tenant: SIGNALS_SITES holds a comma-separated
// allowlist of sites that may post events / be summarized. Single
// `signals_admin` role still gates everything; auth is unchanged.
//
// Storage partition keys are already site-scoped (`${site}_${ymd}_${hour}`),
// so the data layer is multi-tenant-ready — these helpers just enforce
// the env-driven allowlist at handler boundaries.

/**
 * Parse SIGNALS_SITES into a Set. Throws when the env var is missing
 * or empty — fail-closed by design: a misconfigured deploy must not
 * silently accept any incoming `site` value, which would happily
 * create new storage partitions for whatever any beacon claims.
 */
export function getAllowedSites(): Set<string> {
  const raw = process.env.SIGNALS_SITES;
  if (!raw) {
    throw new Error("SIGNALS_SITES env var not set");
  }
  const sites = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (sites.length === 0) {
    throw new Error("SIGNALS_SITES env var is empty");
  }
  return new Set(sites);
}

/**
 * First site in the allowlist. Used by handlers that don't yet take
 * a `?site=` query param (summary, mcp). Step 2 of the multi-tenant
 * migration adds the param plumbing; until then, single-site deploys
 * see no behavior change because "first site" == "the site".
 */
export function getDefaultSite(): string {
  const sites = getAllowedSites();
  return sites.values().next().value as string;
}

/**
 * Returns true when the request's Origin hostname equals `site` or is
 * a subdomain of it (`*.${site}`). The leading-dot guard prevents
 * `evilplankit.com` from matching `plankit.com`.
 *
 * Lenient when Origin is missing — some browser privacy modes strip
 * it. SIGNALS_SITES allowlist remains the primary defense; this is a
 * secondary check that prevents one allowlisted site from inflating
 * another's stats by embedding the wrong `data-site`.
 */
export function originMatchesSite(
  origin: string | null,
  site: string,
): boolean {
  if (!origin) return true;
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return false;
  }
  return host === site || host.endsWith(`.${site}`);
}
