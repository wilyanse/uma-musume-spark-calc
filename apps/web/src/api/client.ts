import type { HealthResponse } from '@uma/schema';
import { FIXTURE_MODE } from './mode.ts';

export function dataUrl(path: string, fixtures = FIXTURE_MODE): string {
  // Fixture files are named after the last path segment, e.g. /api/v1/roster -> /fixtures/roster.json
  return fixtures ? `/fixtures/${path.split('/').pop()}.json` : `/api/v1/${path}`;
}

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(dataUrl(path), { credentials: 'include' });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const getHealth = () => getJson<HealthResponse>('health');
