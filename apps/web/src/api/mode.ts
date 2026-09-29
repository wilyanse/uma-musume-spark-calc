/** `VITE_FIXTURES=1` serves data from `apps/web/fixtures/*.json` instead of the API (60 §3). */
export const FIXTURE_MODE = import.meta.env.VITE_FIXTURES === '1';

export function isFixtureMode(value: string | undefined): boolean {
  return value === '1';
}
