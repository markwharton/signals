#!/usr/bin/env npx tsx

/**
 * Deploy signals dashboard (static) and Functions API to Azure.
 *
 * The SWA (Free) serves only static assets — dashboard + beacon.js. The
 * API runs on a separate Flex Consumption Function App, deployed via
 * `az functionapp deployment source config-zip` against a bundled zip.
 *
 * Flow:
 *   1. Build shared, beacon (copies to dashboard/public/), dashboard, functions.
 *   2. Bundle functions with `pnpm deploy --prod --legacy` into out/api.
 *      --legacy preserves the original package.json (main, type) that the
 *      newer pnpm 10 deploy strips. The resulting bundle is self-contained
 *      via pnpm's virtual store.
 *   3. Zip out/api → out/api.zip.
 *   4. Push zip to the Function App via `az functionapp deployment source
 *      config-zip`.
 *   5. Push static assets to the SWA via `swa deploy ./packages/dashboard/dist`.
 *
 * Usage:
 *   pnpm run deploy                  # auto-detect SWA + Function App in rg-signals-prod
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

function detectSingle(
  command: string,
  description: string,
  hint: string,
): string {
  const output = capture(command);
  const list = output.split("\n").filter(Boolean);
  if (list.length === 0) {
    console.error(`No ${description} in ${RESOURCE_GROUP}`);
    console.error(hint);
    process.exit(1);
  }
  if (list.length > 1) {
    console.error(`Multiple ${description}s — specify one:`);
    list.forEach((n) => console.error(`  - ${n}`));
    process.exit(1);
  }
  return list[0];
}

const swaApp = detectSingle(
  `az staticwebapp list --resource-group "${RESOURCE_GROUP}" ` +
    `--query "[?starts_with(name, 'stapp-signals-')].name" -o tsv`,
  "Static Web App matching 'stapp-signals-*'",
  "Deploy infra first: pnpm run deploy:infra",
);

const funcApp = detectSingle(
  `az functionapp list --resource-group "${RESOURCE_GROUP}" ` +
    `--query "[?starts_with(name, 'func-signals-')].name" -o tsv`,
  "Function App matching 'func-signals-*'",
  "Deploy infra first: pnpm run deploy:infra",
);

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

// --- Bundle + zip functions -------------------------------------------------

console.log("Bundling functions with prod deps only (pnpm deploy)...");
rmSync("./out/api", { recursive: true, force: true });
rmSync("./out/api.zip", { force: true });
run("pnpm --filter=@signals/functions --prod deploy --legacy ./out/api");

console.log("Creating deployment zip...");
run("cd out/api && zip -rq ../api.zip .");

// --- Deploy to Function App -------------------------------------------------

console.log(`Deploying functions to ${funcApp}...`);
run(
  "az functionapp deployment source config-zip" +
    ` --resource-group "${RESOURCE_GROUP}"` +
    ` --name "${funcApp}"` +
    " --src out/api.zip",
);

// --- Deploy static assets to SWA --------------------------------------------

console.log(`Deploying static assets to ${swaApp}...`);
run(
  "swa deploy ./packages/dashboard/dist" +
    ` --app-name "${swaApp}"` +
    " --env production" +
    " --no-use-keychain",
);

console.log("Deployment complete.");
