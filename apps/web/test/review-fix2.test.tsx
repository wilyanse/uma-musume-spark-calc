// Round-2 same-task regressions. MOCK DataSource, published SYNTHETIC roster, no live API.
import { describe, expect, it } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import type { ReviewItem, RosterVeteranDetail } from '@uma/schema';
import { HttpError } from '../src/api/errors.ts';
import { mockSource, renderRoute } from './harness.tsx';
import { goldenRoster } from './fixtures.ts';

const roster = goldenRoster();
const v = roster[0]!;
const detail: RosterVeteranDetail = { ...v, trainMode: 'independent', fields: [] };
const item = (id = 'first', path = '/stats/gut'): ReviewItem => ({
  id, path, veteranId: v.id, status: 'open', resolvedValue: null, resolvedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z', cropKey: null,
  field: { path, rawText: 'MOCK', value: 559, confidence: 0.4, status: 'low_confidence',
    candidates: [{ value: 559, score: 0.9 }], cropKey: null },
});
function doubleKey() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
}
function doubleClick(el: HTMLElement) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

describe('Review synchronous submission guard', () => {
  it('leaving and returning while pending creates an unlocked screen; old error cannot paint the new screen', async () => {
    let fail!: (e: Error) => void;
    let sends = 0;
    let open = [item()];
    const { src } = mockSource({ roster }, {
      reviewItems: async (s) => s === 'open' ? open : [],
      resolveReviewItem: async () => {
        sends++;
        if (sends === 1) return new Promise((_resolve, reject) => { fail = reject; });
        open = [];
        return { ...item(), status: 'resolved' };
      },
    });
    const { router } = renderRoute('/review', src);
    await screen.findByText('/stats/gut');
    act(doubleKey);
    await waitFor(() => expect(sends).toBe(1));
    await act(async () => { await router.navigate('/cards'); });
    await act(async () => { await router.navigate('/review'); });
    await screen.findByText('/stats/gut');
    act(doubleKey);
    await screen.findByText(/Nothing to review/);
    expect(sends).toBe(2);
    await act(async () => fail(new HttpError(409, { detail: 'Late stale error' }, 'POST')));
    expect(screen.queryByRole('alert')).toBeNull();
  });
  for (const input of ['keydown', 'click'] as const) {
    it(`two ${input} dispatches in one JS task send once; success has no stale alert; next item unlocks`, async () => {
      let open = [item(), item('second', '/stats/wit')];
      let sends = 0;
      const { src } = mockSource({ roster }, {
        reviewItems: async (s) => s === 'open' ? open : [],
        resolveReviewItem: async (id) => {
          sends++;
          const found = open.find((x) => x.id === id);
          if (!found) throw new HttpError(409, { detail: 'Already resolved' }, 'POST');
          open = open.filter((x) => x.id !== id);
          return { ...found, status: 'resolved' };
        },
      });
      renderRoute('/review', src);
      await screen.findByText('/stats/gut');
      act(() => input === 'keydown' ? doubleKey() : doubleClick(screen.getByRole('button', { name: /^Apply/ })));
      await screen.findByText('/stats/wit');
      await screen.findByRole('status');
      expect(sends).toBe(1);
      expect(screen.queryByRole('alert')).toBeNull();
      act(doubleKey);
      await screen.findByText(/Nothing to review/);
      expect(sends).toBe(2);
      expect(screen.queryByRole('alert')).toBeNull();
    });
  }
  for (const status of [500, 404, 409]) {
    it(`${status} unlocks retry and retains legitimate error until the next submission`, async () => {
      let sends = 0;
      let open = [item()];
      const { src } = mockSource({ roster }, {
        reviewItems: async (s) => s === 'open' ? open : [],
        resolveReviewItem: async () => {
          sends++;
          if (sends === 1) throw new HttpError(status, { detail: 'Changed elsewhere' }, 'POST');
          open = [];
          return { ...item(), status: 'resolved' };
        },
      });
      renderRoute('/review', src);
      await screen.findByText('/stats/gut');
      act(doubleKey);
      await screen.findByRole('alert');
      await waitFor(() => expect((screen.getByRole('button', { name: /^Apply/ }) as HTMLButtonElement).disabled).toBe(false));
      expect(sends).toBe(1);
      if (status !== 500) expect(screen.getByRole('alert').textContent).toContain('The queue was refreshed.');
      act(doubleKey);
      await screen.findByText(/Nothing to review/);
      expect(sends).toBe(2);
      expect(screen.queryByRole('alert')).toBeNull();
    });
  }
  it('item-panel change during a deferred submission does not lock the new item after settle', async () => {
    let finish!: (r: ReviewItem) => void;
    let sends = 0;
    const open = [item(), item('second', '/stats/wit')];
    const { src } = mockSource({ roster, open }, {
      resolveReviewItem: async (id) => { sends++; return sends === 1 ? new Promise((r) => { finish = r; }) : { ...item(id), status: 'resolved' }; },
    });
    renderRoute('/review', src);
    await screen.findByText('/stats/gut');
    act(doubleKey);
    await waitFor(() => expect(sends).toBe(1));
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true })));
    await screen.findByText('/stats/wit');
    act(doubleKey);
    expect(sends).toBe(1);
    await act(async () => finish({ ...item(), status: 'resolved' }));
    await waitFor(() => expect((screen.getByRole('button', { name: /^Apply/ }) as HTMLButtonElement).disabled).toBe(false));
    act(doubleKey);
    await waitFor(() => expect(sends).toBe(2));
  });
});

