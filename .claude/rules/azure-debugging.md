# Azure Debugging

Techniques proven useful against signals' Azure + pnpm + Functions stack.
Reach for these before flailing.

## Query App Insights for Function diagnostics

Every deployed Function logs to Application Insights. When a request 500s
without a client-visible body, the cause is almost always in a trace.

- Get the app ID once: `AI_ID=$(az monitor app-insights component show --app appi-signals-<suffix> --resource-group rg-signals-<env> --query appId -o tsv)`
- Fetch recent failures:
  `az monitor app-insights query --app $AI_ID --analytics-query "traces | where timestamp > ago(5m) and severityLevel >= 2 and message !contains 'Unhealthy' | order by timestamp desc | take 20 | project timestamp, message, severityLevel" -o json`
- To correlate everything about a single failed invocation, filter by
  `operation_Id` — Azure's `Executed 'Functions.X' (Failed, Id=<guid>)`
  line gives you the id, then pull all telemetry with that id.
- `union traces, exceptions` surfaces both Kusto tables in one query.

## Inspect live Azure state before changing Bicep

Bicep is a wish; Azure is the reality. Before writing or deploying Bicep,
read actual state:

- `az resource list --resource-group rg-signals-<env> -o table` — what's
  actually there.
- `az staticwebapp show --name X --query "{sku:sku.name, identity:identity}" -o json` — detect a lingering managed identity (MI) or SKU that'll block a downgrade.
- `az functionapp list --resource-group X -o json` — hostname, kind, identity.
- When a role is granted to the SWA MI but Key Vault access is denied to
  your own user, use `az rest --method GET --url "https://management.azure.com/..."`
  for control-plane listings that only need Reader on the resource.

## Reproduce runtime resolution locally before deploying

Azure Functions uses `--preserve-symlinks` during ESM resolution. Repro:

```
cd out/api && node --preserve-symlinks --input-type=module \
  -e "import('./node_modules/@signals/shared/dist/event.js').then(m => console.log('ok')).catch(e => console.error(e.message))"
```

Runs the exact resolution path Azure uses. If it fails locally, it'll fail
in the cloud — fix it here before burning a deploy cycle.

## Reference a known-working configuration

When stuck on an Azure shape, find a proven template before guessing.
Compare SKU names, API versions, and identity/role blocks against code
that has actually deployed — Microsoft's public quickstart samples, an
earlier working deploy in your own Bicep history, or `az resource show
--ids <existing-resource-id>` for live state to reverse-engineer. Azure
error messages don't tell you which shape is right; a working example
does.

## Deploy diagnostic code to inspect runtime state

When logs say nothing useful, add a single `ctx.log(...)` line that prints
the first ~30 chars of a suspicious env var (never the full value — secrets
leak via logs). Redeploy, trigger, read the log, remove the diagnostic.

The classic finding: `collect: STORAGE_CONNECTION_STRING prefix: "@Microsoft.KeyVault(SecretUri=ht"` immediately tells you the KV reference never resolved.

## Validate Bicep before deploy

`az bicep build --file infra/main.bicep --outfile /tmp/out.json` catches
syntax, type, and BCP* errors in ~1s. Always run it before
`pnpm run deploy:infra` — a failed deploy against Azure takes 30s–60s to
reject the same error Bicep caught instantly.

## Hypothesis-driven bisection

State the hypothesis explicitly ("is the SKU the blocker?"), then run ONE
change that confirms or refutes it. Don't change three things at once and
hope the error message clarifies which mattered. The Azure error messages
are often misleading (`SkuCode 'Free' is invalid` meant "MI not allowed on
Free" in practice), so controlling variables is the only way to distinguish
cause from symptom.
