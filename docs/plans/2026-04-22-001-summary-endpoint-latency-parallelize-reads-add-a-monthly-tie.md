# Summary endpoint latency: parallelize reads, add a monthly tier

## Context

The dashboard works for 7 days (4.3s), struggles at 30 (12.8s), and returns 500 on "All" (~45s timeout). Screenshot confirms four serial `/api/summary` fetches as the user cycled tabs.

**The partitioning model is not wrong, and SQL is not the fix.** Rollups are already pre-aggregated per `(site, yyyymmdd, dimension)` and the summary endpoint reads only the rollups table — it never touches raw events. The latency comes from how the code reads, not how the data is shaped.

**Root cause** — `packages/functions/src/shared/summaryQuery.ts:71` iterates days sequentially, and within each day the three `for await` blocks at `:75`, `:87`, `:97` each block the next. At a measured ~150–200 ms per partition query:

| Window  | Queries (days × 3) | Wall-clock      |
| ------- | -----------------: | --------------: |
| 7 days  |                 21 | ~4 s            |
| 30 days |                 90 | ~13 s           |
| All     |            1 095  | ~45 s → timeout |

Matches the screenshot exactly.

**Why not SQL.** Azure SQL / Postgres would make the query `SELECT ... GROUP BY dim, value WHERE date BETWEEN` — elegant, but buys nothing the current model can't do. Costs are real: new Azure resource (~$15–50/mo minimum vs pennies for Tables), schema migration + backfill, connection-pool concerns under SWA Managed Functions, and CLAUDE.md's region-split / managed-identity constraints apply again. The data is small; the read code is the bottleneck. Fix the read code.

## Recommended approach

Three commits: read-path parallelism, monthly rollup tier, client-side abort. Step 1 alone likely rescues all three windows; step 2 is the durable fix so this doesn't reappear at 2+ years of history; step 3 cleans up the wasted-request pattern visible in the screenshot.

### Step 1 — Parallelize the day loop (the urgent fix)

File: `packages/functions/src/shared/summaryQuery.ts` (`buildSummary`, lines 55–156).

Change the `for (day of days)` loop that serially awaits three partition queries into:

- Build the day list once (no I/O).
- Run all `days × 3` partition reads concurrently with a bounded-concurrency pool (cap ~20 in-flight).
- Each task returns a typed `{ date, dim, counters: Array }` tuple; merge into the three existing accumulators (`pathTotals`, `referrerTotals`, `device`) and the `sparkline` after all tasks resolve.
- `sparkline` ordering is reconstructed from the day list, not the completion order.

Expected wall-clock for "All" drops from ~45 s (sum) to roughly `ceil(1095/20) × ~200 ms` ≈ **~11 s**, and for 30 days to ~1 s. Good enough to ship, and if it's not, the concurrency cap is one number to raise.

No schema change, no new table, no new endpoint. Lightweight concurrency limiter written inline (~15 lines) — don't pull `p-limit` just for this.

### Step 2 — Monthly rollup tier (the durable fix)

The right way to avoid a 365-query fan-out is to aggregate once at write-time. Add a monthly tier the daily rollup maintains, and teach the reader to pick the coarsest tier that covers the window.

**Schema.** New partition naming in the existing `rollups` table (no new Azure resource):

- Monthly PK: `${site}_${yyyymm}_${dim}_m` — the `_m` suffix keeps it in the same table but distinct from daily.
- RowKey: same as the daily row (URL-encoded path / referrer host / device label).
- Fields: same four counters.

Add `rollupMonthlyPartitionKey(site, date, dim)` next to `rollupPartitionKey` in `packages/shared/src/rollup.ts` — one function, one type union tweak.

**Writer** (`packages/functions/src/daily/index.ts`, `rollupDay`, lines 223–305).
After the per-day upsert, rebuild the month-to-date from scratch by reading the daily partitions:

- For the target date's `yyyymm`, read every existing daily partition for days 01..today-of-month × 3 dimensions (path, referrer, device) — concurrent.
- Accumulate into three in-memory maps, one per dimension: `Map<rowKey, Counts>` where `Counts = { pageviews, notFounds, botPageviews, botNotFounds }`. Bot traffic is carried as two of those four counter columns on every row — **not a separate dimension** — so each map already preserves human vs bot for each path/referrer/device value. No fourth map needed.
- Upsert the resulting rows into the `_m` partitions, using `Replace` semantics so a re-rolled day propagates correctly.
- Delete monthly row keys that no longer appear (a path that 404'd on day 3 but was then fixed shouldn't linger forever) — collect the "before" row-key set from the read, diff against "after", delete the orphans.

~93 reads per rollup (3 dims × up to 31 days). Fully idempotent, no state row, self-heals on re-roll — worth the read overhead for the simpler failure model. Runs inside the existing `rollupDay` after the daily upsert block so a partial failure doesn't leave an inconsistent monthly view (daily is still the source of truth).

**Reader** (`buildSummary`).
Partition the requested window into (a) a set of full UTC months and (b) ≤ 2 daily tails at each edge. Query:

- 3 × `fullMonths` partition queries from the `_m` tier.
- 3 × `tailDays` partition queries from the daily tier.
- Everything concurrent (step 1's pool still applies).

For "All" (365 days) this is **~36 partition queries** instead of 1 095. Sparkline still built from daily rows only — month rows don't need per-day granularity.

**Today-coverage stays unchanged.** The daily rollup runs at 17:00 UTC for the day just ended; today isn't covered. That invariant holds at every tier.

### Step 3 — Client-side abort on window change

File: `packages/dashboard/src/hooks/useSummary.ts` (lines 17–46) and `packages/dashboard/src/lib/api.ts` (lines 10–20).

The screenshot shows four parallel `/api/summary` fetches because toggling tabs starts a new fetch before the previous one completes. The hook's `cancelled` flag only prevents state updates — the HTTP request keeps running and ties up a Function invocation.

- `fetchSummary` takes a second arg `signal: AbortSignal`, passes it to `fetch`.
- `useSummary` creates an `AbortController` per effect, aborts in the cleanup, passes the signal through.
- Swallow `AbortError` in the `.catch` (don't surface as an error to the UI).

Five-line change, independent of steps 1–2, but worth folding into the same PR since the screenshot shows the problem.

## Critical files

- `packages/functions/src/shared/summaryQuery.ts` — read path (step 1 + step 2 reader).
- `packages/functions/src/daily/index.ts` — write path (step 2 writer, inside `rollupDay`).
- `packages/shared/src/rollup.ts` — add `rollupMonthlyPartitionKey` and extend the dimension/key helpers.
- `packages/dashboard/src/hooks/useSummary.ts` + `packages/dashboard/src/lib/api.ts` — step 3 abort plumbing.
- `packages/functions/src/mcp/*` (if it also calls `buildSummary`) — no change; it rides the read-path fix for free.

## Not in scope (awareness only)

- **Response caching.** Rollups change once a day at 17:00 UTC, so a 5-minute in-memory cache would be effectively free. Worth adding only if steps 1 + 2 don't land "All" under ~2 s.
- **`pathxreferrer` rollup reader.** Written daily but unread — reserved for a later drill-down view. Leave alone.

## Verification

**Automated.** Unit tests for `buildSummary` already drive mock rollup data (confirm). Add tests for: (a) concurrency doesn't change the aggregated result across days/dims, (b) monthly+daily reader returns the same counters as daily-only reader over the same window — parameterize the existing tests over both paths.

**Smoke — step 1 alone.**
1. Deploy to dev (`pnpm run deploy`).
2. In the dashboard, click 7 → 30 → All in sequence with the network panel open.
3. Expect: all three `/api/summary` requests return 200. "All" should land under ~15 s; flag for investigation if not.

**Smoke — step 2.**
1. Run `pnpm run rollup -- --days 30` against a staged environment to populate monthly rows for the last 30 days.
2. Compare `/api/summary?days=30` response against the same response with the monthly path force-disabled via a temp flag (delete the flag before merge). Counters must match exactly.
3. Validate "All" < 3 s.

**Smoke — step 3.**
1. Open the dashboard, DevTools Network, throttle to Slow 3G.
2. Rapidly click 7 → 30 → All → 7 within ~1 s.
3. Expect: earlier requests show as `(canceled)` in the network panel, only the final selection's response updates the UI, no "Failed to load" flash from an aborted request.
