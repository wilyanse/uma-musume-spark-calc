import { describe, expect, it } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { renderToString } from 'react-dom/server';
import { routes } from '../src/router.tsx';
import { dataUrl } from '../src/api/client.ts';
import { isFixtureMode } from '../src/api/mode.ts';
import { engineApi } from '../src/workers/engine.api.ts';

describe('router', () => {
  it('declares every route from 60 §2', () => {
    const children = routes[0]?.children?.map((c) => c.path ?? 'index');
    expect(children).toEqual([
      'index',
      'roster',
      'veterans/:id',
      'review',
      'cards',
      'targets',
      'targets/:id',
      'planner',
      'health',
    ]);
  });

  it('renders a placeholder for /planner', () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/planner'] });
    const html = renderToString(<RouterProvider router={router} />);
    expect(html).toContain('<h1>Planner</h1>');
  });
});

describe('fixture-mode switch', () => {
  it('only VITE_FIXTURES=1 enables it', () => {
    expect(isFixtureMode('1')).toBe(true);
    expect(isFixtureMode('0')).toBe(false);
    expect(isFixtureMode(undefined)).toBe(false);
  });

  it('maps API paths to fixture files in fixture mode', () => {
    expect(dataUrl('roster', true)).toBe('/fixtures/roster.json');
    expect(dataUrl('roster', false)).toBe('/api/v1/roster');
  });
});

describe('engine stub', () => {
  it('answers ping', () => {
    expect(engineApi.ping('x')).toBe('pong:x');
  });
});
