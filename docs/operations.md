# Operations

## Hosting decision triggers

signals currently runs on Flex Consumption. This is the right answer for
single-tool, low-traffic workloads (~$1-5/month at plankit.com volume,
$25 budget cap as safety net).

Revisit hosting model when EITHER:

- A second workshop tool needs a Functions backend. At that point a shared
  Azure App Service Plan (B1 Linux, ~$15/month) hosting multiple Function
  Apps becomes more economical and eliminates cold starts as a side effect.
  This is the HeliMods pattern.

- Measured cold-start event loss exceeds 1% of expected events. Cold starts
  on Flex Consumption are 1-2s; sendBeacon may fail to deliver on bouncy
  pages if the function is cold. We don't currently measure this — would
  require building "expected vs received" comparison, which is its own
  project. Don't speculatively optimize.

Migration path: Flex Consumption → App Service Plan is a Bicep change. Same
Functions code, same deployment pattern (func azure functionapp publish
works against either), same Storage and KV references. Reversible in a day.
