/**
 * S07 calibration report (T15b, 61 §Report display). Renders the engine-local `CalibrationReport`
 * field by field from its actual shape; never recomputes probabilities. Nulls show "unavailable"
 * (never 0). The report itself is read-only; T15c's explicit Apply is offered only through
 * `apply` (eligibility decided by the caller, confirmation in a dialog owned by S07).
 */
import type { ReactNode } from 'react';
import type { CalibrationReport } from '@uma/engine';
import { Banner, Tag } from './atoms.tsx';
import type { SessionCalibration } from '../app/calibration.ts';
import { fmtNum, selectionView, UNAVAILABLE } from '../lib/calibration.ts';
import { dateTime } from '../lib/format.ts';

const yesNo = (b: boolean | null | undefined) => (b === null || b === undefined ? 'unknown' : b ? 'yes' : 'no');
const STATUS_KIND: Record<CalibrationReport['status'], 'ok' | 'warn' | 'err'> = { complete: 'ok', partial: 'warn', unavailable: 'err' };
const triple = (t: readonly number[]) => t.map((x) => fmtNum(x, 2)).join(' / ');

function Section({ id, title, children, testId }: { id: string; title: string; children: ReactNode; testId?: string }) {
  return (
    <section className="calib-sec" aria-labelledby={id} data-testid={testId}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

export interface ApplyControl {
  /** Null when Apply may be offered; otherwise the reason it is disabled. */
  disabledReason: string | null;
  onApply: () => void;
}

export function CalibrationReportView({ value, stale, onDismiss, apply }: { value: SessionCalibration; stale: string[]; onDismiss: () => void; apply?: ApplyControl }) {
  const { report: r, context: c } = value.output;
  const sel = selectionView(r.stats);
  const st = r.stats;
  const idn = st.identification;
  const apt = r.aptitude;
  const badFolds = idn?.folds.filter((f) => f.status !== 'identified' || f.saturated) ?? [];
  const suggestion = r.suggestions.find((s) => s.rule === 'blueStatGain');
  const excluded = r.population.excluded.map((e) => `${e.reason} ${e.count}`).join(', ');
  return (
    <div className="body grid calib" data-testid="calibration-report" data-stale={stale.length > 0 ? 'true' : 'false'}>
      {stale.length > 0 && (
        <Banner kind="warn">
          <span data-testid="calib-stale">
            Stale report: {stale.join(', ')} since this calibration ran. These diagnostics describe the older inputs, not the current ones. Run calibration again for current results.
          </span>
        </Banner>
      )}
      <p data-testid="calib-status">
        Report status <Tag kind={STATUS_KIND[r.status]}>{r.status}</Tag> · run {dateTime(r.generatedAt)} · <span className="mono">{r.kind}</span> · report <span className="mono" data-testid="calib-id">{r.id}</span>
      </p>
      <p className="hint">“complete” means every check could run (checks available); it is not verified mechanics, not real-roster acceptance and not a milestone sign-off.</p>
      {c.synthetic ? (
        <Banner kind="warn">
          SYNTHETIC golden fixture context: {c.overrides.map((o) => o.rule).join(', ')} are synthetic test values (not game facts). Any multiplier here recovers a planted test effect only.
        </Banner>
      ) : (
        <p>
          Production context: the published rules verbatim (master {r.masterVersion}, rules {r.rulesVersion}).
          {c.placeholderRules.length > 0 && <> Placeholder (UNKNOWN) rules in force: <span className="mono">{c.placeholderRules.join(', ')}</span>; a placeholder rule cannot be calibrated into a real value.</>}
          {c.unverifiedRules.length > 0 && <> Unverified rules: {c.unverifiedRules.length}.</>}
        </p>
      )}

      <Section id="calib-pop-t" title="Population and split" testId="calib-population">
        <p>
          {r.population.rosterRows} roster rows · {r.population.used} used{excluded && ` · excluded: ${excluded}`} · train {r.split.trainIds.length} · holdout {r.split.holdoutIds.length}
        </p>
        <p className="hint">
          Split {r.split.source}{r.split.seed !== null && ` (seed ${r.split.seed})`}, CV seed {r.split.cvSeed}; dropped {r.split.dropped.length}, unused {r.split.unused}. Lineage coupling (ADR-0002): {r.split.lineageCoupling.references} train→holdout parent reference(s) from {r.split.lineageCoupling.trainRows} train row(s).
        </p>
      </Section>

      <Section id="calib-stats-t" title="Stats: blueStatGain multiplier">
        <div data-testid="calib-selection">
          {sel.made && st.status === 'boundary' ? (
            <p>
              Boundary minimum <b className="num">×{fmtNum(st.selected!.multiplier, 2)}</b> (not a suggestion; widen the grid). Stats status <span className="mono">{st.status}</span>.
            </p>
          ) : sel.made ? (
            <p>
              Selected multiplier <b className="num">×{fmtNum(st.selected!.multiplier, 2)}</b> (holdout-MAE argmin; stats status <span className="mono">{st.status}</span>).
            </p>
          ) : (
            <>
              <p>
                No multiplier selected: stats status <span className="mono">{st.status}</span>.
              </p>
              {sel.reasons.length > 0 && (
                <ul>
                  {sel.reasons.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
        {sel.gateConflict && (
          <p data-testid="calib-gate-conflict">
            <Tag kind="warn">note</Tag> The raw rank diagnostic says identified, but selection is blocked by the stats status above (fold, mixed-stat or saturation gate). The stats status is the authority.
          </p>
        )}
        <dl className="contrib" data-testid="calib-mae">
          <dt>Holdout MAE, current rules (×1)</dt>
          <dd className="num">{fmtNum(st.evaluation.currentHoldoutMae, 2)}</dd>
          <dt>Holdout MAE, no inheritance term</dt>
          <dd className="num">{fmtNum(st.withoutInheritance?.holdoutMae, 2)}</dd>
          <dt>Holdout MAE at the selection (post-selection, optimistic)</dt>
          <dd className="num">{fmtNum(st.selected?.holdoutMae, 2)}</dd>
          <dt>Train-CV selection (holdout unused to choose it)</dt>
          <dd className="num">{st.trainCvSelected ? `×${fmtNum(st.trainCvSelected.multiplier, 2)}` : UNAVAILABLE}</dd>
          <dt>Holdout MAE of the train-CV selection</dt>
          <dd className="num">{fmtNum(st.evaluation.holdoutMaeOfTrainCvSelection, 2)}</dd>
        </dl>
        <p className="hint">MAE is summed over the five stats (stat points). The train-CV evaluation is still lineage-coupled to the holdout (ADR-0002), so it is not fully independent.</p>
        <div data-testid="calib-confidence">
          <p>
            Confidence: <span className="mono">{st.uncertainty.status}</span>
            {st.uncertainty.reason && <> ({st.uncertainty.reason})</>}. Interval:{' '}
            {st.bootstrap ? (
              <>
                {fmtNum(st.bootstrap.p05, 2)}–{fmtNum(st.bootstrap.p95, 2)} (median {fmtNum(st.bootstrap.p50, 2)}, {st.bootstrap.resamples} resamples, contains ×1: {yesNo(st.bootstrap.containsCurrent)})
              </>
            ) : (
              UNAVAILABLE
            )}
            .
          </p>
          <p className="hint">
            Conditional holdout bootstrap: holdout rows resampled with the split and train fit held fixed. It is not full uncertainty (train-fit, split, λ and model uncertainty are excluded).
          </p>
          <p>
            Selection agreement:{' '}
            {st.selectionAgreement
              ? `holdout ×${fmtNum(st.selectionAgreement.holdout, 2)} vs train-CV ×${fmtNum(st.selectionAgreement.trainCv, 2)}; train-CV selection inside the interval, interval agreement: ${yesNo(st.selectionAgreement.withinInterval)}`
              : 'unknown (no selection)'}
            .
          </p>
        </div>
        <div data-testid="calib-identification">
          <p>
            Identification diagnostic (numeric):{' '}
            {idn ? (
              <>
                <span className="mono">{idn.status}</span>, basis {idn.basis}, design rank {idn.designRank ?? UNAVAILABLE} / {idn.trainRows} train rows{idn.saturated && ' (saturated)'}
                {idn.confoundedStats.length > 0 && <>; confounded stats: {idn.confoundedStats.join(', ')}</>}
                {badFolds.length > 0 && <>; CV folds not identified: {badFolds.map((f) => `${f.fold} (${f.status}${f.saturated ? ', saturated' : ''})`).join(', ')}</>}
              </>
            ) : (
              UNAVAILABLE
            )}
            .
          </p>
          <p className="hint">“Identified” means numerically non-collinear, not well-determined or precise. Selection authority is the stats status, not this diagnostic.</p>
        </div>
      </Section>

      <Section id="calib-apt-t" title="Aptitude check" testId="calib-aptitude">
        <p data-testid="apt-status">
          Status <span className="mono">{apt.status}</span>
          {apt.uninformative && <> — {apt.uninformative}</>} · {apt.rows} rows, {apt.cells} cells
        </p>
        <p data-testid="apt-full">
          Full log-likelihood:{' '}
          {apt.logLik === null ? (
            <>
              {UNAVAILABLE} (<span className="mono">{apt.fullLikelihood}</span>
              {apt.fullLikelihood === 'zero-probability-observed' && ': at least one observed grade had predicted probability 0, so the full likelihood is −∞'})
            </>
          ) : (
            <>
              {fmtNum(apt.logLik, 2)} over {apt.cells} cells (<span className="mono">{apt.fullLikelihood}</span>, mean {fmtNum(apt.meanLogLik, 3)})
            </>
          )}
        </p>
        <p data-testid="apt-conditional">
          Conditional log-likelihood (possible cells only; not the full fit): {fmtNum(apt.conditionalLogLik, 2)} over {apt.possibleCells} possible cells (mean {fmtNum(apt.conditionalMeanLogLik, 3)})
          {apt.status === 'uninformative' && ' (uninformative: every cell is degenerate)'}
        </p>
        <p data-testid="apt-impossible">
          Impossible observations: {apt.impossible} (below base {apt.belowBase} · above max {apt.aboveMax} · unreachable {apt.unreachable}); degenerate cells {apt.degenerateCells}, uncertain cells {apt.uncertainCells}
        </p>
        <p data-testid="apt-invalid">
          {apt.invalidObserved} invalid observed grade(s) excluded (not scored, not counted as impossible)
          {apt.invalidExamples.length > 0 && `: ${apt.invalidExamples.slice(0, 5).map((e) => `${e.apt} ${e.observed ?? e.valueType}`).join(', ')}`}
        </p>
      </Section>

      <Section id="calib-sk-t" title="Skill check (holdout)" testId="calib-skills">
        <p>
          Status <span className="mono">{r.skills.status}</span>
        </p>
        <ul>
          {r.skills.candidates.map((s) => (
            <li key={s.multiplier}>
              ×{fmtNum(s.multiplier, 2)}: <span className="mono">{s.holdout.status}</span>, {s.holdout.cells} scored cells over {s.holdout.rows} rows; log-likelihood {fmtNum(s.holdout.logLik, 2)}, Brier {fmtNum(s.holdout.brier, 3)}, z {fmtNum(s.holdout.z, 2)}; expected {fmtNum(s.holdout.expected, 1)} vs observed {s.holdout.observed}; contradictions {s.holdout.contradictions}
            </li>
          ))}
        </ul>
      </Section>

      <Section id="calib-sug-t" title="Suggested values (unverified proposals)" testId="calib-suggestions">
        {suggestion ? (
          <p>
            Suggested blueStatGain ×{fmtNum(suggestion.multiplier, 2)}: {triple(suggestion.current)} → {triple(suggestion.proposed)} (1★/2★/3★); not applied by this report; consistent with current: {yesNo(suggestion.consistentWithCurrent)}. Engine note: “{suggestion.note}”
          </p>
        ) : (
          <p>No suggestion: nothing to propose from this report.</p>
        )}
        <p id="calib-apply-why" className="hint">
          Calibration itself never changes the rules, the engine context, the model or anything stored. Apply (only for a suggested proposal of a current report) asks for confirmation, fits a candidate model first, and keeps the result in THIS browser only.
          {suggestion && apply?.disabledReason && <> Apply is unavailable: {apply.disabledReason}.</>}
        </p>
        <div className="row">
          {suggestion && (
            <button type="button" className="btn primary" disabled={!apply || apply.disabledReason !== null} aria-describedby="calib-apply-why" onClick={apply?.onApply}>
              Apply suggested multipliers
            </button>
          )}
          <button type="button" className="btn" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      </Section>

      <Section id="calib-nc-t" title="Rules not calibrated" testId="calib-not-calibrated">
        <ul>
          {r.notCalibrated.map((n) => (
            <li key={n.rule}>
              <span className="mono">{n.rule}</span> {n.verified ? <Tag kind="ok">verified</Tag> : <Tag kind="warn">unverified</Tag>} {n.placeholder && <Tag kind="warn">placeholder</Tag>} {n.reason}
            </li>
          ))}
        </ul>
      </Section>

      {r.warnings.length > 0 && (
        <Section id="calib-w-t" title="Engine warnings">
          <ul>
            {r.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
