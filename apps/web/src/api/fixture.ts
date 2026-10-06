/**
 * Fixture mode (60 §3, `VITE_FIXTURES=1`): the committed T08 golden copies in
 * `apps/web/fixtures/*.json` (SYNTHETIC, read-only) replace the API. Reads come from the fixture
 * files; writes go to an in-memory MOCK store that lives only in this browser tab, never to a
 * server, and never to the files. Things the fixtures do not contain are shown as empty
 * (review items, capture fields, owned cards) rather than invented.
 */
import type {
  CmTarget,
  HealthResponse,
  ModelSnapshot,
  ReviewItem,
  RosterVeteran,
  RosterVeteranDetail,
} from '@uma/schema';
import { HttpError } from './errors.ts';
import type { CmTargetInput, DataSource, OwnedCardRow, RosterResult } from './types.ts';
import { ulid } from '../lib/ulid.ts';

export interface FixtureSourceOptions {
  fetch?: (url: string) => Promise<Response>;
  now: () => Date;
  random: () => number;
  /** Master version reported by the mock health endpoint (from `/master/latest.json`). */
  masterVersion: () => Promise<string>;
}

const notFound = (what: string) =>
  new HttpError(404, { title: 'Not Found', status: 404, detail: `${what} (fixture mode)` }, what);

export function fixtureSource(opts: FixtureSourceOptions): DataSource {
  const doFetch = opts.fetch ?? ((u: string) => fetch(u));
  let roster: Promise<RosterVeteran[]> | null = null;
  let targets: CmTarget[] | null = null;
  const snapshots: ModelSnapshot[] = [];
  // Mock-only mutations, applied over the read-only fixture roster.
  const modeOverrides = new Map<string, RosterVeteran['trainMode']>();
  const deleted = new Set<string>();
  let revision = 0;

  async function file<T>(name: string): Promise<T> {
    const res = await doFetch(`/fixtures/${name}.json`);
    if (!res.ok) throw new HttpError(res.status, null, `fixture ${name}.json`);
    return (await res.json()) as T;
  }
  async function baseRoster(): Promise<RosterVeteran[]> {
    roster ??= file<RosterVeteran[]>('roster');
    return roster;
  }
  async function currentRoster(): Promise<RosterVeteran[]> {
    return (await baseRoster())
      .filter((v) => !deleted.has(v.id))
      .map((v) => {
        const m = modeOverrides.get(v.id);
        return m ? { ...v, trainMode: m, modeSource: 'override' as const } : v;
      });
  }
  async function allTargets(): Promise<CmTarget[]> {
    targets ??= await file<CmTarget[]>('cm-targets');
    return targets;
  }
  const detail = async (id: string): Promise<RosterVeteranDetail> => {
    const v = (await currentRoster()).find((x) => x.id === id);
    if (!v) throw notFound('No such veteran');
    // The fixture roster carries no capture fields (no OCR provenance in synthetic data).
    return { ...v, fields: [] };
  };

  return {
    kind: 'fixture',
    async health(): Promise<HealthResponse> {
      return { ok: true, masterVersion: await opts.masterVersion(), dbSchemaVersion: 'fixture' };
    },
    async roster(cached): Promise<RosterResult> {
      const etag = `"fixture-${revision}"`;
      if (cached && cached.etag === etag) return { etag, roster: cached.roster, notModified: true };
      return { etag, roster: await currentRoster(), notModified: false };
    },
    veteran: detail,
    async patchVeteran(id, body) {
      await detail(id);
      modeOverrides.set(id, body.trainMode);
      revision++;
      return detail(id);
    },
    async deleteVeteran(id) {
      await detail(id);
      deleted.add(id);
      revision++;
    },
    reviewItems: async (): Promise<ReviewItem[]> => [],
    async resolveReviewItem() {
      throw notFound('No such review item');
    },
    cropUrl: () => null,
    ownedCards: async (): Promise<OwnedCardRow[]> => [],
    targets: async () => [...(await allTargets())],
    async createTarget(input: CmTargetInput) {
      const list = await allTargets();
      const t = { ...input, id: input.id ?? ulid(opts.now().getTime(), opts.random) } as CmTarget;
      targets = [...list, t];
      return t;
    },
    async updateTarget(id, input) {
      const list = await allTargets();
      if (!list.some((t) => t.id === id)) throw notFound('No such CM target');
      const t = { ...input, id } as CmTarget;
      targets = list.map((x) => (x.id === id ? t : x));
      return t;
    },
    async deleteTarget(id) {
      const list = await allTargets();
      if (!list.some((t) => t.id === id)) throw notFound('No such CM target');
      targets = list.filter((x) => x.id !== id);
    },
    async latestSnapshot(kind) {
      const xs = snapshots.filter((s) => !kind || s.kind === kind);
      return xs.length ? xs[xs.length - 1]! : null;
    },
    async storeSnapshot(s) {
      snapshots.push(s);
      return s;
    },
  };
}
