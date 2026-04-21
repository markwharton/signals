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
import { rmSync } from "fs";

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
