# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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
