/**
 * T13 review round 1 regressions (B1, S1, S3, S4, N2) against a MOCK DataSource (in-memory, no
 * network) with the real published master data. Real-API checks of the same flows are recorded
 * separately in the changelog (local `wrangler dev`, not live Cloudflare).
 */
import { describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReviewItem, RosterVeteranDetail } from '@uma/schema';
import { HttpError } from '../src/api/errors.ts';
import { qk } from '../src/app/queries.ts';
import { resolutionFor, searchVocab } from '../src/lib/paths.ts';
import { mockSource, renderRoute } from './harness.tsx';
import { goldenRoster, masterData } from './fixtures.ts';

const roster = goldenRoster();
const v0 = roster[0]!;
const m = masterData();
const whiteIdx = v0.sparks.findIndex((s) => s.type === 'white');
const blueIdx = v0.sparks.findIndex((s) => s.type === 'blue');

const item = (path: string, over: Partial<ReviewItem['field']> = {}, id = '01KGQZ0000G01DENCM0000RV11'): ReviewItem => ({
  id,
  veteranId: v0.id,
  path,
  status: 'open',
  resolvedValue: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  resolvedAt: null,
  field: { path, rawText: 'OCR', value: null, confidence: 0.4, status: 'low_confidence', candidates: [], cropKey: null, ...over },
  cropKey: null,
});

describe('resolutionFor / searchVocab (paths)', () => {
  it('epithet leaves resolve to the vocabulary TEXT, not its id (B1)', () => {
    const r = resolutionFor('/epithet', v0);
    expect(r).toMatchObject({ vocab: 'epithet', value: 'text' });
    const hits = searchVocab('independent learner', r, m, v0);
    expect(hits[0]).toMatchObject({ label: 'Independent Learner', value: 'Independent Learner' });
    expect(hits.every((h) => typeof h.value === 'string' && !String(h.value).startsWith('epithet:'))).toBe(true);
  });
  it('ID leaves keep sending IDs (character, outfit, skill, spark, scenario)', () => {
    expect(resolutionFor('/characterId', v0)).toMatchObject({ vocab: 'character', value: 'id' });
    expect(resolutionFor('/outfitId', v0)).toMatchObject({ vocab: 'outfit', value: 'id' });
    expect(resolutionFor('/parents/0/characterId', v0)).toMatchObject({ vocab: 'character', value: 'id' });
    expect(resolutionFor('/parents/1/outfitId', v0)).toMatchObject({ vocab: 'outfit', value: 'id' });
    expect(resolutionFor('/skills/0/skillId', v0)).toMatchObject({ vocab: 'skill', value: 'id' });
    expect(resolutionFor('/scenarioId', v0)).toMatchObject({ vocab: 'scenario', value: 'id' });
    const char = searchVocab(m.characters.get(v0.characterId)!.name, resolutionFor('/characterId', v0), m, v0);
    expect(char[0]!.value).toBe(v0.characterId);
  });
  it('spark vocabulary only for the sparkId leaf, filtered by the slot type (S4)', () => {
    const p = `/sparks/${whiteIdx}/sparkId`;
    const r = resolutionFor(p, v0);
    expect(r).toMatchObject({ vocab: 'spark', value: 'id', sparkType: 'white' });
    // "Speed" exists as a blue spark: a white slot must not offer it.
    const blueSpeed = m.bundle.sparks.find((s) => s.type === 'blue')!;
    const hits = searchVocab(blueSpeed.name.slice(0, 4), r, m, v0);
    expect(hits.every((h) => m.sparks.get(h.value as string)?.type === 'white')).toBe(true);
    const blueHits = searchVocab(blueSpeed.name, resolutionFor(`/sparks/${blueIdx}/sparkId`, v0), m, v0);
    expect(blueHits.map((h) => h.value)).toContain(blueSpeed.id);
    expect(blueHits.every((h) => m.sparks.get(h.value as string)?.type === 'blue')).toBe(true);
  });
  it('stars are numeric with no vocabulary; immutable leaves are never correctable', () => {
    expect(resolutionFor(`/sparks/${whiteIdx}/stars`, v0)).toMatchObject({ vocab: null, value: 'number', min: 1, max: 3 });
    expect(searchVocab('speed', resolutionFor(`/sparks/${whiteIdx}/stars`, v0), m, v0)).toEqual([]);
    for (const p of [`/sparks/${whiteIdx}/type`, `/sparks/${whiteIdx}/owner`, '/deck/0/slot', '/parents/0/slot', '/trainMode', '/sparks', '/deck/0'])
      expect(resolutionFor(p, v0).value, p).toBe('none');
  });
  it('free-text leaves without vocabulary (rank, guest trainer) and numeric leaves', () => {
    expect(resolutionFor('/rank', v0)).toMatchObject({ vocab: null, value: 'text' });
    expect(resolutionFor('/parents/0/guestTrainer', v0)).toMatchObject({ vocab: null, value: 'text' });
    expect(resolutionFor('/stats/spd', v0)).toMatchObject({ vocab: null, value: 'number' });
    expect(resolutionFor('/deck/2/lb', v0)).toMatchObject({ value: 'number', min: 0, max: 4 });
  });
});

