# Operations

## Hosting

signals runs on Azure Static Web Apps (Free) with SWA Managed Functions.
Same-origin API, single auth layer (SWA's GitHub auth gates `/api/*` and
`/` under the `signals_admin` role), Table Storage via a plain connection
string written directly to SWA app settings by Bicep at deploy time,
Logic App for daily rollups. Cost: ~$0-2/month at plankit.com volume —
$0 SWA, small Logic App consumption, minimal Table Storage transactions.

Revisit the hosting model when one of the explicit trigger conditions
below trips. None has yet, but the accumulation of workarounds is
worth naming honestly so the next deliberate review has real data to
work from.

**Explicit trigger conditions (any one is sufficient):**

- A second workshop tool needs a backend. At that point a shared App
  Service Plan (B1 Linux, ~$15/month) hosting multiple Function Apps
  may be more economical and eliminates cold starts as a side effect.
  This is the HeliMods pattern. Requires moving off SWA Managed
  Functions to Bring Your Own Functions, so not a trivial change.

- Measured cold-start event loss exceeds 1% of expected events. SWA
  Managed Functions have cold starts; sendBeacon may fail to deliver
  on bouncy pages if the function is cold. We don't currently measure
  this — would require building "expected vs received" comparison,
  which is its own project. Don't speculatively optimize.

**Observed operational friction (accumulating, not yet sufficient):**

- **No native timer trigger.** SWA MF is HTTP-only, so a Logic App
  stands in as the scheduler for `/api/daily`. Works, but adds a
  moving part that has its own failure modes (see the 2026-04-20
  02:22 UTC `Failed` run — a 500 from the SWA middleware layer on
  cold start, body literally `Backend call failure`).

