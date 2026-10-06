/** S01 Roster (F05, F02). */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { TrainMode } from '@uma/schema';
import { Page } from '../components/Layout.tsx';
import { Avatar, Empty, ErrorBanner, Loading, ModeBadge, SparkPill } from '../components/atoms.tsx';
import { useMaster, useRoster } from '../app/queries.ts';
import { useServices } from '../app/services.ts';
import { errorText } from '../api/errors.ts';
import { characterName, outfitTitle, scenarioName, sparkName } from '../master/load.ts';
import {
  defaultFilter,
  filterRoster,
  lastImport,
  selfSparkSummary,
  sortRoster,
  SORT_LABEL,
  type RosterFilter,
  type SortDir,
  type SortKey,
} from '../lib/roster.ts';
import { dateTime, int } from '../lib/format.ts';
import { STAT_KEYS, STAT_SHORT } from '../lib/keys.ts';
import { readJson, writeJson } from '../lib/storage.ts';

export const PAGE_SIZE = 25;
type Col = 'sparks' | 'scenario' | 'acquired' | 'stats';
const ALL_COLS: Col[] = ['stats', 'sparks', 'scenario', 'acquired'];
const isCols = (v: unknown): v is Col[] =>
  Array.isArray(v) && v.every((c) => ALL_COLS.includes(c as Col));

