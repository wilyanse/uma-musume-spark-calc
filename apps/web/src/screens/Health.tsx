/** S07 Model health (F12). */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Rules } from '@uma/schema';
import { Page } from '../components/Layout.tsx';
import { Banner, Empty, ErrorBanner, Loading, Tag } from '../components/atoms.tsx';
import { useMaster, useRoster } from '../app/queries.ts';
import { useServices } from '../app/services.ts';
import { ensureModel, useEngineContext, useLatestSnapshot, useLocalModel, useSessionFit, type EngineContextState } from '../app/engine.ts';
import { errorText } from '../api/errors.ts';
import { scenarioName } from '../master/load.ts';
import { COVERAGE_BAND, LOW_DATA_N, STAT_KEYS, STAT_LABEL } from '../lib/keys.ts';
import { dateTime, titleCase } from '../lib/format.ts';
import { engineErrorText } from '../app/engineErrors.ts';
import { decideModel, isReadableSnapshot, loadFitRecord } from '../lib/model.ts';
import type { EngineErrorInfo } from '../workers/engine.api.ts';
import type { MasterData } from '../master/load.ts';
import { setSessionCalibration, useSessionCalibration } from '../app/calibration.ts';
import { provenanceKey, provenanceOf, staleReasons, type CalibrationProvenance } from '../lib/calibration.ts';
import { CalibrationReportView } from '../components/CalibrationReport.tsx';
import { ulid } from '../lib/ulid.ts';
import { applyEligibility, applyProposal, resetOverride, type ApplyProposal } from '../app/rulesApply.ts';
import { storedOverrideRaw } from '../app/rulesSession.ts';
import { localModelMismatch } from '../lib/rulesOverride.ts';

type CalState =
  | { state: 'idle' }
  | { state: 'running'; cancel: () => void }
  | { state: 'cancelled' }
  | { state: 'refused'; message: string }
  | { state: 'error'; message: string };

/** One active Health job (refit, calibration or apply), held synchronously so same-tick clicks can't race. */
interface OwnedJob {
  kind: 'refit' | 'calibrate' | 'apply';
  id: number;
  cancel: (() => void) | null;
  provenance?: CalibrationProvenance;
}

type ApplyState =
  | { state: 'idle' }
  | { state: 'confirm'; proposal: ApplyProposal }
  | { state: 'running'; cancel: () => void }
  | { state: 'done'; kind: 'ok' | 'info' | 'warn' | 'err'; message: string };

type ResetState = { state: 'idle' } | { state: 'confirm'; storedRaw: string | null; clearOnly: boolean };

const baseLabel = (ctx: EngineContextState) =>
  ctx.kind === 'golden-fixture' ? 'the SYNTHETIC golden fixture base context (fixture mode; not the published rules)' : `the published rules (${ctx.baseRulesVersion})`;
const triple = (t: readonly number[]) => t.map((x) => (Math.round(x * 1e4) / 1e4).toString()).join(' / ');

function calibrationErrorText(e: EngineErrorInfo, m?: MasterData): string {
  if (e.name === 'ModelInputError') return `invalid roster or calibration input (${e.code}): ${e.message}`;
  if (e.name === 'NotConfiguredError') return `the engine context isn't configured: ${e.message}`;
  return engineErrorText(e, m);
}

/** One row per rules.json entry (01 §12): its numbers, verified flag and source. */
export function rulesRows(rules: Rules): { rule: string; value: string; verified: boolean; source: string }[] {
  const star = (t: { '1': number; '2': number; '3': number }) => `1★ ${t['1']} · 2★ ${t['2']} · 3★ ${t['3']}`;
  const open = (t: Record<string, unknown>) => {
    const keys = Object.keys(t).filter((k) => k !== 'verified' && k !== 'source');
    return keys.length ? `table: ${keys.join(', ')}` : '—';
  };
  return [
    ...(['blue', 'pink', 'green', 'white'] as const).map((k) => ({ rule: `activation.${k}`, value: star(rules.activation[k]), verified: rules.activation[k].verified, source: rules.activation[k].source })),
    { rule: 'affinityMultiplier', value: rules.affinityMultiplier.formula, verified: rules.affinityMultiplier.verified, source: rules.affinityMultiplier.source },
    { rule: 'grandparentWeight', value: String(rules.grandparentWeight.value), verified: rules.grandparentWeight.verified, source: rules.grandparentWeight.source },
    ...(['blueStatGain', 'blueInitialBonus', 'pinkGradeGain', 'whiteHintLevels'] as const).map((k) => ({ rule: k, value: star(rules[k]), verified: rules[k].verified, source: rules[k].source })),
    { rule: 'raceSparkStatGain', value: open(rules.raceSparkStatGain), verified: rules.raceSparkStatGain.verified, source: rules.raceSparkStatGain.source },
    { rule: 'scenarioSparkEffects', value: open(rules.scenarioSparkEffects), verified: rules.scenarioSparkEffects.verified, source: rules.scenarioSparkEffects.source },
  ];
}

