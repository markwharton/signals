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