export function RosterScreen() {
  const roster = useRoster();
  const master = useMaster();
  const { store } = useServices();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<RosterFilter>(defaultFilter);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'date', dir: 'desc' });
  const [page, setPage] = useState(0);
  const [cols, setColsState] = useState<Col[]>(() => readJson(store, 'uma:roster:cols', isCols, ALL_COLS));
  const [colsOpen, setColsOpen] = useState(false);
  const setCols = (c: Col[]) => {
    setColsState(c);
    writeJson(store, 'uma:roster:cols', c);
  };
  const show = (c: Col) => cols.includes(c);

  const all = roster.data?.roster;
  const m = master.data;
  const rows = useMemo(
    () => (all && m ? sortRoster(filterRoster(all, filter), sort.key, sort.dir, m) : []),
    [all, m, filter, sort],
  );
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const p = Math.min(page, pages - 1);
  const visible = rows.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE);
  const set = (patch: Partial<RosterFilter>) => {
    setFilter((f) => ({ ...f, ...patch }));
    setPage(0);
  };
  const sortBy = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' ? 'asc' : 'desc' }));
  const aria = (key: SortKey) => (sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined);
  const Th = ({ k, label, cls }: { k: SortKey; label: string; cls?: string }) => (
    <th scope="col" className={cls} aria-sort={aria(k)}>
      <button type="button" className="linklike" onClick={() => sortBy(k)}>
        {label}
      </button>
    </th>
  );

  const characters = useMemo(() => {
    if (!all || !m) return [];
    const ids = [...new Set(all.map((v) => v.characterId))];
    return ids.map((id) => [id, characterName(m, id)] as const).sort((a, b) => a[1].localeCompare(b[1]));
  }, [all, m]);
  const scenarios = useMemo(() => (all && m ? [...new Set(all.map((v) => v.scenarioId))].map((id) => [id, scenarioName(m, id)] as const) : []), [all, m]);
  const sparks = useMemo(() => {
    if (!all || !m) return [];
    const ids = [...new Set(all.flatMap((v) => v.sparks.map((s) => s.sparkId)))];
    return ids.map((id) => [id, sparkName(m, id)] as const).sort((a, b) => a[1].localeCompare(b[1]));
  }, [all, m]);
  const last = all ? lastImport(all) : null;

  const actions = (
    <>
      {last && <span className="hint">Last import {dateTime(last)}</span>}
      <div className="ac">
        <button type="button" className="btn" aria-expanded={colsOpen} onClick={() => setColsOpen((x) => !x)}>
          Columns
        </button>
        {colsOpen && (
          <div className="suggest" style={{ right: 0, padding: 8 }} role="group" aria-label="Visible columns">
            {ALL_COLS.map((c) => (
              <label key={c} className="row" style={{ gap: 6 }}>
                <input
                  type="checkbox"
                  checked={show(c)}
                  onChange={(e) => setCols(e.target.checked ? [...cols, c] : cols.filter((x) => x !== c))}
                />
                {c === 'stats' ? 'Stats' : c === 'sparks' ? 'Sparks' : c === 'scenario' ? 'Scenario' : 'Acquired'}
              </label>
            ))}
          </div>
        )}
      </div>
    </>
  );

  let body;
  if (roster.isError && !all) {
    body = <ErrorBanner text={<>Couldn't load your roster. {errorText(roster.error)}</>} onRetry={() => void roster.refetch()} />;
  } else if (master.isError) {
    body = <ErrorBanner text="Couldn't load game data. Reload the page." onRetry={() => void master.refetch()} />;
  } else if (!all || !m) {
    body = <Loading label="Loading roster…" rows={8} />;
  } else if (all.length === 0) {
    body = (
      <Empty>
        <p>No veterans yet. Install the capture agent and import your first veteran.</p>
      </Empty>
    );
  } else {
    body = (
      <>
        {roster.isError && <ErrorBanner text={<>Couldn't refresh your roster. {errorText(roster.error)}</>} onRetry={() => void roster.refetch()} />}
        <form className="filters" aria-label="Roster filters" onSubmit={(e) => e.preventDefault()}>
          <label className="field">
            <span>Character</span>
            <select className="input" value={filter.characterId} onChange={(e) => set({ characterId: e.target.value })}>
              <option value="">All characters</option>
              {characters.map(([id, n]) => (
                <option key={id} value={id}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <div className="field">
            <span id="f-mode">Mode</span>
            <div className="seg" role="radiogroup" aria-labelledby="f-mode">
              {(['all', 'independent', 'manual'] as const).map((md) => (
                <label key={md}>
                  <input type="radio" name="f-mode" checked={filter.mode === md} onChange={() => set({ mode: md as TrainMode | 'all' })} />
                  {md === 'all' ? 'All' : md === 'independent' ? 'Independent' : 'Manual'}
                </label>
              ))}
            </div>
          </div>
          <label className="field">
            <span>Scenario</span>
            <select className="input" value={filter.scenarioId} onChange={(e) => set({ scenarioId: e.target.value })}>
              <option value="">All scenarios</option>
              {scenarios.map(([id, n]) => (
                <option key={id} value={id}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Has spark</span>
            <select className="input" value={filter.sparkId} onChange={(e) => set({ sparkId: e.target.value })}>
              <option value="">Any</option>
              {sparks.map(([id, n]) => (
                <option key={id} value={id}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Stars ≥</span>
            <select className="input w-sm" value={filter.minStars} onChange={(e) => set({ minStars: Number(e.target.value) as 1 | 2 | 3 })}>
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
            </select>
          </label>
          <div className="field">
            <span>Rating range</span>
            <div className="row" style={{ gap: 4 }}>
              <input
                className="input w-sm"
                inputMode="numeric"
                aria-label="Minimum rating"
                value={filter.ratingMin ?? ''}
                onChange={(e) => set({ ratingMin: e.target.value.trim() === '' || Number.isNaN(Number(e.target.value)) ? null : Number(e.target.value) })}
              />
              –
              <input
                className="input w-sm"
                inputMode="numeric"
                aria-label="Maximum rating"
                value={filter.ratingMax ?? ''}
                onChange={(e) => set({ ratingMax: e.target.value.trim() === '' || Number.isNaN(Number(e.target.value)) ? null : Number(e.target.value) })}
              />
            </div>
          </div>
          <button type="button" className="btn" onClick={() => set(defaultFilter)}>
            Reset
          </button>
        </form>
        <div className="pager" style={{ padding: '0 0 6px' }}>
          <span>
            Showing {visible.length} of {rows.length} veterans · sorted by {SORT_LABEL[sort.key]},{' '}
            {sort.key === 'date' ? (sort.dir === 'desc' ? 'newest first' : 'oldest first') : sort.dir === 'desc' ? 'descending' : 'ascending'}
            {rows.length !== all.length && ` (${all.length} total)`}
          </span>
        </div>
        {rows.length === 0 ? (
          <Empty>
            <p>No veterans match these filters.</p>
            <button type="button" className="btn" onClick={() => set(defaultFilter)}>
              Reset filters
            </button>
          </Empty>
        ) : (
          <div className="tbl-wrap">
            <table>
              <caption className="sr">Veterans</caption>
              <thead>
                <tr>
                  <th scope="col" className="hc">
                    <span className="sr">Portrait</span>
                  </th>
                  <Th k="name" label="Veteran" />
                  <Th k="rank" label="Rank" />
                  <Th k="rating" label="Rating" cls="num" />
                  {show('stats') && STAT_KEYS.map((k) => <Th key={k} k={k} label={STAT_SHORT[k]} cls="num hm" />)}
                  <Th k="mode" label="Mode" />
                  {show('sparks') && (
                    <th scope="col" className="hm">
                      Sparks (own: blue / pink / green)
                    </th>
                  )}
                  {show('scenario') && <Th k="scenario" label="Scenario" cls="hm" />}
                  {show('acquired') && <Th k="date" label="Acquired" cls="hm" />}
                </tr>
              </thead>
              <tbody>
                {visible.map((v) => {
                  const name = characterName(m, v.characterId);
                  const s = selfSparkSummary(v);
                  return (
                    <tr key={v.id} className="rowlink" onClick={(e) => {
                      if ((e.target as HTMLElement).closest('a')) return;
                      void navigate(`/veterans/${v.id}`);
                    }}>
                      <td className="hc">
                        <Avatar name={name} />
                      </td>
                      <th scope="row" className="name">
                        <Link to={`/veterans/${v.id}`}>
                          <b>{name}</b>
                        </Link>
                        <small>{outfitTitle(m, v.outfitId)}</small>
                      </th>
                      <td>
                        <span className="rank">{v.rank}</span>
                      </td>
                      <td className="num">{int(v.rating)}</td>
                      {show('stats') &&
                        STAT_KEYS.map((k) => (
                          <td key={k} className="num hm">
                            {v.stats[k]}
                          </td>
                        ))}
                      <td>
                        <ModeBadge mode={v.trainMode} override={v.modeSource === 'override'} />
                      </td>
                      {show('sparks') && (
                        <td className="hm">
                          <div className="sums">
                            {(['blue', 'pink', 'green'] as const).map((t) => {
                              const sp = s[t];
                              return sp ? <SparkPill key={t} type={t} name={sparkName(m, sp.sparkId)} stars={sp.stars} /> : null;
                            })}
                          </div>
                        </td>
                      )}
                      {show('scenario') && <td className="hm">{scenarioName(m, v.scenarioId)}</td>}
                      {show('acquired') && <td className="hm mono">{v.career.dateAcquired}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="pager">
              <span>
                Page {p + 1} of {pages}
              </span>
              <span className="row" style={{ gap: 4 }}>
                <button type="button" className="btn sm" disabled={p === 0} onClick={() => setPage(p - 1)}>
                  Previous
                </button>
                <button type="button" className="btn sm" disabled={p >= pages - 1} onClick={() => setPage(p + 1)}>
                  Next
                </button>
              </span>
            </div>
          </div>
        )}
      </>
    );
  }
  return (
    <Page title="Roster" actions={actions}>
      {body}
    </Page>
  );
}
