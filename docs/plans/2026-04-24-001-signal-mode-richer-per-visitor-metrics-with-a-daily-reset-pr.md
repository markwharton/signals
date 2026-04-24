# Signal mode — richer per-visitor metrics with a daily-reset privacy envelope

## Context

signals ships "Counter mode" today: a minimal beacon → `/api/collect` → Azure Table `events` → nightly rollup → `/api/summary` → dashboard. No cookies, no IPs, no fingerprints. Counter answers "how many pageviews from where" but can't answer "how many *people*", "how long do they stay on the site", or "where are they coming from geographically".

The marketing surface already advertises a second tier — *"Signal mode (in development). Richer metrics for sites that need them. Uses a daily-rotated salt so fingerprints never link across days."* — and the Bicep already carries a `signalsMode: 'counter' | 'signal'` parameter that wires through to a `SIGNALS_MODE` app setting. The mode scaffold exists in infra; nothing in the code reads it yet.

Signal mode lights up that scaffold. It adds a server-computed visitor hash (`sha256(salt_today ‖ ip ‖ ua ‖ site)`), a GeoLite2-derived ISO country code on each raw event, and three new per-visitor counters on the rollup (`visitors`, `sessions`, `bounces`). Sessions use a 30-minute inactivity window and are derived at rollup time from the (visitor, ts) tuples. The daily salt rotates by being a different Azure Tables row per UTC day — visitor hashes are unlinkable across day boundaries by construction, not by policy. IP and UA are touched only inside `/api/collect` and never persisted.

v1 deliberately stays small: **site-level + per-country** breakdowns, country-only geo (no region/city), no dwell time, no compound rollups, no per-site mode config. One Function App runs one mode.

Safari's ITP and fingerprinting-defence are not blockers: they target browser-side persistent identifiers, and this design has none.

## Deployment posture — build it, don't ship it

Counter mode stays the product of record. plankit.com's production deployment remains `signalsMode: 'counter'`; the landing-page copy stays *"Signal mode (in development)"* because it is — the code ships behind the switch but no site is flipped over. This keeps the current privacy policy solid, avoids the DPIA / customer-boilerplate / DSAR-runbook surface, and preserves "no IP read, no UA read, nothing to explain" as signals' marketable thesis.

Concretely:
- All four commits land on `develop` and merge to `main` through the normal `pk release` flow.
- Tests run in a separate `rg-signals-dev` (or similar non-prod) resource group with `signalsMode=signal` and a throwaway site name (e.g. `example.test`) in `SIGNALS_SITES`. Verification smoke tests run there.
- The prod Bicep parameters file **must not** be changed to `signalsMode: 'signal'`. Call that out in the commit body of commit 4 as a guardrail.
- No landing-page edits, no DPIA publication, no customer-facing privacy boilerplate — those ship *only* if a real requesting customer appears. If that happens, they're fast-follow deliverables, not blockers.

## Approach

Four commits. Each is independently deployable and reversible. No Bicep changes — the `signalsMode` param already exists and the app-settings path already reaches the Function.

### Commit 1 — `feat(signals): v2 wire format, mode gate, DNT/GPC`

Wire-only change. After this, the server knows which mode it's in and honours opt-out headers in both modes.

Files:
- `packages/shared/src/event.ts` — rename `CollectRequest` → `CollectRequestV1`; add `CollectRequestV2` with `v: 2` and optional browser fields `screen: { w, h } | null`, `lang: string | null`, `tz: string | null`; export `CollectRequest = V1 | V2`. Extend `BaseStoredEvent.v` to `1 | 2` and add optional stored columns (`visitorHash`, `country`, `screenW`, `screenH`, `lang`, `tz`) so the stored shape is one type — counter-mode deploys leave them undefined.
- `packages/functions/src/collect/index.ts` — extract validators into a sibling `validate.ts` with `parseV1` and `parseV2` dispatched on `parsed.v`. Read `process.env.SIGNALS_MODE` once at module scope (same pattern as `apiKey.ts:31` reading env on call — module-scope is cheaper for the hot path). Add a DNT/GPC gate *before* `checkRateLimit` (`collect/index.ts:19`): if `req.headers.get('dnt') === '1'` or `'sec-gpc' === '1'`, return `{ status: 204 }`. Reject v2 payloads on counter-mode deploys (`400`, `ctx.warn`). Continue accepting v1 on signal-mode deploys during beacon-cache rollover — log once per cold start with a throttled module boolean.
- `packages/shared/src/index.ts` — re-export the new types.

### Commit 2 — `feat(signals): visitor hashing with daily-rotated salt`

`/api/collect` on signal-mode deploys computes a visitor hash. IP/UA never persisted. No geo yet.

