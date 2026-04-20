#!/usr/bin/env npx tsx

/**
 * Force a rollup run by POSTing /api/daily with an optional
 * ?date/?days override. Handy during development to replay a window
 * within the 30-day raw-event retention, or to see "today's" data
 * after a collect without waiting for the 17:00 UTC Logic App firing.
 *
 * Flow:
 *   1. Read DAILY_RAW_KEY from scripts/.env.${ENVIRONMENT}.
 *   2. Autodetect the SWA hostname in rg-signals-${ENVIRONMENT}.
 *   3. POST to https://<host>/api/daily with x-api-key.
 *   4. Pretty-print the JSON body returned by the handler.
 *
 * Usage:
 *   pnpm run rollup                               # yesterday UTC, 1 day
 *   pnpm run rollup -- --date 20260420            # specific day
 *   pnpm run rollup -- --date 20260420 --days 7   # 7 days ending 20260420
 *   ENVIRONMENT=dev pnpm run rollup
 *
 * Cleanup of raw events past retention only happens on the DEFAULT
 * invocation (no --date). Manual re-rolls never delete source data.
 */

import { execSync } from "child_process";
import { readFileSync } from "fs";

const ENVIRONMENT = process.env.ENVIRONMENT ?? "prod";
const RESOURCE_GROUP = `rg-signals-${ENVIRONMENT}`;
const ENV_FILE = `scripts/.env.${ENVIRONMENT}`;

interface Args {
  date?: string;
  days?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  // Tolerate a leading `--` separator passed through by pnpm 10.
  if (argv[0] === "--") argv = argv.slice(1);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--date") {
      args.date = argv[++i];
    } else if (a === "--days") {
      args.days = argv[++i];
    } else if (a === "-h" || a === "--help") {
      console.log(
        "Usage: pnpm run rollup [-- --date YYYYMMDD] [--days N]\n" +
          "  --date  target end-date (default: yesterday UTC)\n" +
          "  --days  consecutive days ending at date (default: 1, cap 30)\n" +
          "  ENVIRONMENT=dev selects rg-signals-dev / scripts/.env.dev",
      );
      process.exit(0);
    } else {
      console.error(`rollup: unknown arg ${a}`);
      process.exit(2);
    }
  }
  return args;
}

function readRawKey(): string {
  let contents: string;
  try {
    contents = readFileSync(ENV_FILE, "utf8");
  } catch {
    console.error(`rollup: ${ENV_FILE} not found`);
    console.error(`Copy scripts/.env.example → ${ENV_FILE} and fill DAILY_RAW_KEY.`);
    process.exit(1);
  }
  const match = contents.match(/^DAILY_RAW_KEY=(.+)$/m);
  if (!match) {
    console.error(`rollup: DAILY_RAW_KEY not set in ${ENV_FILE}`);
    process.exit(1);
  }
  return match[1].trim();
}

function detectHost(): string {
  const output = execSync(
    `az staticwebapp list --resource-group "${RESOURCE_GROUP}" ` +
      `--query "[?starts_with(name, 'stapp-signals-')].defaultHostname" -o tsv`,
    { encoding: "utf8" },
  ).trim();
  const list = output.split("\n").filter(Boolean);
  if (list.length === 0) {
    console.error(
      `rollup: no Static Web App matching 'stapp-signals-*' in ${RESOURCE_GROUP}`,
    );
    process.exit(1);
  }
  if (list.length > 1) {
    console.error("rollup: multiple Static Web Apps found:");
    list.forEach((h) => console.error(`  - ${h}`));
    process.exit(1);
  }
  return list[0];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const rawKey = readRawKey();
  const host = detectHost();

  const params = new URLSearchParams();
  if (args.date) params.set("date", args.date);
  if (args.days) params.set("days", args.days);
  const qs = params.toString();
  const url = `https://${host}/api/daily${qs ? `?${qs}` : ""}`;

  console.log(`POST ${url}`);

  const res = await fetch(url, {
    method: "POST",
    headers: { "x-api-key": rawKey },
  });

  const text = await res.text();
  console.log(`HTTP ${res.status}`);
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    console.log(text);
  }

  if (!res.ok) process.exit(1);
}

main().catch((err) => {
  console.error("rollup:", err);
  process.exit(1);
});
