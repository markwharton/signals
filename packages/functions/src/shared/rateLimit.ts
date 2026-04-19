import type { HttpRequest } from "@azure/functions";

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

export interface RateLimitOptions {
  /** Bucket discriminator — e.g. an IP /24, a site id, an API source id. */
  bucketId?: string;
  /** Requests per minute ceiling. */
  limit?: number;
}

/**
 * Phase 2: no-op seam. Every public handler calls this so swapping in a real
 * implementation (phase 3, likely a token bucket keyed on bucketId and
 * persisted alongside events in Azure Tables) is a single-file change.
 */
export async function checkRateLimit(
  _req: HttpRequest,
  _options: RateLimitOptions = {},
): Promise<RateLimitResult> {
  return { allowed: true };
}
