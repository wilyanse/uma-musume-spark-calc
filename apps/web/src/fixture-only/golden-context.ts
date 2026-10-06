/**
 * Fixture-mode-only: T08's `loadGoldenContext` (SYNTHETIC golden rules overrides). A production
 * build resolves this module to `golden-context.disabled.ts` (vite.config.ts `fixtureOnly`), so the
 * worker bundle never contains it (T13 review r1 N3).
 */
// Browser-safe by design (its import-graph test forbids node:*); not part of the package exports.
import { loadGoldenContext } from '../../../../packages/engine/scripts/golden-context.ts';

export const goldenContextLoader: typeof loadGoldenContext | null = loadGoldenContext;