describe('S03 resolution values (B1, S4)', () => {
  it('epithet search → POST body is the exact epithet text', async () => {
    const it0 = item('/epithet', { rawText: 'Indep. Lrnr', value: 'Trickster' });
    const { src, calls } = mockSource({ roster, open: [it0] });
    renderRoute('/review', src);
    await screen.findByText('/epithet');
    await userEvent.type(screen.getByRole('combobox', { name: 'None of these? Search the game vocabulary' }), 'Independent');
    await userEvent.click(await screen.findByRole('option', { name: /Independent Learner/ }));
    await userEvent.click(screen.getByRole('button', { name: /^Apply “Independent Learner”/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'resolveReviewItem')).toBe(true));
    expect(calls.find((c) => c.method === 'resolveReviewItem')!.args).toEqual([it0.id, 'Independent Learner']);
  });
  it('a white spark slot only lists white sparks; stars offer no vocabulary', async () => {
    const it0 = item(`/sparks/${whiteIdx}/sparkId`, { value: v0.sparks[whiteIdx]!.sparkId });
    const blue = m.bundle.sparks.find((s) => s.type === 'blue')!;
    const a = renderRoute('/review', mockSource({ roster, open: [it0] }).src);
    await screen.findByText(it0.path);
    await userEvent.type(screen.getByRole('combobox', { name: 'None of these? Search the game vocabulary' }), blue.name);
    expect(screen.queryByRole('option', { name: new RegExp(`^${blue.name} · blue`) })).toBeNull();
    a.unmount();
    const st = item(`/sparks/${whiteIdx}/stars`, { value: 2 });
    renderRoute('/review', mockSource({ roster, open: [st] }).src);
    await screen.findByText(st.path);
    expect(screen.queryByRole('combobox', { name: 'None of these? Search the game vocabulary' })).toBeNull();
    const num = screen.getByRole('spinbutton', { name: /Enter the correct value/ });
    await userEvent.type(num, '7');
    expect(screen.getByText('Enter a whole number from 1 to 3.')).toBeTruthy();
  });
});

