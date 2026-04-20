import type { HttpRequest } from "@azure/functions";
import { validateApiKey } from "./apiKey.js";

/**
 * The result of admin authentication — which path matched and the
 * opaque identifier for audit log lines. Callers should include the
 * identifier in ctx.log so a request's origin is visible without
 * leaking the principal header or the raw key.
 */
export type AdminAuth =
  | { kind: "principal"; userId: string; userDetails: string }
  | { kind: "apikey"; sourceId: string };

interface ClientPrincipal {
  userId?: string;
  userDetails?: string;
  userRoles?: string[];
  identityProvider?: string;
}

/**
 * Resolve an admin identity for the request, accepting two paths:
 *
 *   1. Browser — SWA forwards the authenticated user's identity as a
 *      base64-encoded JSON blob in x-ms-client-principal. The user is
 *      admin when `userRoles` contains "signals_admin" (underscore,
 *      because Azure's role-name validator forbids dashes).
 *   2. CLI / automation — x-api-key header validated against
 *      ADMIN_API_KEYS using the existing sha256 pattern.
 *
 * Either path returns a concrete identifier; absence of both returns
 * null (caller sends 401).
 */
export function authenticateAdmin(req: HttpRequest): AdminAuth | null {
  const principalHeader = req.headers.get("x-ms-client-principal");
  if (principalHeader) {
    try {
      const decoded = Buffer.from(principalHeader, "base64").toString("utf-8");
      const principal = JSON.parse(decoded) as ClientPrincipal;
      if (principal.userRoles?.includes("signals_admin") && principal.userId) {
        return {
          kind: "principal",
          userId: principal.userId,
          userDetails: principal.userDetails ?? "",
        };
      }
    } catch {
      // Malformed header — fall through to api-key path rather than
      // 401'ing; a CLI caller that also sent a stray principal header
      // shouldn't lose its legitimate key.
    }
  }

  const sourceId = validateApiKey("ADMIN_API_KEYS", req.headers.get("x-api-key"));
  if (sourceId) {
    return { kind: "apikey", sourceId };
  }

  return null;
}

/** Short human-readable audit string for a log line. */
export function describeAuth(auth: AdminAuth): string {
  return auth.kind === "principal"
    ? `principal:${auth.userDetails || auth.userId}`
    : `apikey:${auth.sourceId}`;
}