Files:
- `packages/functions/src/shared/tables.ts` — add `TABLE_SALTS = 'salts'` alongside the existing constants (the `getTableClient` helper is dimension-agnostic).
- `packages/functions/src/shared/salt.ts` (new) — `getTodaySalt(site, now): Promise<Buffer>` using `createEntity` (atomic create, catches `EntityAlreadyExists` / 409 and re-reads). Module-level `Map<site, { ymd, salt }>` cache — one round-trip per warm instance per day. Reuses the `createHash` / `timingSafeEqual` pattern from `shared/apiKey.ts:1,32`.
- `packages/functions/src/shared/salt.ts` — `hashVisitor(salt, ip, ua, site): string` — `createHash('sha256').update(salt).update(':').update(ip).update(':').update(ua).update(':').update(site).digest('hex')`.
- `packages/functions/src/shared/clientIp.ts` (new) — `extractClientIp(req): string | null` — leftmost `x-forwarded-for` entry, falling back to `x-azure-clientip`. Lowercase, strip IPv6 zone ids (`%…`), strip `[]` brackets. No `::ffff:` unwrapping.
- `packages/functions/src/collect/index.ts` — on signal mode, after origin check: extract IP, extract `user-agent` header, compute hash, write `visitorHash` on the entity. IP/UA live in local `let` bindings inside a block and drop out of scope immediately. If the IP header is missing, store `visitorHash: null` — fail-fast applies to payload structure, not to an absent optional hop. No `ctx.log` ever includes IP or UA.

### Commit 3 — `feat(signals): GeoLite2 country + signal-mode beacon`

Adds country resolution and teaches the beacon to emit v2.

Files:
- `scripts/deploy.ts` — add a `fetchGeoLite2()` step guarded by `MAXMIND_LICENSE_KEY`. Downloads the Country MMDB to `packages/functions/geo/GeoLite2-Country.mmdb`.
- `.gitignore` — `packages/functions/geo/*.mmdb`.
- `packages/functions/package.json` — add `mmdb-lib` (pure JS, safe on SWA Managed Functions; no native bindings).
- `packages/functions/src/shared/geo.ts` (new) — lazy-load the MMDB on first call (module-level `Reader` singleton, `fs.readFileSync` once). `lookupCountry(ip): string | null` — returns ISO alpha-2 or null. Throttled `ctx.log` tagged `geo:miss` on first miss per cold start only (module boolean).
- `packages/functions/src/collect/index.ts` — signal-mode block calls `lookupCountry(ip)`, writes `country` (or null). Never falls back to `Accept-Language` (project rule: no silent fallback to made-up defaults).
- `packages/beacon/src/beacon.ts` — branch on `data-mode`: `"counter"` keeps today's behaviour exactly (`beacon.ts:52-53`); `"signal"` builds a v2 payload including `screen: { w: screen.width, h: screen.height }`, `lang: navigator.language || null`, `tz: Intl.DateTimeFormat().resolvedOptions().timeZone || null`. Don't share a payload object across branches — three literal constructions beats a helper that straddles both shapes.

### Commit 4 — `feat(signals): sessions, bounces, visitors, per-country rollups`

Extends the daily rollup to derive session metrics from (visitor, ts) tuples and adds a new `country` rollup dimension. Summary response grows three new counters plus an optional `countries` breakdown.

Files:
- `packages/shared/src/rollup.ts` — extend `RollupDimension` with `"country"`; add `MonthlyRollupDimension "country"`; add `countryRowKey(country: string | null): string` returning the ISO code or a `(unknown)` sentinel mirroring `DIRECT_SENTINEL`. Extend `RollupRow` with optional `visitors?, sessions?, bounces?`.
- `packages/functions/src/daily/index.ts` (`rollupDay`, lines 249–331) — extend the per-hour scan to capture `visitorHash` and `ts`. After the existing counter accumulation, build per-dimension maps `dim-value → visitorHash → ts[]`, sort each visitor's timestamps, split into sessions by 30-minute gaps. Per dimension, emit three derived counters: `visitors` = unique hash count, `sessions` = sum of session counts across visitors, `bounces` = sum of one-event sessions. Apply to `device` and new `country` dim. `path`, `referrer`, `pathxreferrer` are untouched — per-path sessions are out-of-scope for v1. Monthly rebuild adds `"country"` to its dimension list. Salt GC: at the end of the run, delete `salts` rows older than 2 UTC days (reuse the existing `deletePartition` helper).
- `packages/shared/src/summary.ts` — extend `SummaryCounters` with optional `visitors?, sessions?, bounces?`. Add `countries?: Array<{ country: string } & SummaryCounters>` on `SummaryResponse`. Optional fields keep counter-mode summaries shape-compatible.
- `packages/functions/src/shared/summaryQuery.ts` (`buildSummary`, lines 198–357) — read the `country` partition per day alongside existing dims; aggregate into `totals` + `countries`. Site-level `visitors/sessions/bounces` derive from the `device` dim sum (device covers 100% of traffic in exactly two rows — no new site-total partition needed).
- `packages/dashboard/src/` — add three tiles (Visitors, Sessions, Bounce Rate = `bounces / sessions`) and a Top countries card, all gated on `totals.sessions > 0` so counter-mode deploys don't render empty tiles. Follows the existing tile layout in the Pageviews / Top paths / Top referrers grid.