describe('S03 stale/conflict feedback survives the refresh (S1)', () => {
  it('409 stale → screen-level alert stays after the item disappears from the refetched queue', async () => {
    const it0 = item('/stats/gut', { value: 559, candidates: [{ value: 559, score: 0.9 }] });
    let open: ReviewItem[] = [it0];
    const err = new HttpError(409, { status: 409, title: 'Conflict', detail: 'Review item is already resolved' }, 'POST');
    const { src } = mockSource({ roster }, {
      reviewItems: async (s) => (s === 'open' ? open : []),
      resolveReviewItem: async () => {
        open = [];
        throw err;
      },
    });
    renderRoute('/review', src);
    await screen.findByText('/stats/gut');
    await userEvent.keyboard('1');
    expect(await screen.findByText(/Nothing to review/)).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/Review item is already resolved\. The queue was refreshed\./);
  });
  it('404 (veteran deleted) → screen-level alert after refresh', async () => {
    const it0 = item('/stats/gut', { value: 559, candidates: [{ value: 559, score: 0.9 }] });
    const it1 = item('/stats/wit', { value: 400, candidates: [{ value: 400, score: 0.9 }] }, '01KGQZ0000G01DENCM0000RV12');
    let open: ReviewItem[] = [it0, it1];
    const err = new HttpError(404, { status: 404, title: 'Not Found', detail: 'The veteran of this review item no longer exists' }, 'POST');
    const { src } = mockSource({ roster }, {
      reviewItems: async (s) => (s === 'open' ? open : []),
      resolveReviewItem: async (id) => {
        if (id === it0.id) {
          open = [it1];
          throw err;
        }
        open = [];
        return { ...it1, status: 'resolved' as const };
      },
    });
    renderRoute('/review', src);
    await screen.findByText('/stats/gut');
    await userEvent.keyboard('1');
    await waitFor(() => expect(screen.queryByText('/stats/gut')).toBeNull());
    expect(screen.getByText('/stats/wit')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/no longer exists\. The queue was refreshed\./);
    // keyboard keeps working on the next item and a success clears the stale alert
    await userEvent.keyboard('1');
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});

describe('S02 mode toggle while a PATCH is pending (S3)', () => {
  it('radios are disabled while pending; settle invalidates both detail and roster', async () => {
    const d: RosterVeteranDetail = { ...v0, fields: [], trainMode: 'independent', modeSource: 'epithet' };
    let resolveFirst!: (x: RosterVeteranDetail) => void;
    let n = 0;
    const { src } = mockSource({ roster, detail: { [v0.id]: d } }, {
      patchVeteran: () => {
        n++;
        return new Promise((r) => (resolveFirst = r));
      },
    });
    const { qc } = renderRoute(`/veterans/${v0.id}`, src);
    const inv: string[] = [];
    const orig = qc.invalidateQueries.bind(qc);
    qc.invalidateQueries = ((f: { queryKey?: readonly unknown[] }) => {
      inv.push(JSON.stringify(f?.queryKey));
      return orig(f);
    }) as typeof qc.invalidateQueries;
    await userEvent.click(await screen.findByRole('radio', { name: 'Manual' }));
    const group = screen.getByRole('radiogroup');
    for (const r of within(group).getAllByRole('radio')) expect((r as HTMLInputElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole('radio', { name: 'Independent' }));
    expect(n).toBe(1);
    await act(async () => resolveFirst({ ...d, trainMode: 'manual', modeSource: 'override' }));
    await waitFor(() => expect((screen.getByRole('radio', { name: 'Independent' }) as HTMLInputElement).disabled).toBe(false));
    expect(inv).toEqual(expect.arrayContaining([JSON.stringify(qk.veteran(v0.id)), JSON.stringify(qk.roster)]));
  });
});

describe('S04 Friend slot (N2)', () => {
  const cards = m.bundle.cards.slice(0, 6);
  const owned = cards.map((c, i) => ({ cardId: c.id, lb: i % 5, level: 30 + i, confidence: 1, syncedAt: '2026-09-20T10:00:00.000Z' }));
  it('defaults are labelled, level is bounded 1–50 (approved S04 design), owned or non-owned friends are borrowed', async () => {
    const { services } = renderRoute('/cards', mockSource({ owned }).src);
    await screen.findByText(/Showing 6 of 6/);
    // an OWNED card may also be borrowed as the friend (it is a different copy)
    await userEvent.type(screen.getByPlaceholderText('Search all cards…'), cards[1]!.name.slice(0, 6));
    await userEvent.click(screen.getAllByRole('option').find((o) => o.textContent?.includes(cards[1]!.title))!);
    expect(screen.getByText(/Defaults LB4 · Lv50 — edit to match the friend's card/)).toBeTruthy();
    const deck = JSON.parse(services.store.getItem('uma:api:deck')!) as unknown[];
    expect(deck[5]).toEqual({ slot: 6, cardId: cards[1]!.id, lb: 4, level: 50, borrowed: true });
    const level = screen.getByRole('spinbutton', { name: 'Friend level' });
    expect(level.getAttribute('max')).toBe('50');
    await userEvent.clear(level);
    await userEvent.type(level, '51');
    expect(screen.getByText('Enter a level from 1 to 50.')).toBeTruthy();
    // 51 is never stored (the last in-range keystroke, 5, is)
    expect((JSON.parse(services.store.getItem('uma:api:deck')!) as { level: number }[])[5]!.level).toBe(5);
    await userEvent.clear(level);
    await userEvent.type(level, '45');
    expect((JSON.parse(services.store.getItem('uma:api:deck')!) as { level: number }[])[5]!.level).toBe(45);
    // a non-owned card works the same way
    const other = m.bundle.cards.find((c) => !cards.some((o) => o.id === c.id))!;
    await userEvent.clear(screen.getByPlaceholderText('Search all cards…'));
    await userEvent.type(screen.getByPlaceholderText('Search all cards…'), other.name.slice(0, 6));
    await userEvent.click(screen.getAllByRole('option').find((o) => o.textContent?.includes(other.title))!);
    expect((JSON.parse(services.store.getItem('uma:api:deck')!) as { cardId: string; borrowed: boolean }[])[5]).toMatchObject({ cardId: other.id, borrowed: true });
  });
});
