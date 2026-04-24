# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [v0.7.0] - 2026-04-24

### Added

- add v2 wire format, mode gate, DNT/GPC (21f8609)
- add visitor hashing with daily-rotated salt (3c86091)
- add GeoLite2 country lookup and signal-mode beacon (a138830)
- derive sessions/bounces/visitors and per-country rollup (2ff2137)

### Documentation

- document MAXMIND_LICENSE_KEY in scripts/.env.example (9eb79be)

### Maintenance

- add parameters.dev.json for signal-mode test deploys (3d00cbb)
- update managed files for v0.14.1 (f95333d)

## [v0.6.0] - 2026-04-22

### Added

- operator-managed multi-tenant via SIGNALS_SITES allowlist (f94cfd8)
- add monthly rollup tier for long summary windows (60f8eb8)

### Fixed

- abort in-flight summary fetch on timespan change (ba9460b)

### Changed

- parallelize summary read path (2b7d0d1)

### Documentation

- hosting-review update + SAS-window deploy trap (1f2a012)
- update architecture-choices to reflect reverted Flex Consumption pivot (2bbbdca)

### Maintenance

- bump SWA Managed Functions runtime Node 20 → 22 (1626beb)
- regenerate pk-managed files for v0.13.0 (36e1373)

## [v0.5.0] - 2026-04-21

### Added

- shared authenticateAdmin helper for dual-path auth (c3d9bfd)
- /api/summary accepts both principal and API key auth (181d37f)
- admin api-key scope + ADMIN_API_KEYS wiring (7dd42fd)
- /api/mcp endpoint (stateless JSON-RPC) (b6fd6ce)
- sig Go binary — scaffold, config, seven subcommands (2a944b0)
- force-rollup via ?date + ?days query params (e81a0ce)

### Fixed

- relax MCP signals_summary days schema to match server (c6bc787)

### Changed

- rename sig today to sig day (5d9b40c)

### Documentation

- document raw client keys + alphabetize .env.example (317dfc3)
- curl smoke tests for each endpoint (70b402b)
- list per-OS config paths in sig --help and .env.example (bb46ac7)

### Maintenance

- drop budget to $10; expand operations doc (8175a5a)
- restore go test -race in preRelease now that Go code exists (0fd7c91)
- build go binary matrix + gh release on v* tag (59034d0)
- extend raw event retention 7 -> 30 days (3dafceb)

## [v0.4.0] - 2026-04-20

### Added

- scaffold Vite + React + TS + shadcn/ui + Tailwind (ffd0111)
- github auth + signals_admin role gate (7c0fdb1)
- add /api/summary endpoint reading rollups (7fb1062)
- set GITHUB_CLIENT_ID/SECRET via bicep (20205fe)
- six tiles + sparkline + responsive grid + toggles (ee0e61f)
- dark mode with persisted preference (726e141)

### Removed

- rewind to SWA Managed Functions + Logic App (Timekeeper pattern) (f6e7179)
- storage via connection string; /api/daily as HTTP trigger (edd9b8a)
- swa --api-location; daily api keys; summary behind signals_admin (f21874a)

### Documentation

- add .env.example template for deploy-infra secrets (f7c0fcc)

## [v0.3.0] - 2026-04-20

### Added

- use isbot library for bot detection (4511a6d)
- accept and store isBot field in collect handler (33b5e31)
- detect bots via isbot, switch to esbuild bundle (b04c3c9)
- add rollup types and partition-key builders (361fb69)
- add daily timer-triggered rollup function (916d5e0)

### Documentation

- capture hosting decision triggers (cdf7ce9)

### Maintenance

- remove Logic App resource (timer trigger replaces it) (dedc80a)

## [v0.2.0] - 2026-04-20

### Added

- add NotFoundEvent to discriminated union (54ebdb3)
- accept 404 kind in collect validator (d53c8d1)
- support data-kind attribute (pageview | 404) (9ad4326)
- cache beacon.js for 1 day with stale-while-revalidate (2aedb07)

## [v0.1.0] - 2026-04-19

### Added

- azure flex consumption function app (4f4c712)
- event types and partition-key builders (f5730df)
- counter-mode pageview tracking script (b9e7e4a)
- /api/collect with managed-identity table auth (f66dfd4)
- deploy pipeline for static + function app (1e5b7be)
- tighten function app cors + document the pivot (9f6fcfe)
- monthly cost budget with threshold alerts (0699df3)

### Fixed

- correct --if-present placement in pnpm release hook (55f61a1)
- drop go test from preRelease until phase 5 ships go code (7d05c3c)

### Documentation

- add project conventions from /init (b815fe8)
- capture azure debugging techniques as a project rule (f699631)
- explain why same-origin referrers map to null (1c95c3e)

### Maintenance

- initial pk setup with baseline (f8902ef)
- add .gitignore (f4dd3e4)
- pk tooling setup (abe3f11)
- scaffold signals monorepo (3f1a4ad)

[v0.1.0]: https://github.com/markwharton/signals/compare/v0.0.0...v0.1.0
[v0.2.0]: https://github.com/markwharton/signals/compare/v0.1.0...v0.2.0
[v0.3.0]: https://github.com/markwharton/signals/compare/v0.2.0...v0.3.0
[v0.4.0]: https://github.com/markwharton/signals/compare/v0.3.0...v0.4.0
[v0.5.0]: https://github.com/markwharton/signals/compare/v0.4.0...v0.5.0
[v0.6.0]: https://github.com/markwharton/signals/compare/v0.5.0...v0.6.0
[v0.7.0]: https://github.com/markwharton/signals/compare/v0.6.0...v0.7.0
