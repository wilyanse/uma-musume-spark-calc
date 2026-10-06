/** S06 Planner (F09, F11). */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { AptKey, CmTarget, Grade, RosterVeteran, StatKey, TrainMode } from '@uma/schema';
import type { RankProgress, RankResult, RankedPair, PlanInput } from '@uma/engine';
import { Page } from '../components/Layout.tsx';
import { Banner, Empty, ErrorBanner, GradeBadge, Loading, ProbBar, RangeBar, SparkPill, Tag } from '../components/atoms.tsx';
import { useMaster, useRoster, useTargets } from '../app/queries.ts';
import { useServices, type FixtureGolden } from '../app/services.ts';
import { contextKindFor, ensureModel, useEngineContext, type ModelOutcome } from '../app/engine.ts';
import { FIT_REASON_TEXT, type FitReason } from '../lib/model.ts';
import { characterName, outfitTitle, scenarioName, skillName, sparkName, type MasterData } from '../master/load.ts';
import { duplicateCards, isComplete, loadDeck, missing, saveDeck, type DeckDraft } from '../lib/deck.ts';
import { skillIssuesForTrainee, withoutSkills, type SkillIssue } from '../lib/targets.ts';
import { APT_LABEL, GRADES, LOW_DATA_N, STAT_KEYS, STAT_LABEL, gradeOrdinal } from '../lib/keys.ts';
import { readJson, storageKey, writeJson } from '../lib/storage.ts';
import { int, signed } from '../lib/format.ts';
import type { EngineErrorInfo } from '../workers/engine.api.ts';
import { engineErrorText } from '../app/engineErrors.ts';

interface Settings {
  traineeOutfitId: string;
  trainMode: TrainMode;
  scenarioId: string;
  targetId: string;
  lockParent1: string;
}
const blankSettings: Settings = { traineeOutfitId: '', trainMode: 'independent', scenarioId: '', targetId: '', lockParent1: '' };
const isSettings = (v: unknown): v is Settings =>
  !!v && typeof v === 'object' && ['traineeOutfitId', 'scenarioId', 'targetId', 'lockParent1'].every((k) => typeof (v as Record<string, unknown>)[k] === 'string') &&
  ((v as Settings).trainMode === 'independent' || (v as Settings).trainMode === 'manual');

type Phase =
  | { kind: 'idle' }
  | { kind: 'model'; reason: FitReason | null; cancel: (() => void) | null }
  | { kind: 'ranking'; progress: RankProgress | null; cancel: () => void; started: number }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string; engine?: EngineErrorInfo };

interface Ran {
  result: RankResult;
  elapsedMs: number;
  input: PlanInput;
  target: CmTarget;
  dropped: string[];
  snapshotN: number;
  coverage: number;
  kind: string;
  signature: string;
}

