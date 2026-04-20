#!/usr/bin/env npx tsx

/**
 * Mint a scoped API key for signals endpoints.
 *
 * Raw key format:     pk_{scope}_{64_hex}      — give to the client
 * Hash entry format:  {sourceId}:sha256:{hex}  — append to the comma-separated env var
 *
 * Usage:
 *   pnpm run generate:api-key                           # show usage
 *   pnpm run generate:api-key daily logic-app           # mint a daily key
 *   pnpm run generate:api-key mcp claude-desktop        # mint an mcp key
 *   pnpm run generate:api-key admin sig-cli             # mint an admin key for CLI use
 *
 * A leading `--` separator is tolerated for muscle memory from older pnpm/npm.
 */

import { createHash, randomBytes } from "crypto";

interface ScopeConfig {
  envVar: string;
  endpoint: string;
}

const SCOPES: Record<string, ScopeConfig> = {
  daily: {
    envVar: "DAILY_API_KEYS",
    endpoint: "POST /api/daily",
  },
  mcp: {
    envVar: "MCP_API_KEYS",
    endpoint: "POST /api/mcp",
  },
  admin: {
    envVar: "ADMIN_API_KEYS",
    endpoint: "GET /api/summary (CLI / automation)",
  },
};

function usage(code: number): never {
  console.log("");
  console.log("Usage: pnpm run generate:api-key <scope> <source-id>");
  console.log("");
  console.log("Scopes:");
  for (const [scope, cfg] of Object.entries(SCOPES)) {
    console.log(`  ${scope.padEnd(6)} ${cfg.endpoint.padEnd(18)} env: ${cfg.envVar}`);
  }
  console.log("");
  console.log("Example:");
  console.log("  pnpm run generate:api-key daily logic-app");
  console.log("");
  process.exit(code);
}

// Tolerate a leading `--` separator from older pnpm/npm muscle memory.
const args = process.argv.slice(2);
if (args[0] === "--") args.shift();
const [scope, sourceId] = args;
if (!scope && !sourceId) usage(0);
if (!scope || !sourceId) usage(1);

const cfg = SCOPES[scope];
if (!cfg) {
  console.error(`Unknown scope: ${scope}`);
  usage(1);
}

if (!/^[a-z0-9-]+$/.test(sourceId)) {
  console.error(`source-id must be lowercase letters, digits, or dashes: ${sourceId}`);
  process.exit(1);
}

const rawKey = `pk_${scope}_${randomBytes(32).toString("hex")}`;
const hashHex = createHash("sha256").update(rawKey).digest("hex");
const entry = `${sourceId}:sha256:${hashHex}`;

console.log("");
console.log(`Scope:     ${scope}`);
console.log(`Source ID: ${sourceId}`);
console.log(`Endpoint:  ${cfg.endpoint}`);
console.log("");
console.log("Raw key (give to client — Logic App, Claude, etc):");
console.log(`  ${rawKey}`);
console.log("");
console.log(`Env entry (append to ${cfg.envVar}, comma-separated):`);
console.log(`  ${entry}`);
console.log("");
