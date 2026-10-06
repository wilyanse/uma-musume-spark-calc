/** S07 Model health (F12). */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Rules } from '@uma/schema';
import { Page } from '../components/Layout.tsx';
import { Banner, Empty, ErrorBanner, Loading, Tag } from '../components/atoms.tsx';
import { useMaster, useRoster } from '../app/queries.ts';
import { useServices } from '../app/services.ts';
import { contextKindFor, ensureModel, useEngineContext, useLatestSnapshot, useSessionFit } from '../app/engine.ts';
import { errorText } from '../api/errors.ts';
import { scenarioName } from '../master/load.ts';
import { COVERAGE_BAND, LOW_DATA_N, STAT_KEYS, STAT_LABEL } from '../lib/keys.ts';
import { dateTime, titleCase } from '../lib/format.ts';
import { engineErrorText } from '../app/engineErrors.ts';
import { isReadableSnapshot } from '../lib/model.ts';

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
  const snap = useLatestSnapshot();
  const roster = useRoster();
  const master = useMaster();
  const ctxQ = useEngineContext();
  const fit = useSessionFit();
  const [refit, setRefit] = useState<{ state: 'idle' | 'running' | 'error' | 'cancelled'; message?: string; cancel?: () => void }>({ state: 'idle' });
  const runRef = useRef(0);
  useEffect(() => () => { runRef.current++; services.engine.cancel(); }, [services.engine]);
  const m = master.data;
  const all = roster.data?.roster;

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
    if (!all || !m || !ctxQ.data) return;
    const id = ++runRef.current;
    const live = () => runRef.current === id;
    setRefit({ state: 'running' });
    const out = await ensureModel(services, qc, {
      roster: all,
      rosterEtag: roster.data?.etag ?? null,
      masterVersion: m.version,
      context: contextKindFor(services),
      force: 'requested',
      isCurrent: live,
      onFitStart: (_r, cancel) => live() && setRefit({ state: 'running', cancel: () => { runRef.current++; cancel(); setRefit({ state: 'cancelled' }); } }),
    });
    if (!live()) return;
    if (out.status === 'cancelled') return setRefit({ state: 'cancelled' });
    if (out.status === 'error') return setRefit({ state: 'error', message: out.engine ? engineErrorText(out.engine, m) : out.message });
    setRefit({ state: 'idle', message: out.storeError ?? undefined });
  };

  const actions = (
    <>
      <button type="button" className="btn" disabled={refit.state === 'running' || !all || !ctxQ.data} aria-busy={refit.state === 'running'} onClick={() => void doRefit()}>
        Refit model
      </button>
      {refit.state === 'running' && refit.cancel && (
        <button type="button" className="btn" onClick={refit.cancel}>
          Cancel
        </button>
      )}
      <button type="button" className="btn primary" aria-disabled="true" disabled title="Calibration (T15) is not implemented yet">
        Run calibration
      </button>
    </>
  );

  if (master.isError || ctxQ.isError) {
    return <Page title="Model health" actions={actions}><ErrorBanner text={<>Couldn't load model health. {errorText(master.error ?? ctxQ.error)}</>} onRetry={() => { void master.refetch(); void ctxQ.refetch(); }} /></Page>;
  }
  if (snap.isError) {
    return (
      <Page title="Model health" actions={actions}>
        <ErrorBanner text={<>Couldn't load model health. {errorText(snap.error)}</>} onRetry={() => void snap.refetch()} />
      </Page>
    );
  }
  if (!snap.isSuccess || !m) {
    return (
      <Page title="Model health" actions={actions}>
        <Loading label="Loading model health…" />
      </Page>
    );
  }
  if (snap.data && !isReadableSnapshot(snap.data)) {
    return <Page title="Model health" actions={actions}><ErrorBanner text="The stored snapshot is malformed. Refit the model to replace it; this is not a legacy/master-version mismatch." /></Page>;
  }
  const s = snap.data;
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
      {ctxQ.data?.kind === 'golden-fixture' && (
        <Banner kind="warn">Golden fixture context (SYNTHETIC overrides: {ctxQ.data.overrides.map((o) => o.rule).join(', ')}). Not game facts.</Banner>
      )}
      {!s ? (
        <Empty>
          <p>No model yet. Import veterans, then fit one from the Planner.</p>
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
              <small>min confidence ≥ 0.9</small>
            </div>
            <div className="kpi">
              <small>80% interval coverage</small>
              <b>{cov!.toFixed(2)}</b>
              <small>
                target {COVERAGE_BAND[0]}–{COVERAGE_BAND[1]}{' '}
                {legacy ? <Tag kind="neutral">legacy</Tag> : <Tag kind={inBand ? 'ok' : 'warn'}>{inBand ? 'in range' : 'out of range'}</Tag>}
              </small>
            </div>
            <div className="kpi">
              <small>Model</small>
              <b style={{ fontSize: 'var(--type-md)' }}>{s.kind}</b>
              <small>
                fitted {dateTime(s.trainedAt)} · master {s.masterVersion}
                {s.masterVersion !== m.version && <> · <Tag kind="warn">refit required (master changed)</Tag></>}
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
          <header id="rules-t">Inheritance rules ({m.bundle.rules.version})</header>
          <div className="tbl-wrap fit" style={{ border: 0 }}>
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
                {rulesRows(m.bundle.rules).map((r) => (
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
          {ctxQ.data?.kind === 'golden-fixture' && (
            <p className="hint" style={{ padding: '0 var(--space-3) var(--space-3)' }}>
              Published rules shown. The fixture-mode engine overrides {ctxQ.data.overrides.map((o) => o.rule).join(', ')} with SYNTHETIC values.
            </p>
          )}
        </section>
        <section className="panel" aria-labelledby="cal-t">
          <header id="cal-t">Calibration result</header>
          <div className="body">
            <p>Calibration hasn't been run.</p>
            <p className="hint">
              Rules calibration is task T15 and isn't implemented yet, so “Run calibration” is disabled. Suggested values are never applied automatically; applying rule overrides would also require a model refit (Q-141).
            </p>
          </div>
        </section>
      </div>
    </Page>
  );
}
