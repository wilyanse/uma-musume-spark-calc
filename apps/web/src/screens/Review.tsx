/** S03 Review queue (F04). Keyboard: 1/2/3 apply a candidate, J/K next/previous, D (dismiss, Q-70). */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { ReviewItem, RosterVeteran, VocabEntry } from '@uma/schema';
import { Page } from '../components/Layout.tsx';
import { Empty, ErrorBanner, Kbd, Loading, Tag } from '../components/atoms.tsx';
import { useMaster, useResolve, useReviewItems, useRoster } from '../app/queries.ts';
import { useServices } from '../app/services.ts';
import { errorText, HttpError } from '../api/errors.ts';
import { characterName, type MasterData } from '../master/load.ts';
import { candidateLabel, humanPath, vocabKindFor } from '../lib/paths.ts';

const WEEK_MS = 7 * 86_400_000;

export function conflictKind(e: unknown): 'fingerprint' | 'stale' | null {
  if (!(e instanceof HttpError) || e.status !== 409) return null;
  const fp = e.problem?.errors?.some((x) => x.message === 'fingerprint collision');
  return fp || /duplicates an existing/.test(e.problem?.detail ?? '') ? 'fingerprint' : 'stale';
}

export function ReviewScreen() {
  const open = useReviewItems('open');
  const resolved = useReviewItems('resolved');
  const roster = useRoster();
  const master = useMaster();
  const { now } = useServices();
  const [params] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const items = open.data ?? [];
  const byId = useMemo(() => new Map((roster.data?.roster ?? []).map((v) => [v.id, v])), [roster.data]);
  useEffect(() => {
    if (selectedId && items.some((i) => i.id === selectedId)) return;
    const want = items.find((i) => i.veteranId === params.get('veteran') && i.path === params.get('path'));
    setSelectedId((want ?? items[0])?.id ?? null);
  }, [items, selectedId, params]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const t0 = now().getTime();
  const resolvedThisWeek = (resolved.data ?? []).filter(
    (r) => r.resolvedAt && t0 - new Date(r.resolvedAt).getTime() <= WEEK_MS,
  ).length;
  const idx = items.findIndex((i) => i.id === selectedId);
  const item = idx >= 0 ? items[idx]! : null;
  const move = (d: number) => {
    if (!items.length) return;
    const n = Math.min(items.length - 1, Math.max(0, (idx < 0 ? 0 : idx) + d));
    setSelectedId(items[n]!.id);
  };

  const summary = open.isSuccess ? (
    <span className="hint">
      {items.length} open{resolved.isSuccess ? ` · ${resolvedThisWeek} resolved this week` : ''}
    </span>
  ) : null;

  let body;
  if (open.isError) body = <ErrorBanner text={errorText(open.error)} onRetry={() => void open.refetch()} />;
  else if (!open.isSuccess || !master.data) body = <Loading label="Loading review items…" />;
  else if (items.length === 0)
    body = (
      <Empty>
        <p>Nothing to review. Every field from your last import was read with high confidence.</p>
      </Empty>
    );
  else
    body = (
      <div className="split">
        <section className="panel" aria-labelledby="q-title">
          <header>
            <span id="q-title">Open items</span> <Tag kind="err">{items.length}</Tag>
          </header>
          <div className="queue" role="list">
            {items.map((it) => {
              const v = byId.get(it.veteranId);
              return (
                <div role="listitem" key={it.id}>
                  <button type="button" aria-current={it.id === selectedId} onClick={() => setSelectedId(it.id)}>
                    <b>{v ? characterName(master.data!, v.characterId) : it.veteranId}</b>
                    <small>
                      {humanPath(it.path, v)} · OCR “{it.field.rawText ?? '—'}”
                    </small>
                  </button>
                </div>
              );
            })}
          </div>
        </section>
        {item && (
          <ItemPanel
            key={item.id}
            item={item}
            veteran={byId.get(item.veteranId)}
            m={master.data}
            left={items.length}
            onMove={move}
            onDone={(msg) => setToast(msg)}
          />
        )}
      </div>
    );

  return (
    <Page title="Review queue" actions={summary}>
      {body}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </Page>
  );
}

function ItemPanel({
  item,
  veteran,
  m,
  left,
  onMove,
  onDone,
}: {
  item: ReviewItem;
  veteran: RosterVeteran | undefined;
  m: MasterData;
  left: number;
  onMove: (d: number) => void;
  onDone: (msg: string) => void;
}) {
  const resolve = useResolve();
  const { source } = useServices();
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<{ value: unknown; label: string } | null>(null);
  const [dismissNote, setDismissNote] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const cands = item.field.candidates.slice(0, 3);
  const name = veteran ? characterName(m, veteran.characterId) : 'this veteran';
  const current = chosen ?? (cands[0] ? { value: cands[0].value, label: candidateLabel(cands[0].value, item.path, m).label } : null);

  const apply = (value: unknown, _label: string) => {
    if (resolve.isPending) return;
    resolve.mutate({ id: item.id, value }, { onSuccess: () => onDone(`Fixed. ${left - 1} left.`) });
  };

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'j') {
        e.preventDefault();
        onMove(1);
      } else if (k === 'k') {
        e.preventDefault();
        onMove(-1);
      } else if (k === 'd') {
        e.preventDefault();
        setDismissNote(true);
      } else if (['1', '2', '3'].includes(k)) {
        const c = cands[Number(k) - 1];
        if (c) {
          e.preventDefault();
          apply(c.value, candidateLabel(c.value, item.path, m).label);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const kind = vocabKindFor(item.path);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const pool: VocabEntry[] = m.bundle.vocab.filter((e) => !kind || e.kind === kind);
    const seen = new Set<string>();
    const out: VocabEntry[] = [];
    for (const e of pool) {
      if (e.text.toLowerCase().includes(q) && !seen.has(e.id)) {
        seen.add(e.id);
        out.push(e);
        if (out.length >= 8) break;
      }
    }
    return out;
  }, [query, m, kind]);
  const numeric = typeof item.field.value === 'number' && /^\d+$/.test(query.trim());
  const conflict = conflictKind(resolve.error);
  const conf = item.field.confidence;

  return (
    <section className="panel" ref={panelRef} aria-labelledby="item-title">
      <header>
        <span id="item-title">
          {name} — {humanPath(item.path, veteran)}
        </span>
        <Tag kind="warn">confidence {conf.toFixed(2)}</Tag>
      </header>
      <div className="body grid">
        <Crop cropKey={item.cropKey} url={item.cropKey ? source.cropUrl(item.cropKey) : null} />
        <div className="row" style={{ gap: 'var(--space-6)' }}>
          <div>
            <div className="hint">Raw OCR text</div>
            <div className="mono" style={{ fontSize: 'var(--type-md)' }}>
              {item.field.rawText ?? '—'}
            </div>
          </div>
          <div>
            <div className="hint">Field path</div>
            <div className="mono">{item.path}</div>
          </div>
        </div>
        <div>
          <div className="hint" id="cand-l">
            Candidates
          </div>
          {cands.length === 0 ? (
            <p className="muted">No candidates. Search the vocabulary below.</p>
          ) : (
            <div className="grid" role="group" aria-labelledby="cand-l" style={{ gap: 6 }}>
              {cands.map((c, i) => {
                const l = candidateLabel(c.value, item.path, m);
                return (
                  <button
                    key={i}
                    type="button"
                    className={`cand${i === 0 ? ' top' : ''}`}
                    disabled={resolve.isPending}
                    onClick={() => apply(c.value, l.label)}
                  >
                    <span>
                      <b>{l.label}</b> <span className="muted">· {l.kind}</span>
                    </span>
                    <span className="row" style={{ gap: 6 }}>
                      <span className="mono">{c.score.toFixed(2)}</span>
                      <Kbd>{i + 1}</Kbd>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div>
          <label className="field">
            <span>None of these? Search the game vocabulary</span>
            <input
              className="input"
              placeholder="Type a spark, skill or outfit name…"
              value={query}
              role="combobox"
              aria-expanded={matches.length > 0}
              aria-controls="vocab-list"
              aria-autocomplete="list"
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {(matches.length > 0 || numeric) && (
            <div id="vocab-list" role="listbox" className="grid" style={{ gap: 2, marginTop: 4 }}>
              {numeric && (
                <button type="button" role="option" aria-selected={false} className="cand" onClick={() => setChosen({ value: Number(query.trim()), label: query.trim() })}>
                  Use the number {query.trim()}
                </button>
              )}
              {matches.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  role="option"
                  aria-selected={chosen?.value === e.id}
                  className="cand"
                  onClick={() => setChosen({ value: e.id, label: e.text })}
                >
                  <span>
                    <b>{e.text}</b> <span className="muted">· {e.kind}</span>
                  </span>
                  <span className="mono muted">{e.id}</span>
                </button>
              ))}
            </div>
          )}
          {query.trim().length >= 2 && matches.length === 0 && !numeric && <p className="hint">No matches.</p>}
        </div>
        {resolve.isError && (
          <div className="banner err" role="alert">
            {conflict === 'fingerprint'
              ? `This value would make ${name} identical to another veteran already in your roster. Delete one of them or choose a different value.`
              : conflict === 'stale'
                ? `${(resolve.error as HttpError).problem?.detail ?? 'This item changed.'} The queue will refresh.`
                : `Couldn't save the fix. Retry. ${errorText(resolve.error)}`}
          </div>
        )}
        {dismissNote && (
          <div className="banner info" role="status">
            Dismiss isn't available yet: the API has no dismiss endpoint (Q-70). Fix the value instead,
            or leave the item open.
          </div>
        )}
        <div className="row">
          <button
            type="button"
            className="btn primary"
            disabled={!current || resolve.isPending}
            aria-busy={resolve.isPending}
            onClick={() => current && apply(current.value, current.label)}
          >
            Apply “{current?.label ?? '—'}” {!chosen && cands[0] && <Kbd>1</Kbd>}
          </button>
          <button
            type="button"
            className="btn"
            aria-disabled="true"
            title="No dismiss endpoint in the API yet (Q-70)"
            onClick={() => setDismissNote(true)}
          >
            Dismiss <Kbd>D</Kbd>
          </button>
          <span className="sp" style={{ flex: 1 }} />
          <span className="hint">
            <Kbd>J</Kbd> next · <Kbd>K</Kbd> previous
          </span>
        </div>
        <p className="hint">
          Applying updates the veteran and recomputes its fingerprint. If that collides with another veteran
          you'll see a conflict message.
        </p>
      </div>
    </section>
  );
}

function Crop({ cropKey, url }: { cropKey: string | null; url: string | null }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  if (!cropKey || !url) return <div className="crop muted">No crop stored for this field.</div>;
  return (
    <div>
      <div className="hint">{size ? `Crop from capture (${size.w} × ${size.h} px)` : 'Crop from capture'}</div>
      <div className="crop">
        {failed ? (
          <div className="row">
            <span className="muted">Crop failed to load.</span>
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                setFailed(false);
                setAttempt((a) => a + 1);
              }}
            >
              Retry
            </button>
          </div>
        ) : (
          <img
            key={attempt}
            src={url}
            alt="Captured crop of the field"
            onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            onError={() => setFailed(true)}
          />
        )}
      </div>
    </div>
  );
}