export function HealthScreen() {
  const services = useServices();
  const qc = useQueryClient();
  const roster = useRoster();
  const master = useMaster();
  const ctxQ = useEngineContext();
  const ctx = ctxQ.data;
  const overrideActive = !!ctx?.override;
  // Under a browser-local override the server snapshot is never fetched or shown as the model.
  const snap = useLatestSnapshot(!!ctx && !overrideActive);
  const local = useLocalModel(overrideActive);
  const fit = useSessionFit();
  const [apply, setApply] = useState<ApplyState>({ state: 'idle' });
  const [reset, setReset] = useState<ResetState>({ state: 'idle' });
  const [rulesNote, setRulesNote] = useState<{ kind: 'ok' | 'info' | 'warn' | 'err'; message: string } | null>(null);
  const [refit, setRefit] = useState<{ state: 'idle' | 'running' | 'error' | 'cancelled'; message?: string; cancel?: () => void }>({ state: 'idle' });
  const runRef = useRef(0);
  const jobRef = useRef<OwnedJob | null>(null);
  /** Held synchronously from the first Reset click until that reset settles (same-tick double clicks). */
  const resetRef = useRef(false);
  const [cal, setCal] = useState<CalState>({ state: 'idle' });
  const session = useSessionCalibration(services.engine);
  // Route unmount cancels only the job this screen owns (never another screen's worker job).
  useEffect(() => () => {
    runRef.current++;
    const j = jobRef.current;
    jobRef.current = null;
    j?.cancel?.();
  }, [services.engine]);
  const m = master.data;
  const all = roster.data?.roster;
  const currentProv = useMemo(
    () => (ctxQ.data && m && roster.data ? provenanceOf(ctxQ.data, m.version, roster.data) : null),
    [ctxQ.data, m, roster.data],
  );
  const currentKey = currentProv ? provenanceKey(currentProv) : null;
  const provRef = useRef(currentProv);
  provRef.current = currentProv;

  const sessionRef = useRef(session);
  sessionRef.current = session;
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  // Inputs changed while a calibration or apply runs: revoke its authority (terminate) and say why.
  useEffect(() => {
    const j = jobRef.current;
    if (!j || (j.kind !== 'calibrate' && j.kind !== 'apply') || !j.provenance) return;
    if (currentProv && provenanceKey(j.provenance) === currentKey) return;
    const why = currentProv ? staleReasons(j.provenance, currentProv) : ['inputs are reloading'];
    jobRef.current = null;
    j.cancel?.();
    if (j.kind === 'calibrate') {
      setCal({ state: 'refused', message: `Calibration stopped: its inputs changed while it ran (${why.join(', ')}). The result was discarded; run calibration again.` });
    } else {
      setApply({ state: 'done', kind: 'warn', message: `Apply stopped: its inputs changed while the candidate model was fitting (${why.join(', ')}). Nothing was applied; the active rules and model are unchanged.` });
    }
  }, [currentKey, currentProv]);

  // An open confirmation is bound to one report/provenance/override revision: any change cancels it.
  useEffect(() => {
    if (apply.state !== 'confirm') return;
    const p = apply.proposal;
    if (session?.output.report.id === p.reportId && currentKey === p.provenanceKey && ctx?.storedRaw === p.storedRaw) return;
    setApply({ state: 'done', kind: 'warn', message: 'The confirmation was cancelled: the report, roster, master data or rules override changed while it was open. Nothing was applied.' });
  }, [apply, session, currentKey, ctx?.storedRaw]);
  useEffect(() => {
    if (reset.state !== 'confirm' || !ctx || ctx.storedRaw === reset.storedRaw) return;
    setReset({ state: 'idle' });
    setRulesNote({ kind: 'warn', message: 'The reset confirmation was cancelled: the rules override changed (possibly in another tab). Nothing was reset.' });
  }, [reset, ctx]);

  const counts = useMemo(() => {
    if (!all) return [];
    const map = new Map<string, { scenarioId: string; mode: string; n: number }>();
    for (const v of all) {
      const k = `${v.scenarioId}|${v.trainMode}`;
      const e = map.get(k) ?? { scenarioId: v.scenarioId, mode: v.trainMode, n: 0 };
      e.n++;
      map.set(k, e);
    }
    return [...map.values()].sort((a, b) => a.scenarioId.localeCompare(b.scenarioId) || a.mode.localeCompare(b.mode));
  }, [all]);

  const doRefit = async () => {
    if (!all || !m || !ctxQ.data || !currentProv || jobRef.current) return;
    const id = ++runRef.current;
    const owned: OwnedJob = { kind: 'refit', id, cancel: null };
    jobRef.current = owned;
    const key = currentKey;
    const live = () => runRef.current === id && provRef.current !== null && provenanceKey(provRef.current) === key;
    setRefit({ state: 'running' });
    try {
      await refitBody(live, owned);
    } finally {
      if (jobRef.current === owned) jobRef.current = null;
    }
  };
  const refitBody = async (live: () => boolean, owned: OwnedJob) => {
    if (!all || !m || !ctxQ.data || !currentProv) return;
    const out = await ensureModel(services, qc, {
      roster: all,
      rosterEtag: roster.data?.etag ?? null,
      rosterIdentity: currentProv.rosterIdentity,
      masterVersion: m.version,
      ctx: ctxQ.data,
      force: 'requested',
      isCurrent: live,
      onFitStart: (_r, cancel) => {
        owned.cancel = cancel;
        if (live()) setRefit({ state: 'running', cancel: () => { runRef.current++; cancel(); setRefit({ state: 'cancelled' }); } });
      },
    });
    if (!live()) return;
    if (out.status === 'cancelled') return setRefit({ state: 'cancelled' });
    if (out.status === 'error') return setRefit({ state: 'error', message: out.engine ? engineErrorText(out.engine, m) : out.message });
    setRefit({ state: 'idle', message: out.storeError ?? undefined });
  };

  const doCalibrate = async () => {
    const prov = provRef.current;
    if (!all || !m || !prov || jobRef.current) return;
    const id = ++runRef.current;
    const owned: OwnedJob = { kind: 'calibrate', id, cancel: null, provenance: prov };
    jobRef.current = owned;
    const now = services.now();
    const job = services.engine.calibrate(all, { nowIso: now.toISOString(), id: ulid(now.getTime(), services.random) });
    const cancel = () => {
      if (jobRef.current !== owned) return;
      jobRef.current = null;
      job.cancel();
      setCal({ state: 'cancelled' });
    };
    owned.cancel = job.cancel;
    setCal({ state: 'running', cancel });
    const out = await job.promise;
    if (jobRef.current !== owned) return; // cancelled, superseded, unmounted or inputs changed
    jobRef.current = null;
    if (out.status === 'cancelled' || out.status === 'superseded') {
      // Not the user's Cancel (that clears jobRef first): the engine was reconfigured (master or
      // context change) or another job took the worker. Say so; the reason may not be known yet.
      return setCal({ state: 'refused', message: 'Calibration stopped: the engine was reconfigured or another engine job started while it ran. The result was discarded; run calibration again.' });
    }
    if (out.status === 'crashed') return setCal({ state: 'error', message: `Calibration failed: the engine worker stopped: ${out.message}` });
    if (!out.result.ok) return setCal({ state: 'error', message: `Calibration failed: ${calibrationErrorText(out.result.error, m)}` });
    const v = out.result.value;
    if (v.context.kind !== prov.contextKind || v.context.fingerprint !== prov.contextFingerprint || v.report.masterVersion !== prov.masterVersion || v.report.rulesVersion !== prov.rulesVersion) {
      return setCal({
        state: 'error',
        message: `Calibration failed: the worker's report (${v.context.kind}, master ${v.report.masterVersion}, rules ${v.report.rulesVersion}) does not match the inputs it was started with (${prov.contextKind}, master ${prov.masterVersion}, rules ${prov.rulesVersion}). It was discarded.`,
      });
    }
    setSessionCalibration(services.engine, { output: v, provenance: prov });
    setCal({ state: 'idle' });
  };
  const calRunning = cal.state === 'running';
  const applyRunning = apply.state === 'running';
  const busy = refit.state === 'running' || calRunning || applyRunning;
  const canCalibrate = !!all && !!m && !!currentProv && !busy;
  const eligibility = applyEligibility(session, ctx, currentProv);
  const applyDisabled = busy ? 'another engine job is running' : apply.state === 'confirm' ? 'a confirmation is open' : eligibility.ok ? null : eligibility.reason;

  const openApply = () => {
    const c = ctxRef.current;
    const sess = sessionRef.current;
    const prov = provRef.current;
    if (jobRef.current || !c || !sess || !prov) return;
    const e = applyEligibility(sess, c, prov);
    if (!e.ok) return;
    setRulesNote(null);
    setApply({ state: 'confirm', proposal: { reportId: sess.output.report.id, provenanceKey: provenanceKey(prov), storedRaw: c.storedRaw, contextFingerprint: c.fingerprint, suggestion: e.suggestion } });
  };

  const confirmApply = async () => {
    if (apply.state !== 'confirm' || jobRef.current) return;
    const p = apply.proposal;
    const c = ctxRef.current;
    const sess = sessionRef.current;
    const prov = provRef.current;
    // Re-validate synchronously against the bound proposal (a same-tick double confirm starts one job).
    if (!c || !sess || !prov || !all || !m || sess.output.report.id !== p.reportId || provenanceKey(prov) !== p.provenanceKey ||
      c.storedRaw !== p.storedRaw || storedOverrideRaw(services) !== p.storedRaw || c.fingerprint !== p.contextFingerprint) {
      setApply({ state: 'done', kind: 'warn', message: 'The source changed before confirmation took effect. Nothing was applied.' });
      return;
    }
    const id = ++runRef.current;
    const owned: OwnedJob = { kind: 'apply', id, cancel: null, provenance: prov };
    jobRef.current = owned;
    const cancel = () => {
      if (jobRef.current !== owned) return;
      jobRef.current = null;
      owned.cancel?.();
      setApply({ state: 'done', kind: 'info', message: 'Apply cancelled. Nothing was applied; the active rules and model are unchanged.' });
    };
    setApply({ state: 'running', cancel });
    const golden = c.kind === 'golden-fixture' && services.loadGolden ? await services.loadGolden() : undefined;
    const out = await applyProposal(services, qc, {
      proposal: p,
      session: sess,
      ctx: c,
      master: m,
      ...(golden ? { golden } : {}),
      roster: all,
      rosterEtag: prov.rosterEtag,
      rosterIdentity: prov.rosterIdentity,
      isCurrent: () => jobRef.current === owned && provRef.current !== null && provenanceKey(provRef.current) === p.provenanceKey && sessionRef.current?.output.report.id === p.reportId,
      onCandidateStart: (c2) => { owned.cancel = c2; },
    });
    // 'applied' is reported even if authority moved meanwhile: the commit happened and is the truth.
    if (out.status === 'applied') {
      if (jobRef.current === owned) jobRef.current = null;
      return setApply({
        state: 'done',
        kind: 'ok',
        message: `Applied in this browser only: blueStatGain ${triple(out.override.proposed)} (unverified, from report ${out.override.sourceReport.id}). A candidate model was fitted and committed locally; it is never uploaded. The source report is now historical: run calibration again to check the new context.`,
      });
    }
    if (jobRef.current !== owned) return; // cancelled / revoked: that path already said why
    jobRef.current = null;
    if (out.status === 'cancelled') return setApply({ state: 'done', kind: 'info', message: 'Apply cancelled. Nothing was applied; the active rules and model are unchanged.' });
    return setApply({ state: 'done', kind: out.status === 'refused' ? 'warn' : 'err', message: out.message });
  };

  const openReset = (clearOnly: boolean) => {
    const c = ctxRef.current;
    if (!c) return;
    setRulesNote(null);
    setReset({ state: 'confirm', storedRaw: c.storedRaw, clearOnly });
  };
  const confirmReset = async () => {
    if (reset.state !== 'confirm' || resetRef.current) return;
    resetRef.current = true;
    try {
      await resetBody(reset.storedRaw, reset.clearOnly);
    } finally {
      resetRef.current = false;
    }
  };
  const resetBody = async (storedRaw: string | null, clearOnly: boolean) => {
    const c = ctxRef.current;
    // Reset cancels only the work this screen owns.
    const j = jobRef.current;
    if (j) {
      jobRef.current = null;
      runRef.current++;
      j.cancel?.();
      if (j.kind === 'refit') setRefit({ state: 'cancelled' });
      if (j.kind === 'calibrate') setCal({ state: 'cancelled' });
      if (j.kind === 'apply') setApply({ state: 'idle' });
    }
    const r = await resetOverride(services, qc, storedRaw);
    setReset({ state: 'idle' });
    if (r.status !== 'reset') return setRulesNote({ kind: r.status === 'refused' ? 'warn' : 'err', message: r.message });
    setApply({ state: 'idle' });
    setRulesNote({
      kind: 'ok',
      message: `${clearOnly ? 'The stored override record was cleared.' : 'Reset done.'} ${c ? `${titleCaseFirst(baseLabel(c))} is in force again.` : ''} Old ranking results and reports are stale; the next model must pass provenance checks or is refitted.${r.note ? ` ${r.note}` : ''}`,
    });
  };

  const actions = (
    <>
      <button type="button" className="btn" disabled={busy || !all || !ctxQ.data} aria-busy={refit.state === 'running'} onClick={() => void doRefit()}>
        Refit model
      </button>
      {refit.state === 'running' && refit.cancel && (
        <button type="button" className="btn" onClick={refit.cancel}>
          Cancel
        </button>
      )}
      <button type="button" className="btn primary" disabled={!canCalibrate} aria-busy={calRunning} onClick={() => void doCalibrate()}>
        Run calibration
      </button>
    </>
  );
  const resetName = ctx?.kind === 'golden-fixture' ? 'Reset to fixture base rules' : 'Reset to published rules';

  if (master.isError || ctxQ.isError) {
    return <Page title="Model health" actions={actions}><ErrorBanner text={<>Couldn't load model health. {errorText(master.error ?? ctxQ.error)}</>} onRetry={() => { void master.refetch(); void ctxQ.refetch(); }} /></Page>;
  }
  if (!overrideActive && snap.isError) {
    return (
      <Page title="Model health" actions={actions}>
        <ErrorBanner text={<>Couldn't load model health. {errorText(snap.error)}</>} onRetry={() => void snap.refetch()} />
      </Page>
    );
  }
  if (!m || !ctx || (overrideActive ? !local.isSuccess : !snap.isSuccess)) {
    return (
      <Page title="Model health" actions={actions}>
        <Loading label="Loading model health…" />
      </Page>
    );
  }
  if (!overrideActive && snap.data && !isReadableSnapshot(snap.data)) {
    return <Page title="Model health" actions={actions}><ErrorBanner text="The stored snapshot is malformed. Refit the model to replace it; this is not a legacy/master-version mismatch." /></Page>;
  }
  // The model shown is the one that may be used under the ACTIVE context: a matching browser-local
  // envelope under an override, otherwise the server snapshot (whose reuse provenance is checked).
  let s = null as typeof snap.data | null;
  let localWhy: string | null = null;
  if (overrideActive && ctx.override) {
    const l = local.data;
    if (l?.status === 'ok') {
      localWhy = localModelMismatch(l.env, {
        overrideId: ctx.override.id, contextFingerprint: ctx.fingerprint, baseFingerprint: ctx.baseFingerprint, masterVersion: m.version,
        rosterEtag: currentProv?.rosterEtag ?? null, rosterIdentity: currentProv?.rosterIdentity ?? '', eligibilityPolicy: ctx.eligibilityPolicy,
      });
      if (!localWhy && isReadableSnapshot(l.env.snapshot)) s = l.env.snapshot;
      else localWhy ??= 'the stored local model is malformed';
    } else localWhy = l?.status === 'invalid' ? l.reason : 'none has been fitted for this override in this browser yet';
  } else s = snap.data ?? null;
  const unproven = !overrideActive && !!s && s.kind === 'training-v2' && !!currentProv &&
    decideModel({ v2: s, anyLatest: s, rosterEtag: currentProv.rosterEtag, rosterIdentity: currentProv.rosterIdentity, masterVersion: m.version, context: ctx.kind, contextFingerprint: ctx.fingerprint, eligibilityPolicy: ctx.eligibilityPolicy, record: loadFitRecord(services.store, services.source.kind) }).action !== 'use';
  const effectiveRows = rulesRows(ctx.effectiveRules);
  const ov = ctx.override;
  const stored = ctx.storedOverride;
  const legacy = s?.kind === 'training-v1';
  const cov = s?.params.holdout.coverage80;
  const inBand = cov !== undefined && cov >= COVERAGE_BAND[0] && cov <= COVERAGE_BAND[1];
  // Diagnostics only from a fit run in this tab for THIS snapshot (never persisted, Q-74).
  const f = fit && s && fit.output.snapshot.id === s.id ? fit.output.summary : null;

  return (
    <Page title="Model health" actions={actions}>
      {refit.state === 'running' && <Banner kind="info">Fitting the model in the worker…</Banner>}
      {refit.state === 'error' && <ErrorBanner text={refit.message ?? 'Refit failed.'} />}
      {refit.state === 'cancelled' && <Banner kind="info">Refit cancelled.</Banner>}
      {refit.message && refit.state === 'idle' && <Banner kind="warn">{refit.message}</Banner>}
      {ctx.kind === 'golden-fixture' && (
        <Banner kind="warn">Golden fixture context (SYNTHETIC overrides: {ctx.overrides.map((o) => o.rule).join(', ')}). Not game facts.</Banner>
      )}
      <section className="panel" aria-labelledby="ov-t" data-testid="rules-override" data-context={ctx.fingerprint} data-base-context={ctx.baseFingerprint} data-revision={ctx.storedRevision} style={{ marginBottom: 'var(--space-3)' }}>
        <header id="ov-t">Rules in force</header>
        <div className="body grid">
          {ov && stored ? (
            <>
              <p data-testid="override-active">
                <Tag kind="warn">browser-local override</Tag> blueStatGain <b className="num">{triple(ov.proposed)}</b> (1★/2★/3★){' '}
                {stored.sourceReport.contextFingerprint === ctx.baseFingerprint
                  ? <>replaces {triple(stored.sourceReport.current)} of {baseLabel(ctx)}.</>
                  : <>replaces the previous browser-local override ({triple(stored.sourceReport.current)}, in force when its source report ran); the base context remains {baseLabel(ctx)}.</>}{' '}
                Proposal ×{ov.multiplier} from calibration report <span className="mono">{ov.sourceReportId}</span>, applied {dateTime(stored.appliedAt)}. Unverified statistical value, not a game fact.
              </p>
              <p className="hint">
                Stored in THIS browser only (revision {ctx.storedRevision}; not synced to other devices, never uploaded). Models fitted under it are kept in this browser and never stored on the server. Context <span className="mono">{ctx.fingerprint.slice(0, 19)}…</span>
              </p>
            </>
          ) : (
            <p data-testid="override-none">
              No browser-local override: {baseLabel(ctx)} {ctx.kind === 'golden-fixture' ? 'is' : 'are'} in force. Context <span className="mono">{ctx.fingerprint.slice(0, 19)}…</span>
            </p>
          )}
          {ctx.overrideProblem && (
            <Banner kind="err">
              <span data-testid="override-problem">{titleCaseFirst(ctx.overrideProblem)}. {titleCaseFirst(baseLabel(ctx))} {ctx.kind === 'golden-fixture' ? 'is' : 'are'} in force instead.</span>
            </Banner>
          )}
          {rulesNote && (
            <Banner kind={rulesNote.kind === 'err' ? 'err' : rulesNote.kind === 'warn' ? 'warn' : 'info'}>
              <span data-testid="rules-note">{rulesNote.message}</span>
            </Banner>
          )}
          {(ov || ctx.overrideProblem) && (
            <div className="row">
              <button type="button" className="btn" disabled={reset.state === 'confirm'} onClick={() => openReset(!ov)}>
                {ov ? resetName : 'Clear the stored override'}
              </button>
            </div>
          )}
        </div>
      </section>
      {!s ? (
        <Empty>
          {overrideActive ? (
            <p data-testid="local-model-missing">No browser-local model for the active override ({localWhy}). Refit model fits one in this browser; the Planner fits one automatically before ranking. No server snapshot is used under an override.</p>
          ) : (
            <p>No model yet. Import veterans, then fit one from the Planner.</p>
          )}
        </Empty>
      ) : (
        <>
          {legacy && (
            <Banner kind="warn">
              This is a legacy training-v1 snapshot (pre-ADR-0002). Its numbers have unknown meaning and are shown as stored; the planner refits a training-v2 model.
            </Banner>
          )}
          <div className="row" style={{ alignItems: 'stretch', marginBottom: 'var(--space-3)' }}>
            <div className="kpi">
              <small>Training rows</small>
              <b>{s.nSamples}</b>
              <small>{ctxQ.data?.minConfidence !== undefined ? `no low-confidence field left (legacy rows: min confidence ≥ ${ctxQ.data.minConfidence})` : 'high-confidence rows only'}</small>
            </div>
            <div className="kpi">
              <small>80% interval coverage</small>
              <b>{cov!.toFixed(2)}</b>
              <small>
                F08 acceptance band {COVERAGE_BAND[0]}–{COVERAGE_BAND[1]}{' '}
                {legacy ? <Tag kind="neutral">legacy</Tag> : <Tag kind={inBand ? 'ok' : 'warn'}>{inBand ? 'in range' : 'out of range'}</Tag>}
              </small>
            </div>
            <div className="kpi">
              <small>Model</small>
              <b style={{ fontSize: 'var(--type-md)' }}>{s.kind}</b>
              <small data-testid="model-origin" data-snapshot={s.id}>
                fitted {dateTime(s.trainedAt)} · master {s.masterVersion} · {overrideActive ? 'browser-local model (override context; never uploaded)' : 'server snapshot (base context)'}
                {s.masterVersion !== m.version && <> · <Tag kind="warn">refit required (master changed)</Tag></>}
                {unproven && <> · <Tag kind="warn">provenance for this context unproven: the Planner refits before ranking</Tag></>}
              </small>
            </div>
          </div>
        </>
      )}
      <div className="split s2" style={{ marginBottom: 'var(--space-3)' }}>
        <section className="panel" aria-labelledby="sc-t">
          <header id="sc-t">Sample counts</header>
          {roster.isError ? (
            <div className="body">
              <ErrorBanner text="Couldn't load your roster." onRetry={() => void roster.refetch()} />
            </div>
          ) : !all ? (
            <div className="body">
              <Loading rows={2} />
            </div>
          ) : (
            <table>
              <caption className="sr">Veterans per scenario and mode</caption>
              <thead>
                <tr>
                  <th scope="col">Scenario</th>
                  <th scope="col">Mode</th>
                  <th scope="col" className="num">
                    Veterans
                  </th>
                  <th scope="col">
                    <span className="sr">Note</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {counts.map((c) => (
                  <tr key={`${c.scenarioId}|${c.mode}`}>
                    <th scope="row">{scenarioName(m, c.scenarioId)}</th>
                    <td>{titleCase(c.mode)}</td>
                    <td className="num">{c.n}</td>
                    <td>{c.n < LOW_DATA_N && <Tag kind="warn">low data (n &lt; 10)</Tag>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        {s && (
          <section className="panel" aria-labelledby="mae-t">
            <header id="mae-t">Holdout error (MAE, stat points)</header>
            <table>
              <caption className="sr">Holdout mean absolute error and sigma per stat</caption>
              <thead>
                <tr>
                  <th scope="col">Stat</th>
                  <th scope="col" className="num">
                    MAE
                  </th>
                  <th scope="col" className="num">
                    σ
                  </th>
                  {f && (
                    <th scope="col" className="num">
                      80% coverage
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {STAT_KEYS.map((k, i) => (
                  <tr key={k}>
                    <th scope="row">{STAT_LABEL[k]}</th>
                    <td className="num">{s.params.holdout.mae[k].toFixed(1)}</td>
                    <td className="num">{s.params.perStat[k].sigma.toFixed(1)}</td>
                    {f && <td className="num">{(f.holdout.coverage.perStat[i] ?? NaN).toFixed(2)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
      {s && (
        <section className="panel" aria-labelledby="scat-t" style={{ marginBottom: 'var(--space-3)' }}>
          <header id="scat-t">Predicted vs actual (held-out veterans)</header>
          <div className="body">
            <p className="scatter-empty">
              Per-veteran held-out points aren't available: the snapshot stores only aggregate MAE and coverage, and the engine's fit report exposes holdout aggregates only (Q-74). No points are drawn.
            </p>
            {f && <div className="body" data-testid="skill-diagnostics">
              <p>Skill likelihood cells: {f.skills.cells.total} total · {f.skills.cells.guaranteed} guaranteed · {f.skills.cells.lineageOnly} lineage-only (mean q {f.skills.cells.lineageOnlyMeanQ.toFixed(3)}).</p>
              <p>Excluded acquisition contradictions: {f.skills.contradictions.reduce((sum, c) => sum + c.count, 0)}.</p>
              <ul>{f.skills.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
              {f.warnings.length > 0 && <ul>{f.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
            </div>}
            {f ? (
              <p className="hint">
                From the fit run in this tab ({f.holdoutIds} held out, {f.trainIds} train, {f.eligible} eligible
                {Object.keys(f.excluded).length > 0 && `; excluded: ${Object.entries(f.excluded).map(([r, n]) => `${r} ${n}`).join(', ')}`}): pooled coverage {f.holdout.coverage.pooled.toFixed(3)} over {f.holdout.coverage.cells} cells; without inheritance {f.holdout.coverageWithoutInheritance.pooled.toFixed(3)}. Mean holdout residual (bias): {f.holdout.bias.mean.map((x) => x.toFixed(1)).join(' / ')}.
              </p>
            ) : (
              <p className="hint">Refit the model here to see this fit's holdout diagnostics (they are not stored with the snapshot).</p>
            )}
          </div>
        </section>
      )}
      <div className="split s2b">
        <section className="panel" aria-labelledby="rules-t">
          <header id="rules-t">Inheritance rules in force ({ctx.rulesVersion})</header>
          {/* Scrollable on narrow columns: keyboard-focusable, labelled region (axe scrollable-region-focusable). */}
          <div className="tbl-wrap fit" style={{ border: 0 }} tabIndex={0} role="region" aria-label="Inheritance rules table (scrollable)">
            <table>
              <caption className="sr">Inheritance rules with verification status</caption>
              <thead>
                <tr>
                  <th scope="col">Rule</th>
                  <th scope="col">Value</th>
                  <th scope="col">Status</th>
                  <th scope="col">Source</th>
                </tr>
              </thead>
              <tbody>
                {effectiveRows.map((r) => (
                  <tr key={r.rule}>
                    <th scope="row" className="mono">
                      {r.rule}
                    </th>
                    <td>{r.value}</td>
                    <td>{r.verified ? <Tag kind="ok">✓ verified</Tag> : <Tag kind="warn">⚠ unverified</Tag>}</td>
                    <td className="wrap">
                      <small title={r.source}>{r.source.length > 120 ? `${r.source.slice(0, 117)}…` : r.source}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint" style={{ padding: '0 var(--space-3) var(--space-3)' }} data-testid="rules-shown">
            Effective values the engine uses now{ctx.kind === 'golden-fixture' ? ` (fixture mode: ${ctx.overrides.filter((o) => !o.source.startsWith('BROWSER-LOCAL')).map((o) => o.rule).join(', ')} are SYNTHETIC test values)` : ''}{ov ? '; blueStatGain is the browser-local override' : ''}. Published master rules: {m.bundle.rules.version}.
          </p>
        </section>
        <section className="panel" aria-labelledby="cal-t">
          <header id="cal-t">Calibration result</header>
          {cal.state === 'running' && (
            <div className="body">
              <Banner kind="info">
                <span data-testid="calib-running">Calibrating… running in the engine worker. The engine reports no progress, so no estimate is shown.</span>
                <span className="sp" />
                <button type="button" className="btn sm" onClick={cal.cancel}>
                  Cancel calibration
                </button>
              </Banner>
            </div>
          )}
          {(cal.state === 'cancelled' || cal.state === 'refused' || cal.state === 'error') && (
            <div className="body">
              <Banner kind={cal.state === 'error' ? 'err' : cal.state === 'refused' ? 'warn' : 'info'}>
                <span>{cal.state === 'cancelled' ? 'Calibration cancelled.' : cal.message}</span>
                <span className="sp" />
                <button type="button" className="btn sm" disabled={busy || !canCalibrate} onClick={() => void doCalibrate()}>
                  Retry calibration
                </button>
              </Banner>
            </div>
          )}
          {apply.state === 'running' && (
            <div className="body">
              <Banner kind="info">
                <span data-testid="apply-running">Applying: fitting a candidate model under the proposed rules in a separate engine worker. The active rules and model stay in force until it succeeds.</span>
                <span className="sp" />
                <button type="button" className="btn sm" onClick={apply.cancel}>
                  Cancel apply
                </button>
              </Banner>
            </div>
          )}
          {apply.state === 'done' && (
            <div className="body">
              <Banner kind={apply.kind === 'err' ? 'err' : apply.kind === 'warn' ? 'warn' : 'info'}>
                <span data-testid="apply-result">{apply.message}</span>
              </Banner>
            </div>
          )}
          {session ? (
            <CalibrationReportView
              value={session}
              stale={currentProv ? staleReasons(session.provenance, currentProv) : ['inputs are reloading']}
              onDismiss={() => setSessionCalibration(services.engine, null)}
              apply={{ disabledReason: applyDisabled, onApply: openApply }}
            />
          ) : (
            <div className="body">
              <p>Calibration hasn't been run.</p>
              <p className="hint">
                Run calibration checks the rules in force against your roster in the engine worker. It works without a fitted model, changes nothing and stores nothing; the report stays in this tab until you dismiss it. A suggested value is applied only if you explicitly confirm it, and only in this browser.
              </p>
            </div>
          )}
        </section>
      </div>
      {apply.state === 'confirm' && (
        <ApplyDialog ctx={ctx} proposal={apply.proposal} onCancel={() => setApply({ state: 'idle' })} onConfirm={() => void confirmApply()} />
      )}
      {reset.state === 'confirm' && (
        <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="reset-t">
          <div>
            <h2 id="reset-t">{reset.clearOnly ? 'Clear the stored override?' : `${resetName}?`}</h2>
            <p>
              {reset.clearOnly ? 'This removes the unusable stored override record' : 'This removes the browser-local blueStatGain override'} and any browser-local model fitted under it, for {services.source.kind === 'fixture' ? 'fixture mode' : 'this app'} in this browser only. {titleCaseFirst(baseLabel(ctx))} will be in force.
            </p>
            <p className="hint">Nothing on the server or in master data changes. Running work on this screen is cancelled; old reports and rankings become stale and the next model must pass provenance checks or is refitted.</p>
            <div className="row">
              <button type="button" className="btn" onClick={() => setReset({ state: 'idle' })}>
                Keep it
              </button>
              <button type="button" className="btn primary" onClick={confirmReset}>
                {reset.clearOnly ? 'Clear it' : 'Reset'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}

const titleCaseFirst = (x: string) => (x ? x[0]!.toUpperCase() + x.slice(1) : x);

function ApplyDialog({ ctx, proposal, onCancel, onConfirm }: { ctx: EngineContextState; proposal: ApplyProposal; onCancel: () => void; onConfirm: () => void }) {
  const s = proposal.suggestion;
  return (
    <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="apply-t" aria-describedby="apply-d">
      <div>
        <h2 id="apply-t">Apply the suggested blueStatGain?</h2>
        <div id="apply-d" className="grid">
          <table>
            <caption className="sr">Current and proposed blueStatGain values</caption>
            <thead>
              <tr>
                <th scope="col">blueStatGain</th>
                <th scope="col" className="num">1★</th>
                <th scope="col" className="num">2★</th>
                <th scope="col" className="num">3★</th>
              </tr>
            </thead>
            <tbody>
              <tr data-testid="apply-old">
                <th scope="row">In force now</th>
                {s.current.map((x, i) => <td key={i} className="num">{Math.round(x * 1e4) / 1e4}</td>)}
              </tr>
              <tr data-testid="apply-new">
                <th scope="row">Proposed (×{s.multiplier})</th>
                {s.proposed.map((x, i) => <td key={i} className="num">{Math.round(x * 1e4) / 1e4}</td>)}
              </tr>
            </tbody>
          </table>
          <p>
            From calibration report <span className="mono">{proposal.reportId}</span> on {baseLabel(ctx)}{ctx.override ? ' with the current browser-local override' : ''}. The proposed absolute values replace the current table (not multiplied again). <b>Unverified</b> statistical value (verified:false), not a game fact.
          </p>
          <p className="hint">
            A candidate model is fitted first in a separate engine worker; only if it succeeds are the override and that model kept in THIS browser (not synced, never uploaded to the server). Reset restores {baseLabel(ctx)}.
          </p>
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={onConfirm}>
            Fit and apply
          </button>
        </div>
      </div>
    </div>
  );
}
