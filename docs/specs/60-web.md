# 60 — Web app

Owner task: **T13** (screens). T02 creates the app skeleton. Folder: `apps/web`.

## 1. Stack
- React 19 + Vite + TypeScript, with React Router (data routers) and TanStack Query for the API cache.
- Styling: CSS variables generated from `docs/design/tokens.json` (`pnpm --filter web tokens`) + CSS Modules. No UI kit; build the components from `docs/design/components.md`.
- Charts: lightweight SVG components (bars with p10–p90 whiskers, scatter). No chart library unless it's under 40 kB gzip.
- Engine: `src/workers/engine.worker.ts` via Comlink. Master data comes from `/master/latest.json` → versioned files, cached with the Cache API.
- API client: typed with `@uma/schema` types, `fetch` with `credentials: 'include'` (the Access cookie).

## 2. Screens
Build S01–S07 exactly as in `docs/design/` and `docs/design/bindings.md`. Routes: `/roster`, `/veterans/:id`, `/review`, `/cards`, `/targets`, `/targets/:id`, `/planner`, `/health`.

## 3. Behaviour
- **Roster:** load `/api/v1/roster` once with the ETag, then filter and sort client-side.
- **Mode override:** use `PATCH` with an optimistic update.
- **Review:** resolving an item invalidates the roster and review queries.
- **Planner:**
  - When the roster ETag or master version changes, or no snapshot exists, the worker fits the model (`fitTrainingModel`) and stores it via `POST /model-snapshots`.
  - Otherwise, the latest snapshot is loaded.
  - Ranking runs in the worker with a progress bar and is cancellable.
- **Health:** shows snapshot metrics; the "Run calibration" action calls `calibrateRules` in the worker.
- **Fixture mode:** `VITE_FIXTURES=1` serves the roster etc. from `apps/web/fixtures/*.json` (golden dataset, 70 §2), so the UI works without the API.

## 4. Acceptance (T13)
- Vitest + Testing Library tests per screen cover render, empty, loading and error states. A Playwright smoke test in fixture mode walks Roster → Veteran → Planner → ranking completes → expand the top pair.
- `pnpm --filter web build` produces the main bundle ≤ 250 kB gzip, excluding the worker chunk; record the size in the changelog.
- axe-core (via Playwright) reports no serious or critical violations on S01, S03 and S06 in both themes.
- Screens visibly match the approved design (H5). Include screenshots from Playwright under `docs/changelog/assets/T13/`.