describe('Veteran synchronous mode guard', () => {
  it('two same-task change callbacks send once; error rolls back and unlocks retry', async () => {
    let sends = 0;
    let fail!: (e: Error) => void;
    let saved = detail;
    const { src } = mockSource({ roster }, {
      veteran: async () => saved,
      patchVeteran: async (_id, body) => {
        sends++;
        if (sends === 1) return new Promise((_r, reject) => { fail = reject; });
        saved = { ...detail, ...body, modeSource: 'override' };
        return saved;
      },
    });
    renderRoute(`/veterans/${v.id}`, src);
    const radio = await screen.findByRole('radio', { name: 'Manual' });
    // React restores the controlled checked value synchronously; force two genuine change events
    // without letting its external mutation-store subscription render between them.
    act(() => { doubleClick(radio); });
    await waitFor(() => expect(sends).toBe(1));
    await act(async () => fail(new HttpError(500, null, 'PATCH')));
    await screen.findByRole('alert');
    await waitFor(() => expect((radio as HTMLInputElement).disabled).toBe(false));
    expect((screen.getByRole('radio', { name: 'Independent' }) as HTMLInputElement).checked).toBe(true);
    act(() => doubleClick(radio));
    await waitFor(() => expect(sends).toBe(2));
    await waitFor(() => expect((screen.getByRole('radio', { name: 'Manual' }) as HTMLInputElement).disabled).toBe(false));
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('navigation to another veteran while pending creates an unlocked panel; old settle does not lock it', async () => {
    let finish!: (r: RosterVeteranDetail) => void;
    const other = roster[1]!;
    const saved = { ...other, fields: [], trainMode: 'independent' as const };
    const sends: string[] = [];
    const { src } = mockSource({ roster }, {
      veteran: async (id) => id === v.id ? detail : saved,
      patchVeteran: async (id, body) => { sends.push(id); return id === v.id ? new Promise((r) => { finish = r; }) : { ...saved, ...body }; },
    });
    const { router, unmount } = renderRoute(`/veterans/${v.id}`, src);
    const first = await screen.findByRole('radio', { name: 'Manual' });
    act(() => doubleClick(first));
    await waitFor(() => expect(sends).toEqual([v.id]));
    await act(async () => { await router.navigate(`/veterans/${other.id}`); });
    await waitFor(() => expect((screen.getByRole('radio', { name: 'Manual' }) as HTMLInputElement).disabled).toBe(false));
    act(() => doubleClick(screen.getByRole('radio', { name: 'Manual' })));
    await waitFor(() => expect(sends).toEqual([v.id, other.id]));
    unmount();
    await act(async () => finish({ ...detail, trainMode: 'manual' }));
  });
});
