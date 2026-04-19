# CLAUDE.md

IMPORTANT: Follow these rules at all times.

## Critical Rules

- NEVER take shortcuts without asking — STOP, ASK, WAIT for approval.
- NEVER force push — make a new commit to fix mistakes.
- NEVER commit secrets to version control.
- Only do what was asked — no scope creep.
- Understand existing code before changing it.
- If you don't know, say so — never guess.
- Test before and after every change.
- Surface errors clearly — no silent fallbacks.

## Project Conventions

### Stack

- **TypeScript** — `packages/*` workspaces (`@signals/beacon`, `@signals/functions`, `@signals/dashboard`, `@signals/shared`). Managed with pnpm workspaces (pnpm@10 via Corepack).
- **Go** — `cmd/sig/` (CLI binary) plus `internal/*`. Single Go module rooted at `github.com/markwharton/signals`.
- **Bicep** — `infra/` (Azure SWA + Tables + Key Vault + Logic App). Deployed via `az deployment group create`.

### Branches

- Develop on `develop`; never commit directly to `main`.
- `pk release` merges `develop` into `main` and pushes both.
- `pk guard` protects `main` from direct mutations.

### Versioning & Changelog

- Single version track across all workspaces. Semantic tags (`vMAJOR.MINOR.PATCH`). Baseline: `v0.0.0`.
- `pk changelog` pre-commit hook stamps every `packages/**/package.json` to match the tag and stages the updated lockfile.
- `pk release` pre-release hook runs `pnpm install --frozen-lockfile`, then lint/test/build across TS workspaces, plus `go test -race ./...`.
- `pk changelog` uses default commit types (`feat`, `fix`, `deprecate`, `revert`, `security`, `refactor`, `perf`, `docs`, `chore`, `test`, `build`, `ci`, `style`).

### Commands

- `pnpm build` / `pnpm test` / `pnpm lint` — recursive across TS workspaces.
- `go test -race ./...` — Go tests.
- `pnpm run deploy` — build dashboard + functions, bundle with `pnpm deploy --prod`, upload via `swa deploy`.
- `pnpm run deploy:infra` — `az deployment group create` against `infra/main.bicep`.
- `pnpm run generate:api-key -- <scope> <source-id>` — mint a `pk_{scope}_{hex}` key.

### Architecture constraints (easy to get wrong)

- **Never use SWA's Oryx auto-build for Functions.** It doesn't understand pnpm workspaces. Build locally/CI and upload with `swa deploy` pointed at `pnpm deploy --prod` output.
- **Region split:** `australiaeast` for Storage/KV/Functions/Logic App; `eastasia` for SWA (no AU region available). Platform constraint, not a preference.
- **Single-tenant:** `SIGNALS_SITE_ID=plankit.com`. Not multi-tenant.
- **API keys:** `pk_{scope}_{hex}` raw, stored as `sourceId:sha256:{hex}` comma-separated env entries, compared with `timingSafeEqual`. Scopes: `daily`, `mcp`.
- **CAF naming:** `st{app}{suffix}` (Storage), `stapp-`, `appi-`, `log-`, `kv-`, `logic-`. Environment lives in the RG name (`rg-signals-{env}`) only.

### Reference

- `brief.md` — full architectural rationale and phase-by-phase build order (Phase 1 = infra + scripts + CI).