export function PlannerScreen() {
  const services = useServices();
  const { store, source, engine } = services;
  const qc = useQueryClient();
  const roster = useRoster();
  const master = useMaster();
  const targets = useTargets();
  const ctxQ = useEngineContext();
  const sKey = storageKey(source.kind, 'planner');
  const [settings, setSettingsState] = useState<Settings>(() => readJson(store, sKey, isSettings, blankSettings));
  const [deck, setDeckState] = useState<DeckDraft>(() => loadDeck(store, source.kind));
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [ran, setRan] = useState<Ran | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [dropIssues, setDropIssues] = useState<string[] | null>(null);
  const [golden, setGolden] = useState<FixtureGolden | null>(null);
  const runRef = useRef(0);
  const set = (p: Partial<Settings>) =>
    setSettingsState((s) => {
      const n = { ...s, ...p };
      writeJson(store, sKey, n);
      return n;
    });
  useEffect(() => () => { runRef.current++; engine.cancel(); }, [engine]);
  useEffect(() => {
    if (services.loadGolden) void services.loadGolden().then(setGolden);
  }, [services]);

  const m = master.data;
  const all = roster.data?.roster;
  const target = targets.data?.find((t) => t.id === settings.targetId) ?? null;
  const issues: SkillIssue[] = useMemo(
    () => (m && target && settings.traineeOutfitId ? skillIssuesForTrainee(target, settings.traineeOutfitId, m) : []),
    [m, target, settings.traineeOutfitId],
  );
  const traineeChar = m?.outfits.get(settings.traineeOutfitId)?.characterId;
  const lockOptions = useMemo(
    () => (all && m ? all.filter((v) => v.characterId !== traineeChar).map((v) => ({ id: v.id, label: `${characterName(m, v.characterId)} · ${v.rank} ${int(v.rating)} · ${v.id.slice(-6)}` })) : []),
    [all, m, traineeChar],
  );
  const lowData = all && settings.scenarioId ? all.filter((v) => v.scenarioId === settings.scenarioId && v.trainMode === settings.trainMode).length : null;
  const signature = JSON.stringify([settings, deck, target, roster.data?.etag ?? null, m?.version, ctxQ.data?.kind]);
  const busy = phase.kind === 'model' || phase.kind === 'ranking';

  const applyGoldenPlan = () => {
    if (!golden) return;
    const g = golden.golden;
    const t = targets.data?.find((x) => x.name === g.targetName);
    set({ traineeOutfitId: g.traineeOutfitId, trainMode: g.trainMode, scenarioId: g.scenarioId, targetId: t?.id ?? '' });
    const d: DeckDraft = g.planDeck.map((s) => ({ ...s }));
    setDeckState(d);
    saveDeck(store, source.kind, d);
  };

  const run = async (opts: { force?: FitReason } = {}) => {
    if (!m || !all || !target || !isComplete(deck) || !ctxQ.data) return;
    const drop = dropIssues ?? [];
    const runTarget = drop.length ? withoutSkills(target, drop) : target;
    const myRun = ++runRef.current;
    const live = () => runRef.current === myRun;
    setNotices([]);
    setOpen(null);
    setPhase({ kind: 'model', reason: null, cancel: null });
    const model: ModelOutcome = await ensureModel(services, qc, {
      roster: all,
      rosterEtag: roster.data?.etag ?? null,
      masterVersion: m.version,
      context: contextKindFor(services),
      force: opts.force,
      isCurrent: live,
      onFitStart: (reason, cancel) => live() && setPhase({ kind: 'model', reason, cancel }),
    });
    if (!live()) return;
    if (model.status === 'cancelled') return setPhase({ kind: 'cancelled' });
    if (model.status === 'error') return setPhase({ kind: 'error', message: model.engine ? engineErrorText(model.engine, m) : model.message, engine: model.engine });
    const n: string[] = [];
    if (model.legacy) n.push(`A legacy training-v1 snapshot (${model.legacy.id}) was left unchanged; a training-v2 model was fitted.`);
    if (model.fitted) n.push(`Model fitted because ${FIT_REASON_TEXT[model.fitted.reason]}.`);
    if (model.storeError) n.push(model.storeError);
    setNotices(n);
    const input: PlanInput = {
      traineeOutfitId: settings.traineeOutfitId,
      deck: deck.map((s) => ({ ...s! })),
      trainMode: settings.trainMode,
      scenarioId: settings.scenarioId,
      ...(settings.lockParent1 ? { lockParent1: settings.lockParent1 } : {}),
    };
    const started = (services.monotonicNow ?? (() => performance.now()))();
    const job = engine.rank(model.snapshot, input, all, runTarget, {}, (p) => {
      if (live()) setPhase((ph) => (ph.kind === 'ranking' ? { ...ph, progress: p } : ph));
    });
    setPhase({ kind: 'ranking', progress: null, cancel: job.cancel, started });
    const out = await job.promise;
    if (!live()) return;
    if (out.status === 'cancelled' || out.status === 'superseded') return setPhase({ kind: 'cancelled' });
    if (out.status === 'crashed') return setPhase({ kind: 'error', message: `Ranking failed: ${out.message}.` });
    if (!out.result.ok) return setPhase({ kind: 'error', message: `Ranking failed: ${engineErrorText(out.result.error, m)}`, engine: out.result.error });
    setRan({
      result: out.result.value,
      elapsedMs: (services.monotonicNow ?? (() => performance.now()))() - started,
      input,
      target: runTarget,
      dropped: drop,
      snapshotN: model.snapshot.nSamples,
      coverage: model.snapshot.params.holdout.coverage80,
      kind: model.snapshot.kind,
      signature,
    });
    setPhase({ kind: 'idle' });
  };

  const cancel = () => {
    runRef.current++;
    setPhase({ kind: 'cancelled' });
    if (phase.kind === 'ranking' || (phase.kind === 'model' && phase.cancel)) {
      (phase.kind === 'ranking' ? phase.cancel : phase.cancel!)();
    }
  };

  const modelLine = ran ? (
    <span className="hint" data-testid="model-line">
      Model {ran.kind} · fitted on {ran.snapshotN} veterans · 80% interval coverage {ran.coverage.toFixed(2)} (holdout)
    </span>
  ) : null;

  if (roster.isError || master.isError || targets.isError) {
    return (
      <Page title="Planner">
        <ErrorBanner text="Couldn't fit or load the model." />
        {roster.isError && <ErrorBanner text="Couldn't load your roster." onRetry={() => void roster.refetch()} />}
        {targets.isError && <ErrorBanner text="Couldn't load your targets." onRetry={() => void targets.refetch()} />}
      </Page>
    );
  }
  if (!m || !all || !targets.data) {
    return (
      <Page title="Planner">
        <Loading label="Loading planner…" />
      </Page>
    );
  }
  if (all.length < 2) {
    return (
      <Page title="Planner">
        <Empty>
          <p>Import at least 2 veterans to plan parents.</p>
        </Empty>
      </Page>
    );
  }

  const deckDups = duplicateCards(deck);
  const ready = !!settings.traineeOutfitId && !!settings.scenarioId && !!target && isComplete(deck) && deckDups.length === 0 && !!ctxQ.data;
  const blocking = issues.length > 0 && !(dropIssues && issues.every((i) => dropIssues.includes(i.skillId)));
  const stale = ran && ran.signature !== signature;
  const ctx = ctxQ.data;

  return (
    <Page title="Planner" actions={modelLine}>
      {ctxQ.isError && <ErrorBanner text={`Couldn't start the engine: ${(ctxQ.error as Error).message}`} onRetry={() => void ctxQ.refetch()} />}
      {ctx?.kind === 'golden-fixture' && (
        <Banner kind="warn">
          Golden fixture context (SYNTHETIC): published rules except {ctx.overrides.map((o) => o.rule).join(', ')} from golden-truth.json (Q-120). Not game facts.
        </Banner>
      )}
      {ctx?.kind === 'production' && ctx.unverifiedRules.length > 0 && (
        <Banner kind="info">
          ⚠ {ctx.unverifiedRules.length} inheritance rules are unverified ({ctx.placeholderRules.length} placeholders); predictions use them as published. See Health.
        </Banner>
      )}
      <div className="split">
        <section className="panel" aria-labelledby="plan-t">
          <header id="plan-t">Plan</header>
          <form className="body grid" onSubmit={(e) => { e.preventDefault(); if (ready && !blocking) void run(); }}>
            {golden && (
              <button type="button" className="btn" onClick={applyGoldenPlan}>
                Use golden plan (SYNTHETIC)
              </button>
            )}
            <label className="field">
              <span>Trainee (outfit)</span>
              <select className="input" value={settings.traineeOutfitId} onChange={(e) => { set({ traineeOutfitId: e.target.value }); setDropIssues(null); }}>
                <option value="">— choose —</option>
                {[...m.outfits.values()]
                  .map((o) => ({ id: o.id, label: `${characterName(m, o.characterId)} [${o.title}]` }))
                  .sort((a, b) => a.label.localeCompare(b.label))
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
              </select>
            </label>
            <div className="field">
              <span>
                Support deck <Link to="/cards">edit in Cards</Link>
              </span>
              <div className="row" style={{ gap: 4 }}>
                {deck.map((s, i) =>
                  s ? (
                    <span key={i} className={`chip${s.borrowed ? ' sel' : ''}`}>
                      {s.borrowed ? 'Friend: ' : ''}
                      {m.cards.get(s.cardId)?.name ?? s.cardId} {'◆'.repeat(s.lb)}
                      <span className="sr"> LB{s.lb}</span>
                    </span>
                  ) : (
                    <span key={i} className="chip muted">
                      Slot {i + 1} empty
                    </span>
                  ),
                )}
              </div>
              {!isComplete(deck) && <span className="hint">Choose a full deck in Cards first ({missing(deck)} missing).</span>}
              {deckDups.length > 0 && <span className="err-text">A card is in the deck twice.</span>}
            </div>
            <div className="field">
              <span id="pm-l">Train mode</span>
              <div className="seg" role="radiogroup" aria-labelledby="pm-l">
                {(['independent', 'manual'] as const).map((md) => (
                  <label key={md}>
                    <input type="radio" name="pmode" checked={settings.trainMode === md} onChange={() => set({ trainMode: md })} />
                    {md === 'independent' ? 'Independent' : 'Manual'}
                  </label>
                ))}
              </div>
            </div>
            <label className="field">
              <span>Scenario</span>
              <select className="input" value={settings.scenarioId} onChange={(e) => set({ scenarioId: e.target.value })}>
                <option value="">— choose —</option>
                {m.bundle.scenarios.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>
                CM target {target && <Link to={`/targets/${target.id}`}>edit</Link>}
              </span>
              <select className="input" value={settings.targetId} onChange={(e) => { set({ targetId: e.target.value }); setDropIssues(null); }}>
                <option value="">— choose —</option>
                {targets.data.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              {targets.data.length === 0 && (
                <span className="hint">
                  Create a CM target first. <Link to="/targets/new">New target</Link>
                </span>
              )}
            </label>
            <label className="field">
              <span>Lock parent 1 (optional)</span>
              <select className="input" value={settings.lockParent1} onChange={(e) => set({ lockParent1: e.target.value })}>
                <option value="">— none —</option>
                {lockOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            {issues.length > 0 && (
              <div className="banner warn" role="status">
                <div>
                  <p style={{ margin: 0 }}>This target can't be ranked as-is for {m.outfits.get(settings.traineeOutfitId)?.title ?? 'this trainee'}:</p>
                  <ul style={{ margin: '4px 0' }}>
                    {issues.map((i) => (
                      <li key={i.skillId}>
                        {i.reason === 'own-unique'
                          ? `${skillName(m, i.skillId)} is the trainee's own unique skill: not modelled for this trainee (Q-142).`
                          : `${i.skillId} is not in master data ${m.version}.`}{' '}
                        ({i.where})
                      </li>
                    ))}
                  </ul>
                  {!dropIssues ? (
                    <button type="button" className="btn sm" onClick={() => setDropIssues(issues.map((i) => i.skillId))}>
                      Rank without them (this run only)
                    </button>
                  ) : (
                    <span className="hint">They will be left out of this ranking; the saved target is unchanged.</span>
                  )}
                </div>
              </div>
            )}
            <div className="row">
              <button type="submit" className="btn primary" disabled={!ready || blocking || busy} aria-busy={busy}>
                Rank pairs
              </button>
              <button type="button" className="btn" disabled={!busy || (phase.kind === 'model' && !phase.cancel)} onClick={cancel}>
                Cancel
              </button>
            </div>
          </form>
        </section>
        <div className="grid" style={{ alignContent: 'start' }}>
          {lowData !== null && lowData < LOW_DATA_N && (
            <Banner kind="warn">
              Low data: fewer than 10 veterans for {scenarioName(m, settings.scenarioId)} · {settings.trainMode}. Treat these numbers as rough.
            </Banner>
          )}
          {notices.map((n) => (
            <Banner key={n} kind="info">
              {n}
            </Banner>
          ))}
          <StatusPanel phase={phase} ran={ran} onRefit={() => void run({ force: 'corrupt' })} />
          {stale && <Banner kind="warn">These results are for earlier settings. Rank again to update them.</Banner>}
          {ran && <Results ran={ran} m={m} roster={all} open={open} setOpen={setOpen} />}
        </div>
      </div>
    </Page>
  );
}

function StatusPanel({ phase, ran, onRefit }: { phase: Phase; ran: Ran | null; onRefit: () => void }) {
  if (phase.kind === 'model') {
    return (
      <section className="panel" aria-live="polite">
        <div className="body grid">
          <b>{phase.reason ? `The model needs fitting before ranking (${FIT_REASON_TEXT[phase.reason]}). Fitting in the worker…` : 'Loading the model…'}</b>
          <div className="progress" role="progressbar" aria-label="Fitting" aria-busy="true">
            <i style={{ width: '100%', opacity: 0.4 }} />
          </div>
        </div>
      </section>
    );
  }
  if (phase.kind === 'ranking') {
    const p = phase.progress;
    const pct = p ? (p.phase === 'fast' ? (p.done / p.total) * 0.8 : 0.8 + (p.done / p.total) * 0.2) : 0;
    return (
      <section className="panel" aria-live="polite">
        <div className="body grid">
          <b data-testid="rank-progress">
            {p ? (p.phase === 'fast' ? `Ranking… ${int(p.done)} of ${int(p.total)} pairs (fast pass)` : `Monte Carlo… ${p.done} of ${p.total} top pairs`) : 'Ranking…'}
          </b>
          <div className="progress" role="progressbar" aria-label="Ranking progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)}>
            <i style={{ width: `${pct * 100}%` }} />
          </div>
          <span className="hint">Fast pass → Monte Carlo on top 100 (2,000 samples each)</span>
        </div>
      </section>
    );
  }
  if (phase.kind === 'cancelled') {
    return <Banner kind="info">Ranking cancelled. The engine ranks in one step, so there are no partial results{ran ? '; the previous results are still shown' : ''}.</Banner>;
  }
  if (phase.kind === 'error') {
    const corrupt = phase.engine?.name === 'RefitRequiredError' && phase.engine.reason !== 'legacy-kind';
    return (
      <div className="banner err" role="alert">
        <span>{phase.message}</span>
        {corrupt && (
          <button type="button" className="btn sm" onClick={onRefit}>
            Refit model
          </button>
        )}
      </div>
    );
  }
  if (!ran) return <Empty>Set up the plan and rank pairs.</Empty>;
  return null;
}

function reqText(r: RankedPair['bottleneck'], m: MasterData): string {
  if (!r) return '—';
  if (r.kind === 'stat') return `${STAT_LABEL[r.key]} (min ${r.min})`;
  if (r.kind === 'aptitude') return `${APT_LABEL[r.key]} ≥ ${r.min}`;
  return skillName(m, r.key);
}

function Results({ ran, m, roster, open, setOpen }: { ran: Ran; m: MasterData; roster: RosterVeteran[]; open: number | null; setOpen: (n: number | null) => void }) {
  const byId = useMemo(() => new Map(roster.map((v) => [v.id, v])), [roster]);
  const r = ran.result;
  const name = (id: string) => {
    const v = byId.get(id);
    return v ? characterName(m, v.characterId) : id;
  };
  const low = ran.snapshotN < LOW_DATA_N;
  if (r.results.length === 0) {
    return <Empty>{r.locked ? 'No legal partner for the locked parent.' : 'No legal pairs. Parents must be different characters and differ from the trainee.'}</Empty>;
  }
  return (
    <>
      <section className="panel">
        <div className="body grid">
          <b data-testid="rank-done" data-ms={Math.round(ran.elapsedMs)} data-pairs={r.evaluatedPairs}>
            Ranked {int(r.evaluatedPairs)} legal pairs in {(ran.elapsedMs / 1000).toFixed(1)} s · showing top {r.results.length} of {r.preciseEvaluated} re-scored
          </b>
          <div className="progress" aria-hidden="true">
            <i style={{ width: '100%' }} />
          </div>
          <span className="hint">
            Fast pass → Monte Carlo on top {r.preciseEvaluated} ({int(r.results[0]!.prediction.samples)} samples each)
            {r.excludedVeterans.length > 0 && ` · ${r.excludedVeterans.length} veterans excluded (trainee's character)`}
            {ran.dropped.length > 0 && ` · left out: ${ran.dropped.map((s) => skillName(m, s)).join(', ')}`}
          </span>
          {!r.results[0]!.prediction.provenance.eventsKnown && (
            <span className="hint">
              ⚠ This scenario lists no inheritance turns in master data (Q-5): event rolls contribute nothing; only career-start effects apply.
            </span>
          )}
        </div>
      </section>
      <div className="tbl-wrap fit2">
        <table>
          <caption className="sr">Ranked parent pairs</caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Parent 1</th>
              <th scope="col">Parent 2</th>
              <th scope="col">P(meet target)</th>
              <th scope="col" className="num hm">Stat surplus</th>
              <th scope="col" className="num hm">Affinity</th>
              <th scope="col" className="hm">Bottleneck</th>
            </tr>
          </thead>
          <tbody>
            {r.results.map((p, i) => (
              <Fragment key={p.parents.join('|')}>
                <tr className={open === i ? 'open' : undefined}>
                  <td>
                    <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                      <button
                        type="button"
                        className="btn sm"
                        aria-expanded={open === i}
                        aria-label={open === i ? `Collapse details for pair ${p.rank}` : `Expand details for pair ${p.rank}`}
                        onClick={() => setOpen(open === i ? null : i)}
                      >
                        {open === i ? '▾' : '▸'}
                      </button>
                      {p.rank}
                    </span>
                  </td>
                  <th scope="row">
                    <Link to={`/veterans/${p.parents[0]}`}>
                      <b>{name(p.parents[0])}</b>
                    </Link>
                  </th>
                  <td>
                    <Link to={`/veterans/${p.parents[1]}`}>
                      <b>{name(p.parents[1])}</b>
                    </Link>
                  </td>
                  <td>
                    <ProbBar p={p.pMeet} n={ran.snapshotN} lowData={low} />
                  </td>
                  <td className="num hm">{signed(p.surplus)}</td>
                  <td className="num hm">{int(p.affinity.total)}</td>
                  <td className="hm">{reqText(p.bottleneck, m)}</td>
                </tr>
                {open === i && (
                  <tr>
                    <td colSpan={7} className="detail">
                      <PairDetail p={p} ran={ran} m={m} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function PairDetail({ p, ran, m }: { p: RankedPair; ran: Ran; m: MasterData }) {
  const pred = p.prediction;
  const t = ran.target;
  const minStats = t.minStats as Partial<Record<StatKey, number>>;
  const minApts = t.minAptitudes as Partial<Record<AptKey, Grade>>;
  const outfit = m.outfits.get(ran.input.traineeOutfitId);
  const lo = Math.min(...STAT_KEYS.map((k) => Math.min(pred.stats[k].p10, minStats[k] ?? Infinity)));
  const hi = Math.max(...STAT_KEYS.map((k) => Math.max(pred.stats[k].p90, minStats[k] ?? -Infinity)));
  const pad = Math.max(20, (hi - lo) * 0.1);
  const a0 = Math.max(0, lo - pad);
  const a1 = Math.min(pred.statCap, hi + pad);
  const pos = (x: number) => Math.max(0, Math.min(100, ((x - a0) / (a1 - a0 || 1)) * 100));
  const aptKeys: AptKey[] = [...new Set<AptKey>([t.course.surface, t.course.distance, t.style, ...(Object.keys(minApts) as AptKey[])])];
  const skills = [
    ...t.requiredSkills.map((s) => ({ id: s, req: true, w: null as number | null })),
    ...t.optionalSkills.map((o) => ({ id: o.skillId, req: false, w: o.weight })),
  ];
  const contribs = [...p.contributions].sort((a, b) => b.pAny - a.pAny).slice(0, 6);
  return (
    <div className="detailgrid">
      <div>
        <h4>Predicted stats · mean and p10–p90 vs target (dashed) · model n={ran.snapshotN}</h4>
        {STAT_KEYS.map((k) => {
          const s = pred.stats[k];
          const tg = minStats[k];
          return (
            <div key={k} className="statrow">
              <span>{STAT_LABEL[k]}</span>
              <RangeBar lo={pos(s.p10)} mean={pos(s.mean)} hi={pos(s.p90)} tgt={tg !== undefined ? pos(tg) : null} />
              <span className="val">
                {int(s.mean)} <span className="muted">({int(s.p10)}–{int(s.p90)})</span> / {tg !== undefined ? tg : <span className="muted">No requirement</span>}
              </span>
            </div>
          );
        })}
        <p className="hint">
          Interval from {int(pred.samples)} simulated children. Stat cap {pred.statCap}.
          {pred.featureWarnings.unseenCards.length > 0 && ` Deck cards unseen in training: ${pred.featureWarnings.unseenCards.length}.`}
          {pred.featureWarnings.unseenCell && ' This scenario · mode cell was not seen in training.'}
        </p>
      </div>
      <div>
        <h4>Aptitude before → after · model n={ran.snapshotN}</h4>
        {aptKeys.map((k) => {
          const dist = pred.aptitudes[k];
          const before = outfit?.aptitudes[k];
          const need = minApts[k];
          const top = (Object.entries(dist) as [Grade, number][]).sort((a, b) => b[1] - a[1])[0]![0];
          const pAt = need ? GRADES.filter((g) => gradeOrdinal(g) >= gradeOrdinal(need)).reduce((s, g) => s + (dist[g] ?? 0), 0) : null;
          return (
            <div key={k} className="row" style={{ gap: 6, marginBottom: 4 }}>
              <span style={{ width: 64 }}>{APT_LABEL[k]}</span>
              {before ? <GradeBadge g={before} /> : '—'} → <GradeBadge g={top} />
              {need && (
                <span className="muted">
                  {(pAt! * 100).toFixed(0)}% ≥ {need}
                </span>
              )}
              {p.bottleneck?.kind === 'aptitude' && p.bottleneck.key === k && <Tag kind="warn">bottleneck</Tag>}
            </div>
          );
        })}
        <h4 style={{ marginTop: 'var(--space-3)' }}>Skills · P(acquired)</h4>
        {skills.length === 0 && <p className="muted">No skills in this target.</p>}
        {skills.map((s) => {
          const sp = pred.skills[s.id];
          return (
            <div key={s.id} className="contrib">
              <span>
                {skillName(m, s.id)} {s.req ? '' : <small className="muted">(optional ×{s.w})</small>}
              </span>
              <span>
                {sp ? <b>{(sp.pAcquireMc * 100).toFixed(0)}%</b> : <span className="muted">—</span>}{' '}
                {sp?.thetaFromPrior && <Tag kind="warn">prior only</Tag>}
                {p.bottleneck?.kind === 'skill' && p.bottleneck.key === s.id && <Tag kind="warn">bottleneck</Tag>}
              </span>
            </div>
          );
        })}
        <p className="hint">Per-skill sample counts aren't stored in the snapshot (Q-76); “prior only” = no evidence for this skill in this mode.</p>
      </div>
      <div>
        <h4>Spark contributions (top)</h4>
        <div className="contrib">
          {contribs.map((c, i) => (
            <Fragment key={`${c.sparkId}-${c.from}-${i}`}>
              <span>
                <SparkPill type={c.type} name={sparkName(m, c.sparkId)} stars={c.stars} /> <small className="muted">{c.from}</small>
              </span>
              <span>{(c.pAny * 100).toFixed(0)}%</span>
            </Fragment>
          ))}
        </div>
        <h4 style={{ marginTop: 'var(--space-3)' }}>Affinity · total {int(p.affinity.total)}</h4>
        <div className="contrib">
          {p.affinity.breakdown
            .filter((b) => b.points !== 0)
            .map((b) => (
              <Fragment key={b.label}>
                <span>{b.label}</span>
                <span>{int(b.points)}</span>
              </Fragment>
            ))}
        </div>
        {p.affinity.unsupportedTerms.length > 0 && <p className="hint">Not included: {p.affinity.unsupportedTerms.join('; ')}.</p>}
        <p className="hint">
          {outfitTitle(m, ran.input.traineeOutfitId)} · {scenarioName(m, ran.input.scenarioId)} · {ran.input.trainMode}
        </p>
      </div>
    </div>
  );
}
