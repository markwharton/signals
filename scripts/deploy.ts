#!/usr/bin/env npx tsx

/**
 * Deploy signals dashboard and Managed Functions API to Azure Static
 * Web Apps.
 *
 * Flow:
 *   1. Build shared, beacon (copies to dashboard/public/), dashboard,
 *      functions.
 *   2. Bundle functions with `pnpm deploy --prod --legacy` into out/api
 *      (preserves the original package.json — main, type — that the
 *      newer pnpm 10 deploy strips).
 *   3. Single `swa deploy` uploads the dashboard dist plus the bundled
 *      functions as Managed Functions (one command, same origin).
 *
 * Usage:
 *   pnpm run deploy                  # auto-detect SWA in rg-signals-prod
 *   ENVIRONMENT=dev pnpm run deploy  # use rg-signals-dev
 */

import { execSync } from "child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "fs";

const ENVIRONMENT = process.env.ENVIRONMENT ?? "prod";
const RESOURCE_GROUP = `rg-signals-${ENVIRONMENT}`;

const run = (cmd: string): void => {
  execSync(cmd, { stdio: "inherit" });
};

const capture = (cmd: string): string =>
  execSync(cmd, { encoding: "utf8" }).trim();

function detectSwa(): string {
  const output = capture(
    `az staticwebapp list --resource-group "${RESOURCE_GROUP}" ` +
      `--query "[?starts_with(name, 'stapp-signals-')].name" -o tsv`,
  );
  const list = output.split("\n").filter(Boolean);
  if (list.length === 0) {
    console.error(
      `No Static Web App matching 'stapp-signals-*' in ${RESOURCE_GROUP}`,
    );
    console.error("Deploy infra first: pnpm run deploy:infra");
    process.exit(1);
  }
  if (list.length > 1) {
    console.error("Multiple Static Web Apps — specify one:");
    list.forEach((n) => console.error(`  - ${n}`));
    process.exit(1);
  }
  return list[0];
}

const swaApp = process.argv[2] ?? detectSwa();

// --- GeoLite2 fetch (signal mode) -------------------------------------------

// Signal-mode deploys need the MaxMind Country MMDB bundled with the
// Function app to resolve visitor country codes. Counter-mode deploys
// don't need it — the file is gitignored and missing from the bundle
// is a no-op at runtime (country lookups return null). Gated on
// MAXMIND_LICENSE_KEY so counter-mode deploys still work without a
// MaxMind account.
fetchGeoLite2IfLicensed();

// --- Build ------------------------------------------------------------------

// shared must build before functions (workspace:* type resolution) and before
// beacon can import shared types. beacon must build before dashboard so its
// output lands in packages/dashboard/public/beacon.js for Vite to pick up.
console.log("Building shared...");
run("pnpm --filter=@signals/shared run build");

console.log("Building beacon...");
run("pnpm --filter=@signals/beacon run build");

console.log("Building dashboard...");
run("pnpm --filter=@signals/dashboard run build");

console.log("Building functions...");
run("pnpm --filter=@signals/functions run build");

// --- Bundle functions for deploy --------------------------------------------

console.log("Bundling functions with prod deps only (pnpm deploy)...");
rmSync("./out/api", { recursive: true, force: true });
// --legacy preserves the original package.json (main, type) — the new pnpm 10
// deploy implementation strips them, which breaks Azure Functions handler
// discovery. The resulting bundle still self-contains workspace deps via the
// node_modules/.pnpm virtual store.
run("pnpm --filter=@signals/functions --prod deploy --legacy ./out/api");

// pnpm deploy copies compiled dist + production node_modules into
// out/api but not arbitrary top-level directories. Copy the MMDB into
// the bundle explicitly so the Function can read it at runtime.
const mmdbSource = "packages/functions/geo/GeoLite2-Country.mmdb";
if (existsSync(mmdbSource)) {
  mkdirSync("./out/api/geo", { recursive: true });
  cpSync(mmdbSource, "./out/api/geo/GeoLite2-Country.mmdb");
  console.log("Bundled GeoLite2-Country.mmdb into out/api/geo/");
}

// --- Single SWA deploy for static + API -------------------------------------

console.log(`Deploying to ${swaApp}...`);
run(
  "swa deploy ./packages/dashboard/dist" +
    " --api-location ./out/api" +
    " --api-language node" +
    " --api-version 22" +
    ` --app-name "${swaApp}"` +
    " --env production" +
    " --no-use-keychain",
);

console.log("Deployment complete.");

function fetchGeoLite2IfLicensed(): void {
  const licenseKey = process.env.MAXMIND_LICENSE_KEY;
  if (!licenseKey) {
    console.log(
      "GeoLite2 fetch skipped — MAXMIND_LICENSE_KEY not set." +
        " Signal-mode deploys will log `geo: MMDB unavailable` at runtime" +
        " and return null for country.",
    );
    return;
  }
  const destDir = "packages/functions/geo";
  mkdirSync(destDir, { recursive: true });
  const tarPath = "/tmp/GeoLite2-Country.tar.gz";
  const extractDir = "/tmp/geolite2-extract";
  rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });
  console.log("Fetching GeoLite2-Country MMDB from MaxMind...");
  run(
    `curl -fsSL "https://download.maxmind.com/app/geoip_download` +
      `?edition_id=GeoLite2-Country&license_key=${licenseKey}` +
      `&suffix=tar.gz" -o "${tarPath}"`,
  );
  run(`tar -xzf "${tarPath}" -C "${extractDir}"`);
  // Archive contains a single dated subdir like GeoLite2-Country_20260401/.
  run(
    `find "${extractDir}" -name "GeoLite2-Country.mmdb"` +
      ` -exec cp {} "${destDir}/GeoLite2-Country.mmdb" \\;`,
  );
  console.log(`GeoLite2-Country.mmdb staged at ${destDir}/.`);
}
