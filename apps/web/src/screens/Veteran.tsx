/** S02 Veteran detail (F05, F02). */
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { CaptureField, RosterVeteranDetail, TrainMode } from '@uma/schema';
import { Page } from '../components/Layout.tsx';
import {
  Avatar,
  Banner,
  Empty,
  ErrorBanner,
  GradeBadge,
  LbDiamonds,
  Loading,
  SparkPill,
  Tag,
  TypeChip,
} from '../components/atoms.tsx';
import { useDeleteVeteran, useMaster, usePatchMode, useVeteran } from '../app/queries.ts';
import { errorText, isStatus } from '../api/errors.ts';
import {
  characterName,
  outfitTitle,
  scenarioName,
  skillName,
  sparkName,
  type MasterData,
} from '../master/load.ts';
import { APT_GROUPS, APT_LABEL, STAT_KEYS, STAT_LABEL } from '../lib/keys.ts';
import { int } from '../lib/format.ts';

const TABS = ['skills', 'sparks', 'deck', 'lineage'] as const;
type TabKey = (typeof TABS)[number];

function reviewHref(veteranId: string, path: string) {
  return `/review?veteran=${encodeURIComponent(veteranId)}&path=${encodeURIComponent(path)}`;
}

function LowConf({ field, veteranId, children }: { field: CaptureField | undefined; veteranId: string; children: ReactNode }) {
  if (!field || field.status !== 'low_confidence') return <>{children}</>;
  return (
    <Link className="lowconf" to={reviewHref(veteranId, field.path)} title="Low confidence — review">
      {children}
    </Link>
  );
}

