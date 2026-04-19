import { createHash, timingSafeEqual } from "node:crypto";

interface KeyEntry {
  sourceId: string;
  hash: Buffer;
}

function parseEntries(envValue: string): KeyEntry[] {
  if (!envValue) return [];
  return envValue.split(",").map((raw) => {
    const [sourceId, algo, hex] = raw.split(":");
    if (algo !== "sha256" || !hex) {
      throw new Error(`Invalid key entry: ${sourceId}`);
    }
    return { sourceId, hash: Buffer.from(hex, "hex") };
  });
}

/**
 * Validate an incoming raw API key against the hashed entries in an env var.
 * Returns the source-id when a match is found, null otherwise.
 *
 * Env-var format: comma-separated `{sourceId}:sha256:{hex}` entries — supports
 * multiple keys per source for zero-downtime rotation.
 */
export function validateApiKey(
  envVarName: string,
  incomingKey: string | null | undefined,
): string | null {
  if (!incomingKey) return null;
  const entries = parseEntries(process.env[envVarName] ?? "");
  const incoming = createHash("sha256").update(incomingKey).digest();
  for (const entry of entries) {
    if (
      entry.hash.length === incoming.length &&
      timingSafeEqual(entry.hash, incoming)
    ) {
      return entry.sourceId;
    }
  }
  return null;
}