- **No platform-level App Insights integration.** The SWA platform
  honors `APPLICATIONINSIGHTS_CONNECTION_STRING` as an app setting
  (visible to function code) but does not itself forward function
  telemetry. Tracked upstream at
  [Azure/static-web-apps#204](https://github.com/Azure/static-web-apps/issues/204);
  `Microsoft.Web/staticSites@2025-03-01` has no telemetry property,
  and the Portal's "Enable Application Insights" button just writes
  the same app setting (plus hidden-link tags for portal cosmetics).
  **Previously attempted fix:** install the `applicationinsights` npm
  package and call `useAzureMonitor(...)` at module load. It works,
  but drags in ~163 transitive OpenTelemetry packages — inflating the
  API bundle from 116 → 279 packages and pushing the SWA CLI upload
  past its 5-minute SAS token window, making deploys flaky. Backed
  out on 2026-04-21. Current state: rely on whatever the Functions
  host emits on its own (intermittent requests + ctx.log traces
  observed, no auto-dependency tracking, no custom events).
  Revisit only when event loss or opaque failures make it worth the
  deploy-time tax — or when a standalone Function App enters scope
  and makes the workaround unnecessary.

- **No managed identity path to Storage** (documented in
  `.claude/rules/architecture-choices.md`). Connection string via app
  settings works, but MI-based rotation isn't available for v1 on
  SWA MF.

**Blocker to watch before any pivot — the auth story is the real cost:**

SWA's built-in GitHub auth gates `/`, `/api/*`, and the dashboard
under the `signals_admin` role. A standalone Function App does NOT
inherit this — `/api/summary`, `/api/mcp`, and the dashboard all need
their auth re-solved before the move is a net win. Don't pivot to a
standalone Function App to solve observability or scheduling
perceived problems without carefully weighing the auth consequence
— the security surface area this adds is a harder problem than any
operational one it would solve.

**Current stance:** stay on SWA MF. No custom telemetry — the
in-process SDK's bundle cost wasn't worth the partial observability
it delivered. Keep the Logic App. Wait for a real trigger (second
tool, measured event loss) to force the question.

## Budget alert

`budget-signals-${env}` alerts at 50% of the monthly cap ($5 of $10) to
catch anomalies ~5× above normal burn. If it fires, investigate: most
likely a bot flood past isbot, a runaway rollup (infinite loop in the
daily function), or an accidental traffic amplifier (beacon embedded in
a page that auto-refreshes every second).

## Admin invitation (SWA)

To add an admin who can view the dashboard:

1. Azure portal → Static Web App `stapp-signals-*` → **Role management**.
2. Click **Invite**. Form values:
   - Authorization provider: **GitHub**
   - Invitee: GitHub username only, no `@` or URL
   - Domain: the SWA hostname (e.g. `nice-pebble-*.azurestaticapps.net`)
   - Role: `signals_admin` — underscore, not dash (Azure's validator
     only allows letters, digits, underscores)
   - Duration: max 168 hours
3. Azure returns an invitation URL. Send to invitee.
4. Invitee opens the link (logged in to GitHub as the invited identity)
   and clicks **Accept** on the consent screen.

`signals_admin` is referenced in `staticwebapp.config.json`'s
`allowedRoles` — it gates the dashboard, `/api/summary`, and every
other `/*` route.

## Cleanup after architecture changes

Bicep's incremental mode leaves orphan resources when modules fall out
of the template. After any deploy that removes resources, diff what's
live against what's declared:

```bash
az resource list -g rg-signals-${ENV} --query "[].{name:name}" -o table
```

Compare to `infra/main.bicep`'s modules. Anything that shouldn't be
there is an orphan.

Common orphans encountered in this project:

- **Function App + hosting plan** from past experiments. Delete via
  `az functionapp delete` + `az appservice plan delete`.
- **Role assignments on storage** pointing at deleted managed
  identities — visible via
  `az role assignment list --scope <storage-id>` with a `principalId`
  that no longer resolves in Graph. Delete by assignment id.
- **Key Vault** needs two calls because of soft-delete retention:
  ```bash
  az keyvault delete  --name <kv> --resource-group <rg>
  az keyvault purge   --name <kv> --location <region>
  ```
  Skip purge if you want the 90-day recovery window.

## Deploy gotchas

### SAS window vs API bundle size

The SWA CLI (`swa deploy`) uploads build artifacts using a short-lived
storage SAS token — **valid for 5 minutes**. If the upload takes
longer than that, you get:

```
Uploading failed. Error message: Server failed to authenticate the request.
ErrorCode: AuthenticationFailed
AuthenticationErrorDetail: Signature not valid in the specified key time frame:
  Key start [...] Key expiry [...] Current [...]
Failed to upload build artifacts.
```

The cause is almost always that the API bundle (`out/api/node_modules`)
grew past what the network can push in 5 minutes. Mitigations in
order of preference:

1. **Shrink the bundle.** `pnpm --filter=@signals/functions --prod deploy --legacy ./out/api` already strips devDependencies; the remaining packages are all production. Look for heavy additions to `packages/functions/package.json`. See the applicationinsights note below for a concrete example.
2. **Retry.** Network variance sometimes gets the same bundle through on a second attempt. Quick but not a fix.
3. **Use `--deployment-token` with the SWA deploy key** from `az staticwebapp secrets list`. This helps with AAD-session expiry but the upload-layer SAS is still 5 minutes, so it doesn't solve large-bundle cases on its own.

### applicationinsights bloats the API bundle

Do **not** add `applicationinsights` (or `@azure/monitor-opentelemetry`)
to `@signals/functions` without a plan for bundle size. The `v3.x`
series is an OpenTelemetry rewrite that pulls in ~163 transitive
packages — in one 2026-04-21 experiment the API bundle grew from
116 → 279 packages, blowing past the 5-minute SAS window and making
deploys unreliable. Backed out.

SWA Managed Functions has no platform-level App Insights integration
([Azure/static-web-apps#204](https://github.com/Azure/static-web-apps/issues/204)),
so there's no "small" in-process fix available; any SDK that gives
real auto-instrumentation will drag the OTel chain along with it.
If custom telemetry becomes load-bearing, the right answer is
probably a hosting-model review (see "Revisit the hosting model"),
not another attempt at bundling heavy SDKs into SWA MF.

## Verifying the daily rollup

A "day" in signals is a **UTC day** (00:00–24:00 UTC), end to end —
event partition keys, rollup partition keys, the summary window, and
the Logic App's recurrence trigger all run on UTC. For Brisbane
(UTC+10) that maps to 10:00 Brisbane → 10:00 Brisbane next day, which
is why 9am Brisbane traffic rolls up with the *previous* UTC date.

The Logic App POSTs `/api/daily` at 17:00 UTC (03:00 Brisbane next day).
The morning after a deploy is the first chance to confirm it ran:

```bash
AI_ID=$(az monitor app-insights component show \
  --app appi-signals-* --resource-group rg-signals-prod \
  --query appId -o tsv)

az monitor app-insights query --app "$AI_ID" \
  --analytics-query "traces | where timestamp > ago(12h) \
    and message startswith 'daily:' | order by timestamp asc" \
  -o table
```

A healthy run shows `daily: rolling up`, `daily: aggregated N event(s)`,
`daily: rollup rows written`, `daily: deleted M raw event(s)`, and
`daily: complete` — all within a few seconds of each other.

## Forcing a rollup

`/api/daily` accepts `?date=YYYYMMDD` and `?days=N` (1..30) for manual
invocations. `scripts/rollup.ts` (wired up as `pnpm run rollup`)
reads `DAILY_RAW_KEY` from `scripts/.env.${ENVIRONMENT}`, autodetects
the SWA hostname, and POSTs for you:

```bash
pnpm run rollup                               # default: yesterday UTC, 1 day
pnpm run rollup -- --date 20260420            # re-roll a specific UTC day
pnpm run rollup -- --date 20260420 --days 7   # 7 UTC days ending 20260420
ENVIRONMENT=dev pnpm run rollup               # point at rg-signals-dev
```

Two safety rules baked into the handler make re-rolls non-destructive:

- **Empty-partition skip** — if a target day has zero raw events (past
  retention, or never had any), the handler leaves existing rollup rows
  untouched instead of writing zeros. Response shows `"skipped": true`.
- **Cleanup gating** — the 30-day raw-event GC only fires on the
  default invocation (no `?date`). Manual `?date=` calls never delete
  source data, so you can re-roll any historical window safely.

The scheduled Logic App call is pinned to `?days=1` so it stays on the
default semantics even if the handler default ever changes.

Dashboards and `/api/summary` only read rollups up to **yesterday UTC**
— a same-day rollup lands in the table but isn't shown. Today's
numbers would shift as events arrived, which isn't what a
daily-aggregated view is supposed to offer. If you need current-day
data, query the `events` table directly.

## Smoke tests

After any meaningful deploy, a minute of curl work catches most
regressions. Each endpoint has a negative-case variant worth running
too — a 200 on the happy path isn't reassuring if the auth layer is
broken and every caller is being let through.

Shared preamble (grabs values from your gitignored env file without
sourcing the whole thing):

```bash
URL=https://nice-pebble-0b010a000.7.azurestaticapps.net
MCP_KEY=$(grep '^MCP_RAW_KEY=' scripts/.env.prod | cut -d= -f2-)
ADMIN_KEY=$(grep '^ADMIN_RAW_KEY=' scripts/.env.prod | cut -d= -f2-)
```

### `/beacon.js`

```bash
curl -sI "$URL/beacon.js" | grep -iE 'HTTP|cache-control'
```

Expect `HTTP/2 200` and a `cache-control: public, max-age=86400,
stale-while-revalidate=604800` header. If the `/*` route has
swallowed `/beacon.js` somehow, you'll see a `302` to GitHub login
instead — a bad sign for plankit.com visitors.

### `/` (dashboard)

```bash
curl -sI "$URL/" | grep -iE 'HTTP|location'
```

Expect `HTTP/2 302` and `location: /.auth/login/github`. A `200` means
the auth gate has fallen off; a `401` means the response override for
unauthenticated requests isn't redirecting any more.

### `/api/collect` (anonymous POST)

```bash
curl -sw "HTTP %{http_code}\n" -X POST \
  -H 'content-type: text/plain' \
  -d '{"v":1,"kind":"pageview","site":"plankit.com","path":"/smoke","referrerHost":null,"isMobile":false,"isBot":false}' \
  "$URL/api/collect"
```

Expect `HTTP 204` — the beacon path accepts pageviews anonymously by
design (rate-limiting is the right control there, when it ships).

### `/api/summary` (admin, two auth paths)

```bash
# API-key path (sig CLI / automation)
curl -sw "\nHTTP %{http_code}\n" \
  -H "x-api-key: $ADMIN_KEY" \
  "$URL/api/summary?days=7" | tail -3

# unauth negative (expect 401)
curl -sw "HTTP %{http_code}\n" "$URL/api/summary?days=7"
```

Expect `HTTP 200` with the API key, `HTTP 401` without. The browser
path (SWA-forwarded `x-ms-client-principal`) is hard to curl — easier
to just visit the dashboard in a browser and confirm tiles render.

### `/api/mcp` (JSON-RPC)

```bash
# tool list
curl -s -X POST "$URL/api/mcp" \
  -H "x-api-key: $MCP_KEY" \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' | jq

# call the tool
curl -s -X POST "$URL/api/mcp" \
  -H "x-api-key: $MCP_KEY" \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","method":"tools/call","id":2,"params":{"name":"signals_summary","arguments":{"days":7}}}' \
  | jq '.result.content[0].text | fromjson'

# unauth negative (expect JSON-RPC -32001)
curl -s -X POST "$URL/api/mcp" \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":3}' | jq
```

Successful `tools/list` lists `signals_summary` with its input schema.
Successful `tools/call` unwraps to the same SummaryResponse shape the
dashboard and sig CLI get. The negative returns an error body with
`code: -32001`.

If any step hangs or 500s, App Insights has the details:

```bash
AI_ID=$(az monitor app-insights component show \
  --app appi-signals-* --resource-group rg-signals-prod \
  --query appId -o tsv)

az monitor app-insights query --app "$AI_ID" \
  --analytics-query "traces | where timestamp > ago(10m) \
    and severityLevel >= 2 and message !contains 'Unhealthy' \
    | order by timestamp desc | take 20" -o json
```
