/** S03 Review queue (F04). Keyboard: 1/2/3 apply a candidate, J/K next/previous, D (dismiss, Q-70). */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { ReviewItem, RosterVeteran } from '@uma/schema';
import { Page } from '../components/Layout.tsx';
import { Empty, ErrorBanner, Kbd, Loading, Tag } from '../components/atoms.tsx';
import { useMaster, useResolve, useReviewItems, useRoster } from '../app/queries.ts';
import { useServices } from '../app/services.ts';
import { errorText, HttpError } from '../api/errors.ts';
import { characterName, type MasterData } from '../master/load.ts';
import { candidateLabel, humanPath, numberError, resolutionFor, searchVocab, type Resolution } from '../lib/paths.ts';
import { GRADES } from '../lib/keys.ts';

const WEEK_MS = 7 * 86_400_000;

export function conflictKind(e: unknown): 'fingerprint' | 'stale' | null {
  if (!(e instanceof HttpError)) return null;
  if (e.status === 404) return 'stale';
  if (e.status !== 409) return null;
  const fp = e.problem?.errors?.some((x) => x.message === 'fingerprint collision');
  return fp || /duplicates an existing/.test(e.problem?.detail ?? '') ? 'fingerprint' : 'stale';
}

/**
 * The failure message for a resolve. It lives at screen level (S1): a 409/404 refreshes the queue,
 * which can remove the item and unmount its panel, and the user must still see why.
 */
export function resolveFailureText(e: unknown, name: string): string {
  const conflict = conflictKind(e);
  if (conflict === 'fingerprint')
    return `This value would make ${name} identical to another veteran already in your roster. Delete one of them or choose a different value.`;
  if (conflict === 'stale') {
    const detail = (e as HttpError).problem?.detail ?? 'This item changed.';
    return `${/[.!?]$/.test(detail) ? detail : `${detail}.`} The queue was refreshed.`;
  }
  return `Couldn't save the fix. Retry. ${errorText(e)}`;
}

export function ReviewScreen() {
  const open = useReviewItems('open');
  const resolved = useReviewItems('resolved');
  const roster = useRoster();
  const master = useMaster();
  const resolve = useResolve();
  const { now } = useServices();
  const [params] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

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
  const apply = (it: ReviewItem, value: unknown) => {
    if (resolve.isPending) return;
    const v = byId.get(it.veteranId);
    const name = v && master.data ? characterName(master.data, v.characterId) : 'this veteran';
    setFailure(null);
    resolve.mutate(
      { id: it.id, value },
      {
        onSuccess: () => setToast(`Fixed. ${items.length - 1} left.`),
        onError: (e) => setFailure(resolveFailureText(e, name)),
      },
    );
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
            onMove={move}
            onApply={(value) => apply(item, value)}
            pending={resolve.isPending}
          />
        )}
      </div>
    );

  return (
    <Page title="Review queue" actions={summary}>
      {failure && (
        <div className="banner err" role="alert">
          {failure}{' '}
          <button type="button" className="btn sm" onClick={() => setFailure(null)}>
            Dismiss message
          </button>
        </div>
      )}
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
  onMove,
  onApply,
  pending,
}: {
  item: ReviewItem;
  veteran: RosterVeteran | undefined;
  m: MasterData;
  onMove: (d: number) => void;
  onApply: (value: unknown) => void;
  pending: boolean;
}) {
  const { source } = useServices();
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<{ value: unknown; label: string } | null>(null);
  const [dismissNote, setDismissNote] = useState(false);
  const cands = item.field.candidates.slice(0, 3);
  const name = veteran ? characterName(m, veteran.characterId) : 'this veteran';
  const current = chosen ?? (cands[0] ? { value: cands[0].value, label: candidateLabel(cands[0].value, item.path, m).label } : null);
  const res = useMemo(() => resolutionFor(item.path, veteran), [item.path, veteran]);

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
          onApply(c.value);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const matches = useMemo(() => searchVocab(query, res, m, veteran), [query, res, m, veteran]);
  const conf = item.field.confidence;

  return (
    <section className="panel" aria-labelledby="item-title">
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
                    disabled={pending}
                    onClick={() => onApply(c.value)}
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
        {res.vocab !== null ? (
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
            {matches.length > 0 && (
              <div id="vocab-list" role="listbox" className="grid" style={{ gap: 2, marginTop: 4 }}>
                {matches.map((h) => (
                  <button
                    key={h.key}
                    type="button"
                    role="option"
                    aria-selected={chosen?.value === h.value}
                    className="cand"
                    onClick={() => setChosen({ value: h.value, label: h.label })}
                  >
                    <span>
                      <b>{h.label}</b> <span className="muted">· {h.kind}</span>
                    </span>
                    {h.value !== h.label && <span className="mono muted">{h.value}</span>}
                  </button>
                ))}
              </div>
            )}
            {query.trim().length >= 2 && matches.length === 0 && <p className="hint">No matches.</p>}
          </div>
        ) : (
          <ManualValue key={item.id} res={res} onChoose={setChosen} />
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
            disabled={!current || pending}
            aria-busy={pending}
            onClick={() => current && onApply(current.value)}
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

/** Typed value entry for leaves without a vocabulary (numbers, grades, flags, free text). */
function ManualValue({ res, onChoose }: { res: Resolution; onChoose: (c: { value: unknown; label: string } | null) => void }) {
  const [raw, setRaw] = useState('');
  if (res.value === 'none' || res.value === 'sparkList')
    return <p className="hint">This field can only be fixed with one of the candidates above.</p>;
  if (res.value === 'grade' || res.value === 'boolean') {
    const opts = res.value === 'grade' ? GRADES.map((g) => [g, g] as const) : ([['true', 'Yes'], ['false', 'No']] as const);
    return (
      <label className="field">
        <span>Enter the correct value</span>
        <select
          className="input w-sm"
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value);
            const o = opts.find(([v]) => v === e.target.value);
            onChoose(o ? { value: res.value === 'boolean' ? o[0] === 'true' : o[0], label: o[1] } : null);
          }}
        >
          <option value="">Choose…</option>
          {opts.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
    );
  }
  const err = raw.trim() === '' ? null : res.value === 'number' ? numberError(raw, res) : null;
  return (
    <div>
      <label className="field">
        <span>Enter the correct value</span>
        <input
          className="input w-sm"
          type={res.value === 'number' ? 'number' : 'text'}
          inputMode={res.value === 'number' ? 'numeric' : undefined}
          min={res.value === 'number' ? res.min : undefined}
          max={res.value === 'number' && res.max !== null ? res.max : undefined}
          value={raw}
          aria-invalid={err ? true : undefined}
          onChange={(e) => {
            const t = e.target.value;
            setRaw(t);
            const bad = t.trim() === '' || (res.value === 'number' && numberError(t, res) !== null);
            onChoose(bad ? null : { value: res.value === 'number' ? Number(t.trim()) : t, label: t.trim() });
          }}
        />
      </label>
      {err && (
        <p className="hint" role="status">
          {err}
        </p>
      )}
    </div>
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
