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

### Branches

- Develop on `develop`; never commit directly to `main`.
- `pk release` merges `develop` into `main` and pushes both.
- `pk guard` protects `main` from direct mutations.

### Versioning & Changelog

- Semantic version tags (`vMAJOR.MINOR.PATCH`). Baseline tag: `v0.0.0`.
- `pk changelog` uses default commit types (`feat`, `fix`, `deprecate`, `revert`, `security`, `refactor`, `perf`, `docs`, `chore`, `test`, `build`, `ci`, `style`).

### Toolchain (provisional)

- `.gitignore` reserves `dist/` and `coverage.out`, suggesting a Go project. Language, build, and test commands are not yet chosen — update this section when the first source files land.
