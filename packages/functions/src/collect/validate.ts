import type {
  CollectRequest,
  CollectRequestV1,
  CollectRequestV2,
} from "@signals/shared";

/**
 * Parse and discriminant-validate a raw `/api/collect` body.
 *
 * Returns the typed request union on success or `null` on any structural
 * failure — the handler then responds 400 without disclosing which check
 * failed. The `v` field picks the validator; both `v: 1` (counter mode)
 * and `v: 2` (signal mode) are accepted at the wire level. Whether a
 * given version is *honoured* on a particular deployment is a separate
 * decision that the handler makes after parsing using `SIGNALS_MODE`.
 */
export function parseCollectRequest(raw: string): CollectRequest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (isCollectRequestV1(parsed)) return parsed;
  if (isCollectRequestV2(parsed)) return parsed;
  return null;
}

function hasCommonCollectFields(x: unknown): x is Record<string, unknown> {
  if (typeof x !== "object" || x === null) return false;
  const r = x as Record<string, unknown>;
  if (r.kind !== "pageview" && r.kind !== "404") return false;
  if (typeof r.site !== "string" || r.site.length === 0) return false;
  if (typeof r.path !== "string" || r.path.length === 0) return false;
  if (r.referrerHost !== null && typeof r.referrerHost !== "string") {
    return false;
  }
  if (typeof r.isMobile !== "boolean") return false;
  if (r.isBot !== undefined && typeof r.isBot !== "boolean") return false;
  return true;
}

export function isCollectRequestV1(x: unknown): x is CollectRequestV1 {
  if (!hasCommonCollectFields(x)) return false;
  const r = x as Record<string, unknown>;
  return r.v === 1;
}

export function isCollectRequestV2(x: unknown): x is CollectRequestV2 {
  if (!hasCommonCollectFields(x)) return false;
  const r = x as Record<string, unknown>;
  if (r.v !== 2) return false;
  if (r.screen !== undefined && r.screen !== null) {
    if (typeof r.screen !== "object") return false;
    const s = r.screen as Record<string, unknown>;
    if (typeof s.w !== "number" || typeof s.h !== "number") return false;
  }
  if (
    r.lang !== undefined &&
    r.lang !== null &&
    typeof r.lang !== "string"
  ) {
    return false;
  }
  if (r.tz !== undefined && r.tz !== null && typeof r.tz !== "string") {
    return false;
  }
  return true;
}
