# Changelog

The orchestrator adds one line per merged task. Details are in `docs/changelog/Txx-*.md`.

## Unreleased
- Specs, architecture and OCR feasibility spike (initial commit).
- T01: pnpm monorepo, `@uma/schema` zod contracts + JSON Schema export, fingerprint + 7 cross-language vectors, empty .NET solution. Review PASS r1.
- T02: Hono Worker skeleton (health, D1/R2/assets bindings) + React/Vite SPA skeleton (routes, Comlink engine worker stub, fixture switch). Review PASS r1.
- T01b: contract hardening: per-owner spark flag, ULID ids, unique card sync, ajv-validated JSON Schemas, `checkMasterIds`, `CAPTURE_RULES` / `OWNED_CARDS_SYNC_RULES` descriptors. Review CHANGES_REQUESTED r1 → PASS r2.
