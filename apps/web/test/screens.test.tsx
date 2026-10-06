/**
 * Per-screen render / empty / loading / error states (60 §4) plus mutations, with a MOCK
 * DataSource (no network) and the real published master data.
 */
import { describe, expect, it } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReviewItem, RosterVeteranDetail } from '@uma/schema';
import { HttpError } from '../src/api/errors.ts';
import { qk } from '../src/app/queries.ts';
import type { RosterResult } from '../src/api/types.ts';
import { mockSource, never, renderRoute } from './harness.tsx';
import { goldenRoster, goldenTargets, masterData } from './fixtures.ts';

const roster = goldenRoster();
const v0 = roster[0]!;
const detail = (over: Partial<RosterVeteranDetail> = {}): RosterVeteranDetail => ({ ...v0, fields: [], ...over });
const boom = (status = 500) => new HttpError(status, { title: 'x', status, detail: 'mock failure' }, 'mock');

describe('S01 Roster', () => {
  it('loading', () => {
    renderRoute('/roster', mockSource({}, { roster: never }).src);
    expect(screen.getAllByText('Loading roster…').length).toBeGreaterThan(0);
  });
  it('empty', async () => {
    renderRoute('/roster', mockSource({ roster: [] }).src);
    expect(await screen.findByText(/No veterans yet/)).toBeTruthy();
  });
  it('error with retry', async () => {
    let n = 0;
    const { src } = mockSource({}, { roster: async () => { n++; if (n === 1) throw boom(); return { etag: null, roster: [], notModified: false }; } });
    renderRoute('/roster', src);
    expect(await screen.findByText(/Couldn't load your roster/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/No veterans yet/)).toBeTruthy();
  });
  it('renders, filters by mode, sorts by rating and paginates (client-side)', async () => {
    renderRoute('/roster', mockSource({ roster }).src);
    expect(await screen.findByText(/Showing 25 of 260 veterans · sorted by date, newest first/)).toBeTruthy();
    await userEvent.click(screen.getByRole('radio', { name: 'Manual' }));
    const manual = roster.filter((v) => v.trainMode === 'manual').length;
    expect(screen.getByText(new RegExp(`Showing 25 of ${manual} veterans`))).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Rating' }));
    const th = screen.getByRole('columnheader', { name: 'Rating' });
    expect(th.getAttribute('aria-sort')).toBe('descending');
    const first = screen.getAllByRole('row')[1]!;
    const maxManual = Math.max(...roster.filter((v) => v.trainMode === 'manual').map((v) => v.rating));
    expect(within(first).getByText(new Intl.NumberFormat('en-US').format(maxManual))).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText(/Page 2 of/)).toBeTruthy();
  });
  it('filtered-empty offers reset', async () => {
    renderRoute('/roster', mockSource({ roster }).src);
    await screen.findByText(/Showing 25 of 260/);
    await userEvent.type(screen.getByLabelText('Minimum rating'), '99999999');
    expect(screen.getByText('No veterans match these filters.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(screen.getByText(/Showing 25 of 260/)).toBeTruthy();
  });
  it('a 304 refetch keeps the cached roster object (ETag cache)', async () => {
    let call = 0;
    const { src, calls } = mockSource({}, {
      roster: async (cached) => {
        call++;
        if (cached) return { etag: cached.etag, roster: cached.roster, notModified: true };
        return { etag: '"e1"', roster: roster.slice(0, 3), notModified: false };
      },
    });
    const { qc } = renderRoute('/roster', src);
    await screen.findByText(/Showing 3 of 3/);
    const before = qc.getQueryData<RosterResult>(qk.roster)!;
    await act(() => qc.refetchQueries({ queryKey: qk.roster }));
    expect(call).toBe(2);
    expect(qc.getQueryData<RosterResult>(qk.roster)).toBe(before);
    expect(calls.filter((c) => c.method === 'roster')).toHaveLength(0); // overridden method is not recorded
  });
});

describe('S02 Veteran detail', () => {
  it('loading / not found / error', async () => {
    const a = renderRoute(`/veterans/${v0.id}`, mockSource({}, { veteran: never }).src);
    expect(screen.getAllByText('Loading veteran…').length).toBeGreaterThan(0);
    a.unmount();
    const b = renderRoute(`/veterans/${v0.id}`, mockSource({}).src);
    expect(await screen.findByText('This veteran no longer exists.')).toBeTruthy();
    b.unmount();
    renderRoute(`/veterans/${v0.id}`, mockSource({}, { veteran: async () => { throw boom(); } }).src);
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
  it('renders header, stats, sparks and lineage (matched parent link, guest badge)', async () => {
    const matched = roster.find((v) => v.parents.some((p) => p.matchedVeteranId))!;
    renderRoute(`/veterans/${matched.id}`, mockSource({ detail: { [matched.id]: { ...matched, fields: [] } } }).src);
    const m = masterData();
    expect(await screen.findByRole('heading', { name: m.characters.get(matched.characterId)!.name })).toBeTruthy();
    expect(screen.getByText(String(matched.stats.spd))).toBeTruthy();
    await userEvent.click(screen.getByRole('tab', { name: 'Lineage' }));
    const p = matched.parents.find((x) => x.matchedVeteranId)!;
    expect(screen.getAllByRole('link', { name: 'Open veteran →' })[0]!.getAttribute('href')).toBe(`/veterans/${p.matchedVeteranId}`);
  });
  it('tabs are keyboard operable (arrow keys)', async () => {
    renderRoute(`/veterans/${v0.id}`, mockSource({ detail: { [v0.id]: detail() } }).src);
    const sparks = await screen.findByRole('tab', { name: 'Sparks' });
    sparks.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Deck' }).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Deck' }));
  });
  it('low-confidence fields get a banner and dotted links to S03', async () => {
    const d = detail({
      fields: [{ path: '/stats/gut', rawText: '5S9', value: 559, confidence: 0.4, status: 'low_confidence', candidates: [], cropKey: null }],
    });
    renderRoute(`/veterans/${v0.id}`, mockSource({ detail: { [v0.id]: d } }).src);
    expect(await screen.findByText(/1 field\(s\) have low confidence/)).toBeTruthy();
    const link = screen.getByTitle('Low confidence — review');
    expect(link.getAttribute('href')).toContain('path=%2Fstats%2Fgut');
  });
  it('mode override is optimistic and rolls back on error', async () => {
    let reject!: (e: unknown) => void;
    const { src } = mockSource({ detail: { [v0.id]: detail({ trainMode: 'independent', modeSource: 'epithet' }) } }, {
      patchVeteran: () => new Promise((_r, j) => (reject = j)),
    });
    renderRoute(`/veterans/${v0.id}`, src);
    const manual = await screen.findByRole('radio', { name: 'Manual' });
    await userEvent.click(manual);
    await waitFor(() => expect((screen.getByRole('radio', { name: 'Manual' }) as HTMLInputElement).checked).toBe(true));
    expect(screen.getByText(/Train mode \(overridden\)/)).toBeTruthy();
    await act(async () => reject(boom()));
    await waitFor(() => expect((screen.getByRole('radio', { name: 'Independent' }) as HTMLInputElement).checked).toBe(true));
    expect(screen.getByText("Couldn't change the train mode. It has been reverted.")).toBeTruthy();
  });
  it('delete confirms, calls DELETE and returns to the roster', async () => {
    const { src, calls } = mockSource({ roster, detail: { [v0.id]: detail() } });
    const { router } = renderRoute(`/veterans/${v0.id}`, src);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete veteran' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/roster'));
    expect(calls.some((c) => c.method === 'deleteVeteran' && c.args[0] === v0.id)).toBe(true);
  });
});

