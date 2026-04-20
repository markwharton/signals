# Operations

## Hosting

signals runs on Azure Static Web Apps (Free) with SWA Managed Functions.
Same-origin API, single auth layer (SWA's GitHub auth gates `/api/*` and
`/` under the `signals_admin` role), Table Storage via a plain connection
string written directly to SWA app settings by Bicep at deploy time,
Logic App for daily rollups. Cost: ~$0-2/month at plankit.com volume —
$0 SWA, small Logic App consumption, minimal Table Storage transactions.

Revisit the hosting model if EITHER:

- A second workshop tool needs a backend. At that point a shared App
  Service Plan (B1 Linux, ~$15/month) hosting multiple Function Apps may
  be more economical and eliminates cold starts as a side effect. This is
  the HeliMods pattern. Requires moving off SWA Managed Functions to Bring
  Your Own Functions, so not a trivial change.

- Measured cold-start event loss exceeds 1% of expected events. SWA
  Managed Functions have cold starts; sendBeacon may fail to deliver on
  bouncy pages if the function is cold. We don't currently measure this —
  would require building "expected vs received" comparison, which is its
  own project. Don't speculatively optimize.

Don't pivot to a standalone Function App to solve perceived problems
with SWA Managed Functions without carefully reviewing the auth story
— standalone Function Apps don't inherit SWA's auth layer, which
creates a harder security problem than any operational one it solves.

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