export function VeteranScreen() {
  const { id = '' } = useParams();
  const q = useVeteran(id);
  const master = useMaster();
  const navigate = useNavigate();
  const del = useDeleteVeteran();
  const [confirm, setConfirm] = useState(false);
  const back = (
    <Link className="btn" to="/roster">
      ← Roster
    </Link>
  );

  if (q.isError) {
    const gone = isStatus(q.error, 404);
    return (
      <Page title="Veteran detail" actions={back}>
        {gone ? (
          <Empty>
            <p>This veteran no longer exists.</p>
            <Link to="/roster">Back to the roster</Link>
          </Empty>
        ) : (
          <ErrorBanner text={errorText(q.error)} onRetry={() => void q.refetch()} />
        )}
      </Page>
    );
  }
  if (!q.data || !master.data) {
    return (
      <Page title="Veteran detail" actions={back}>
        <Loading label="Loading veteran…" rows={6} />
      </Page>
    );
  }
  const v = q.data;
  const m = master.data;
  const name = characterName(m, v.characterId);
  return (
    <Page
      title="Veteran detail"
      actions={
        <>
          {back}
          <button type="button" className="btn danger" onClick={() => setConfirm(true)}>
            Delete
          </button>
        </>
      }
    >
      <Detail key={v.id} v={v} m={m} />
      {confirm && (
        <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="del-t">
          <div>
            <h2 id="del-t">Delete this veteran?</h2>
            <p>This removes {name} and its review items. Re-importing the same capture will add it back.</p>
            {del.isError && <p className="err-text">{errorText(del.error)}</p>}
            <div className="row">
              <button type="button" className="btn" onClick={() => setConfirm(false)} autoFocus>
                Cancel
              </button>
              <button
                type="button"
                className="btn danger"
                aria-busy={del.isPending}
                disabled={del.isPending}
                onClick={() =>
                  del.mutate(v.id, {
                    onSuccess: () => void navigate('/roster'),
                  })
                }
              >
                Delete veteran
              </button>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}

function Detail({ v, m }: { v: RosterVeteranDetail; m: MasterData }) {
  const patch = usePatchMode(v.id);
  const submitting = useRef(false);
  const [tab, setTab] = useState<TabKey>('sparks');
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const byPath = new Map(v.fields.map((f) => [f.path, f]));
  const low = v.fields.filter((f) => f.status === 'low_confidence');
  const name = characterName(m, v.characterId);
  const cap = m.scenarios.get(v.scenarioId)?.statCap ?? null;
  const setMode = (mode: TrainMode) => {
    if (mode === v.trainMode || submitting.current || patch.isPending) return;
    submitting.current = true;
    // Hook handles optimistic rollback/invalidation. Always unlock, even after panel unmount;
    // keyed detail panels isolate a new veteran from the old request's settlement.
    void patch.mutateAsync(mode).catch(() => undefined).finally(() => { submitting.current = false; });
  };
  const onTabKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + TABS.length) % TABS.length;
    setTab(TABS[n]!);
    tabRefs.current[n]?.focus();
  };

  return (
    <>
      {low.length > 0 && (
        <Banner kind="warn">
          ⚠ {low.length} field(s) have low confidence (dotted underline).{' '}
          <Link to={reviewHref(v.id, low[0]!.path)}>Review them</Link>
        </Banner>
      )}
      {patch.isError && <ErrorBanner text="Couldn't change the train mode. It has been reverted." />}
      <section className="panel" aria-label="Veteran header">
        <div className="body row" style={{ alignItems: 'flex-start' }}>
          <Avatar name={name} lg />
          <div style={{ flex: 1 }}>
            <div className="muted">[{outfitTitle(m, v.outfitId)}]</div>
            <h2 style={{ fontSize: 'var(--type-lg)' }}>{name}</h2>
            <div className="row" style={{ gap: 8, marginTop: 4 }}>
              <span className="rank" style={{ fontSize: 'var(--type-md)' }}>
                <LowConf field={byPath.get('/rank')} veteranId={v.id}>
                  {v.rank}
                </LowConf>
              </span>
              <b style={{ fontSize: 'var(--type-md)' }}>
                <LowConf field={byPath.get('/rating')} veteranId={v.id}>
                  {int(v.rating)}
                </LowConf>
              </b>
              <span className="chip">
                <LowConf field={byPath.get('/epithet')} veteranId={v.id}>
                  {v.epithet}
                </LowConf>
              </span>
            </div>
          </div>
          <div className="field">
            <span id="mode-l">
              Train mode {v.modeSource === 'override' ? '(overridden)' : '(detected from epithet)'}
            </span>
            <div className="seg" role="radiogroup" aria-labelledby="mode-l" aria-busy={patch.isPending}>
              {(['independent', 'manual'] as const).map((md) => (
                <label key={md}>
                  <input
                    type="radio"
                    name="mode"
                    checked={v.trainMode === md}
                    disabled={patch.isPending}
                    onChange={() => setMode(md)}
                  />
                  {md === 'independent' ? 'Independent' : 'Manual'}
                </label>
              ))}
            </div>
            <span className="hint">Overrides are kept on re-import.</span>
          </div>
        </div>
      </section>

      <div className="stat5" style={{ margin: 'var(--space-3) 0' }} role="group" aria-label="Stats">
        {STAT_KEYS.map((k) => (
          <div key={k}>
            <small>{STAT_LABEL[k]}</small>
            <b>
              <LowConf field={byPath.get(`/stats/${k}`)} veteranId={v.id}>
                {v.stats[k]}
              </LowConf>
            </b>
            <div className="cap" aria-hidden="true">
              <i style={{ width: cap ? `${Math.min(100, (v.stats[k] / cap) * 100)}%` : '0%' }} />
            </div>
          </div>
        ))}
      </div>
      {cap === null && <p className="hint">Stat cap unknown for {v.scenarioId}; bars hidden.</p>}

      <section className="panel" aria-label="Aptitudes">
        <div className="body">
          {APT_GROUPS.map((g) => (
            <div key={g.label} className="aptrow">
              <span>{g.label}</span>
              <div className="cells">
                {g.keys.map((k) => (
                  <span key={k} className="cell">
                    <LowConf field={byPath.get(`/aptitudes/${k}`)} veteranId={v.id}>
                      {APT_LABEL[k]}
                    </LowConf>
                    <GradeBadge g={v.aptitudes[k]} />
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="tabset" style={{ marginTop: 'var(--space-4)' }}>
        <div className="tablist" role="tablist" aria-label="Veteran sections">
          {TABS.map((t, i) => (
            <button
              key={t}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`tab-${t}`}
              aria-selected={tab === t}
              aria-controls={`panel-${t}`}
              tabIndex={tab === t ? 0 : -1}
              onClick={() => setTab(t)}
              onKeyDown={(e) => onTabKey(e, i)}
            >
              {t[0]!.toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === 'skills' && <SkillsTab v={v} m={m} byPath={byPath} />}
          {tab === 'sparks' && <SparksTab v={v} m={m} byPath={byPath} />}
          {tab === 'deck' && <DeckTab v={v} m={m} />}
          {tab === 'lineage' && <LineageTab v={v} m={m} />}
        </div>
      </div>
    </>
  );
}

type TabProps = { v: RosterVeteranDetail; m: MasterData; byPath?: Map<string, CaptureField> };

function SkillsTab({ v, m, byPath }: TabProps) {
  if (v.skills.length === 0) return <Empty>No skills were recorded.</Empty>;
  return (
    <div className="skills">
      {v.skills.map((s, i) => {
        const unique = m.skills.get(s.skillId)?.rarity === 'unique';
        return (
          <div key={s.skillId} className={`skill${unique ? ' unique' : ''}`}>
            <LowConf field={byPath?.get(`/skills/${i}/skillId`)} veteranId={v.id}>
              {skillName(m, s.skillId)}
            </LowConf>
            {s.level !== null && <span>Lvl {s.level}</span>}
          </div>
        );
      })}
    </div>
  );
}

function SparksTab({ v, m, byPath }: TabProps) {
  const groups = [
    ['self', 'Self', null],
    ['parent1', 'Parent 1', v.parents.find((p) => p.slot === 1)],
    ['parent2', 'Parent 2', v.parents.find((p) => p.slot === 2)],
  ] as const;
  return (
    <div className="sparkgroups">
      {groups.map(([owner, label, parent]) => {
        const list = v.sparks.map((s, i) => ({ s, i })).filter((x) => x.s.owner === owner);
        const blockField = byPath?.get(`/sparks/${owner}`);
        return (
          <div key={owner} className="sparkgroup">
            <h3>
              {label}
              {parent && <> · {characterName(m, parent.characterId)}</>}
              {parent?.outfitId && <small className="muted"> [{outfitTitle(m, parent.outfitId)}]</small>}
              {parent?.isGuest && <Tag kind="warn">Guest</Tag>}
            </h3>
            {list.length === 0 ? (
              <p className="muted">
                No sparks were read for this group.{' '}
                {blockField?.status === 'low_confidence' && (
                  <Link to={reviewHref(v.id, blockField.path)}>Review missing sparks</Link>
                )}
              </p>
            ) : (
              <div className="sparklist">
                {list.map(({ s, i }) => {
                  const f =
                    byPath?.get(`/sparks/${i}/sparkId`) ?? byPath?.get(`/sparks/${i}/stars`) ?? byPath?.get(`/sparks/${i}`);
                  const pill = <SparkPill type={s.type} name={sparkName(m, s.sparkId)} stars={s.stars} />;
                  return f?.status === 'low_confidence' ? (
                    <LowConf key={`${s.sparkId}-${i}`} field={f} veteranId={v.id}>
                      {pill}
                    </LowConf>
                  ) : (
                    <span key={`${s.sparkId}-${i}`} style={{ width: '100%' }}>
                      {pill}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DeckTab({ v, m }: TabProps) {
  return (
    <div className="deckrow">
      {[...v.deck]
        .sort((a, b) => a.slot - b.slot)
        .map((d) => {
          const c = m.cards.get(d.cardId);
          return (
            <div key={d.slot} className={`cardtile${d.borrowed ? ' friend' : ''}`}>
              <div className="art">
                <span className="rar">{c?.rarity ?? '?'}</span>art
              </div>
              <b>{c?.name ?? d.cardId}</b>
              {c && <small className="muted">{c.title}</small>}
              {c && <TypeChip type={c.type} />}
              <LbDiamonds n={d.lb} />
              <span>Lv {d.level}</span>
              {d.borrowed && <Tag kind="neutral">Friend</Tag>}
            </div>
          );
        })}
    </div>
  );
}

function LineageTab({ v, m }: TabProps) {
  return (
    <>
      <div className="lineage">
        {[...v.parents]
          .sort((a, b) => a.slot - b.slot)
          .map((p) => (
            <section key={p.slot} className="panel" aria-label={`Parent ${p.slot}`}>
              <header>
                Parent {p.slot} · {characterName(m, p.characterId)}
                {p.isGuest && <Tag kind="warn">Guest</Tag>}
              </header>
              <div className="body grid">
                <span>Outfit: {p.outfitId ? outfitTitle(m, p.outfitId) : '—'}</span>
                {p.isGuest ? (
                  <>
                    <span>Guest trainer: {p.guestTrainer ?? '—'}</span>
                    <span className="muted">Guests can't be linked to a roster veteran.</span>
                  </>
                ) : p.matchedVeteranId ? (
                  <span>
                    <Tag kind="ok">Matched in roster</Tag>{' '}
                    <Link to={`/veterans/${p.matchedVeteranId}`}>Open veteran →</Link>
                  </span>
                ) : (
                  <span className="muted">Not in your roster</span>
                )}
              </div>
            </section>
          ))}
      </div>
      <section className="panel" style={{ marginTop: 'var(--space-3)' }} aria-label="Career">
        <header>Career</header>
        <div className="body">
          <dl className="form2" style={{ margin: 0 }}>
            <div>
              <dt className="muted">Scenario</dt>
              <dd>{scenarioName(m, v.scenarioId)}</dd>
            </div>
            <div>
              <dt className="muted">Races</dt>
              <dd>{v.career.races}</dd>
            </div>
            <div>
              <dt className="muted">Wins</dt>
              <dd>{v.career.wins}</dd>
            </div>
            <div>
              <dt className="muted">Fans</dt>
              <dd>{v.career.fans === null ? '—' : int(v.career.fans)}</dd>
            </div>
            <div>
              <dt className="muted">Acquired</dt>
              <dd className="mono">{v.career.dateAcquired}</dd>
            </div>
          </dl>
        </div>
      </section>
    </>
  );
}