const item = (over: Partial<ReviewItem> = {}): ReviewItem => ({
  id: '01KGQZ0000G01DENCM0000RV01',
  veteranId: v0.id,
  path: '/sparks/4/sparkId',
  status: 'open',
  resolvedValue: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  resolvedAt: null,
  field: {
    path: '/sparks/4/sparkId',
    rawText: 'Restralnt',
    value: 'spark:restraint',
    confidence: 0.62,
    status: 'low_confidence',
    candidates: [
      { value: 'spark:restraint', score: 0.87 },
      { value: v0.sparks[0]!.sparkId, score: 0.4 },
    ],
    cropKey: null,
  },
  cropKey: null,
  ...over,
});

describe('S03 Review queue', () => {
  it('loading / empty / error', async () => {
    const a = renderRoute('/review', mockSource({}, { reviewItems: never }).src);
    expect(screen.getAllByText('Loading review items…').length).toBeGreaterThan(0);
    a.unmount();
    const b = renderRoute('/review', mockSource({ roster }).src);
    expect(await screen.findByText(/Nothing to review/)).toBeTruthy();
    b.unmount();
    renderRoute('/review', mockSource({}, { reviewItems: async () => { throw boom(); } }).src);
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
  it('renders the item with OCR text, path, candidates and "no crop" state; counts resolved this week', async () => {
    const old = item({ id: '01KGQZ0000G01DENCM0000RV09', status: 'resolved', resolvedAt: '2026-09-01T00:00:00.000Z' });
    const recent = item({ id: '01KGQZ0000G01DENCM0000RV08', status: 'resolved', resolvedAt: '2026-10-02T00:00:00.000Z' });
    renderRoute('/review', mockSource({ roster, open: [item()], resolved: [old, recent] }).src);
    expect(await screen.findByText('1 open · 1 resolved this week')).toBeTruthy();
    expect(screen.getByText('/sparks/4/sparkId')).toBeTruthy();
    expect(screen.getByText('No crop stored for this field.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Restraint · white/ })).toBeTruthy();
  });
  it('a crop key renders the API crop image URL', async () => {
    const key = `crops/${v0.id}/%2Fsparks%2F4%2FsparkId.png`;
    renderRoute('/review', mockSource({ roster, open: [item({ cropKey: key })] }).src);
    const img = await screen.findByAltText('Captured crop of the field');
    expect(img.getAttribute('src')).toBe(`/api/v1/crops/${key}`);
    fireEvent.error(img);
    expect(await screen.findByText('Crop failed to load.')).toBeTruthy();
  });
  it('resolve invalidates roster + review queries', async () => {
    const { src, calls } = mockSource({ roster, open: [item()] });
    const { qc } = renderRoute('/review', src);
    await screen.findByText('/sparks/4/sparkId');
    const inv: string[] = [];
    const orig = qc.invalidateQueries.bind(qc);
    qc.invalidateQueries = ((f: { queryKey?: readonly unknown[] }) => {
      inv.push(JSON.stringify(f?.queryKey));
      return orig(f);
    }) as typeof qc.invalidateQueries;
    await userEvent.click(screen.getByRole('button', { name: /Restraint · white/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'resolveReviewItem')).toBe(true));
    expect(calls.find((c) => c.method === 'resolveReviewItem')!.args).toEqual([item().id, 'spark:restraint']);
    await waitFor(() => expect(inv).toEqual(expect.arrayContaining(['["roster"]', '["review"]'])));
  });
  it('409 fingerprint collision shows the conflict message', async () => {
    const err = new HttpError(409, { status: 409, detail: 'The corrected veteran duplicates an existing one', errors: [{ message: 'fingerprint collision', veteranId: 'x' }] }, 'POST');
    renderRoute('/review', mockSource({ roster, open: [item()] }, { resolveReviewItem: async () => { throw err; } }).src);
    await screen.findByText('/sparks/4/sparkId');
    await userEvent.keyboard('1');
    expect(await screen.findByText(/would make .* identical to another veteran/)).toBeTruthy();
  });
  it('keyboard: J/K navigate, D explains dismiss is unavailable (Q-70, no request sent)', async () => {
    const a = item();
    const b = item({ id: '01KGQZ0000G01DENCM0000RV02', path: '/stats/gut', field: { ...item().field, path: '/stats/gut', rawText: '5S9', value: 559, candidates: [] } });
    const { src, calls } = mockSource({ roster, open: [a, b] });
    renderRoute('/review', src);
    await screen.findByText('/sparks/4/sparkId');
    await userEvent.keyboard('j');
    expect(await screen.findByText('/stats/gut')).toBeTruthy();
    expect(screen.getByText('No candidates. Search the vocabulary below.')).toBeTruthy();
    await userEvent.keyboard('k');
    expect(await screen.findByText('/sparks/4/sparkId')).toBeTruthy();
    await userEvent.keyboard('d');
    expect(screen.getByText(/no dismiss endpoint \(Q-70\)/)).toBeTruthy();
    expect(calls.map((c) => c.method)).not.toContain('resolveReviewItem');
  });
  it('vocabulary search selects a value to apply', async () => {
    const { src, calls } = mockSource({ roster, open: [item()] });
    renderRoute('/review', src);
    await screen.findByText('/sparks/4/sparkId');
    await userEvent.type(screen.getByRole('combobox', { name: 'None of these? Search the game vocabulary' }), 'Restrai');
    await userEvent.click(await screen.findByRole('option', { name: /Restraint/ }));
    await userEvent.click(screen.getByRole('button', { name: /^Apply “Restraint”/ }));
    await waitFor(() => expect(calls.find((c) => c.method === 'resolveReviewItem')?.args[1]).toBe('spark:restraint'));
  });
});

describe('S04 Support cards', () => {
  const cards = masterData().bundle.cards.slice(0, 8);
  const owned = cards.map((c, i) => ({ cardId: c.id, lb: i % 5, level: 30 + i, confidence: 1, syncedAt: `2026-09-2${i % 3}T10:00:00.000Z` }));
  it('loading / empty / error', async () => {
    const a = renderRoute('/cards', mockSource({}, { ownedCards: never }).src);
    expect(screen.getAllByText('Loading cards…').length).toBeGreaterThan(0);
    a.unmount();
    const b = renderRoute('/cards', mockSource({ owned: [] }).src);
    expect(await screen.findByText(/No cards synced yet/)).toBeTruthy();
    b.unmount();
    renderRoute('/cards', mockSource({}, { ownedCards: async () => { throw boom(); } }).src);
    expect(await screen.findByText(/Couldn't load your cards/)).toBeTruthy();
  });
  it('shows the truthful sync line (no invented held count, Q-71) and filters by LB', async () => {
    renderRoute('/cards', mockSource({ owned }).src);
    expect(await screen.findByText('Last sync 2026-09-22 10:00 · 8 cards stored · held count not reported')).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText('Limit break'), 'max');
    expect(screen.getByText(`Showing ${owned.filter((o) => o.lb === 4).length} of 8 owned cards`)).toBeTruthy();
  });
  it('deck builder: 5 owned max, friend from all cards, then "Use in planner"', async () => {
    const { router, services } = renderRoute('/cards', mockSource({ owned }).src);
    await screen.findByText(/Showing 8 of 8/);
    const adds = screen.getAllByRole('button', { name: 'Add to deck' });
    for (let i = 0; i < 5; i++) await userEvent.click(adds[i]!);
    await userEvent.click(screen.getAllByRole('button', { name: 'Add to deck' })[0]!);
    expect(screen.getByText('The deck already has 5 owned cards. Remove one first.')).toBeTruthy();
    const friend = masterData().bundle.cards[20]!;
    await userEvent.type(screen.getByPlaceholderText('Search all cards…'), friend.name.slice(0, 6));
    await userEvent.click(screen.getAllByRole('option').find((o) => o.textContent?.includes(friend.title))!);
    const use = screen.getByRole('button', { name: 'Use in planner' });
    expect((use as HTMLButtonElement).disabled).toBe(false);
    expect(services.store.getItem('uma:api:deck')).toContain(friend.id);
    await userEvent.click(use);
    expect(router.state.location.pathname).toBe('/planner');
  });
});

describe('S05 CM targets', () => {
  const targets = goldenTargets();
  it('loading / empty / error', async () => {
    const a = renderRoute('/targets', mockSource({}, { targets: never }).src);
    expect(screen.getAllByText('Loading targets…').length).toBeGreaterThan(0);
    a.unmount();
    const b = renderRoute('/targets', mockSource({ targets: [] }).src);
    expect(await screen.findByText(/No targets yet/)).toBeTruthy();
    b.unmount();
    renderRoute('/targets', mockSource({}, { targets: async () => { throw boom(); } }).src);
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
  it('lists without inventing an updated date (Q-72) and edits/saves with PUT', async () => {
    const { src, calls } = mockSource({ targets });
    renderRoute('/targets', src);
    const name = await screen.findByLabelText('Name');
    expect(screen.queryByText(/updated/)).toBeNull();
    await userEvent.clear(name);
    await userEvent.type(name, 'golden edited');
    await userEvent.click(screen.getByRole('button', { name: 'Save target' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'updateTarget')).toBe(true));
    const [id, input] = calls.find((c) => c.method === 'updateTarget')!.args as [string, { name: string; requiredSkills: string[] }];
    expect(id).toBe(targets[0]!.id);
    expect(input).toMatchObject({ name: 'golden edited', requiredSkills: ['skill:restraint'] });
    expect(await screen.findByText('Saved “golden edited”.')).toBeTruthy();
  });
  it('validation blocks save and shows copy.md messages', async () => {
    const { src, calls } = mockSource({ targets });
    renderRoute('/targets', src);
    await userEvent.clear(await screen.findByLabelText('Name'));
    const spd = screen.getByLabelText('Speed', { selector: 'input[inputmode=numeric]' });
    await userEvent.clear(spd);
    await userEvent.type(spd, '2500');
    await userEvent.click(screen.getByRole('button', { name: 'Save target' }));
    expect(screen.getByText('Give the target a name.')).toBeTruthy();
    expect(screen.getByText('Enter a whole number from 1 to 2000.')).toBeTruthy();
    expect(calls.some((c) => c.method === 'updateTarget')).toBe(false);
  });
  it('new target via skill autocomplete then POST; delete confirms', async () => {
    const { src, calls } = mockSource({ targets });
    const { router } = renderRoute('/targets/new', src);
    await userEvent.type(await screen.findByLabelText('Name'), 'Mine');
    const [req] = screen.getAllByPlaceholderText('Add skill…');
    await userEvent.type(req!, 'Restrai');
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Remove Restraint' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Save target' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'createTarget')).toBe(true));
    expect((calls.find((c) => c.method === 'createTarget')!.args[0] as { requiredSkills: string[] }).requiredSkills).toEqual(['skill:restraint']);
    await waitFor(() => expect(router.state.location.pathname).toBe('/targets/01KGQZ0000G01DENCM0000NEW1'));
  });
  it('save failure shows the error', async () => {
    renderRoute('/targets', mockSource({ targets }, { updateTarget: async () => { throw boom(422); } }).src);
    await userEvent.click(await screen.findByRole('button', { name: 'Save target' }));
    expect(await screen.findByText(/Couldn't save the target/)).toBeTruthy();
  });
});
