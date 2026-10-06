/** Production stand-in for `golden-context.ts` (see vite.config.ts `fixtureOnly`). */
import type { goldenContextLoader as Real } from './golden-context.ts';

export const goldenContextLoader: typeof Real = null;