## Critical files

- `packages/functions/src/collect/index.ts` — mode gate, DNT/GPC, IP/UA → hash, country lookup.
- `packages/functions/src/daily/index.ts` — session derivation, country rollup, salt GC.
- `packages/shared/src/event.ts` — v2 wire type, extended stored shape.
- `packages/shared/src/rollup.ts` — new `country` dim helpers, extended `RollupRow`.
- `packages/shared/src/summary.ts` + `packages/functions/src/shared/summaryQuery.ts` — response shape + reader.
- `packages/beacon/src/beacon.ts` — signal-mode branch.
- `scripts/deploy.ts` — GeoLite2 fetch.

## Reuse

- Crypto: `packages/functions/src/shared/apiKey.ts:1,32` (`createHash`, `timingSafeEqual`).
- Table client: `packages/functions/src/shared/tables.ts:11` (`getTableClient`).
- Site/origin validation: `packages/functions/src/shared/sites.ts` (`getAllowedSites`, `originMatchesSite`) — reused as-is.
- Partition helpers: `packages/shared/src/rollup.ts` (`rollupPartitionKey`, `rollupMonthlyPartitionKey`) — extended with `"country"`.
- 30-day retention pattern: `packages/functions/src/daily/index.ts:41,221-233` — same model for salt GC.
- Conventional commits + changelog: stamped by `pk changelog` per `.claude/rules/plankit-tooling.md`.

## Verification

**Smoke — commit 1.**
`curl -i -H 'dnt: 1' -H 'origin: https://plankit.com' -d '{"v":1,"kind":"pageview","site":"plankit.com","path":"/","referrerHost":null,"isMobile":false}' $HOST/api/collect` → expect 204. Query `events` table for the last 60s — expect zero new rows. Repeat without DNT → expect one new row. Negative case: POST `{"v":2,...}` to a counter-mode deploy → expect 400, `ctx.warn` in App Insights.

**Smoke — commit 2.**
Two POSTs in quick succession from the same client on a signal-mode deploy → `az storage entity query --table-name events` shows two rows with identical `visitorHash`. Query `salts` table: `--filter "PartitionKey eq 'plankit.com'"` → one row for today. Tomorrow morning (or manually upsert a row for today+1 and reuse that clock), same client POST → different `visitorHash`, salts table now has two rows. DNT request must not mint a salt row if it's the first hit of the day.

**Smoke — commit 3.**
POST v2 from a curl through a VPN with a known country IP → `country` column populated. POST from `127.0.0.1` → `country: null`, one `geo:miss` log line. Load test HTML with `data-mode="signal"`; DevTools Network shows v2 body including `screen/lang/tz`. Deploy without `MAXMIND_LICENSE_KEY` → `deploy.ts` errors fast (fail-fast rule).

**Smoke — commit 4.**
Seed 6 events from one IP: 5 within 10 minutes, then 2 45-minutes later. Trigger `/api/daily`. Read the `site_yyyymmdd_device` partition: `visitors=1, sessions=2, bounces=0` (neither session has length 1). Single-event day → `bounces=1`. `/api/summary?days=1` returns `totals.visitors: 1, totals.sessions: 2, totals.bounces: 0, countries: [{ country: '…', visitors: 1, … }]`. Dashboard shows three new tiles + a Top countries card. After the daily run, `salts` table contains rows only for today and yesterday.

**Automated.**
Extend existing unit tests for `buildSummary` (parameterize over the new counters and countries field). Add a focused unit test for the session derivation (given a sorted ts list and a gap threshold, assert session count and bounce count).

## Out of scope for v1 (deferred)

**Engineering deferrals.** Region/city geo; dwell time; per-path sessions/bounces; compound rollups involving visitor × (path/referrer/country); per-site mode config (one Function App = one mode); `/api/privacy/access` & DSAR endpoints (the unlinkability-after-24h design is the defence); `/api/salt` admin / force-rotate endpoint; UA-language fallback for country; session stitching across UTC day boundaries (a visitor crossing midnight is two visitors by design).

**Product / legal deferrals (per the build-it-don't-ship-it posture).** Flipping plankit.com production from `signalsMode: 'counter'` to `'signal'`; DPIA publication; customer-facing privacy-policy boilerplate; Article 11 DSAR runbook; any landing-page change beyond the existing "(in development)" copy. These activate only when a real customer requests Signal mode — at which point the code is already proven, only the docs need to ship.
