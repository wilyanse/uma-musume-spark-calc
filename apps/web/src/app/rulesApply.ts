/**
 * T15c (62 §Explicit confirmation and transaction, §Reset): apply a calibration proposal as a
 * BROWSER-LOCAL blueStatGain override, fit-before-commit, and reset to the base context.
 *
 * Apply transaction:
 * 1. Eligibility (pure, `applyEligibility`): stats.status 'suggested' (the selection authority,
 *    never the raw identification status) with an actual producer blueStatGain proposal, a report
 *    that is current for the active context identity / roster / master, and no problem state.
 * 2. Candidate: an ISOLATED engine client (its own worker) is configured with the candidate
 *    override and fits a fresh model. The active worker, its context and the active model are not
 *    touched, so a failure/cancel cannot alter active predictions.
 * 3. Authority is rechecked after every await (`isCurrent`, and the stored override string still
 *    equals the one the confirmation was bound to).
 * 4. Commit (synchronous, no await in between): back up the local model, write the candidate model
 *    envelope, then compare-and-swap the override record. Any failure restores what was there and
 *    reports "not applied". Only after both writes succeed does the app reconfigure (the stored
 *    string changes, so the engine-context query reconfigures the active worker).
 * The overridden model is never sent to `POST /model-snapshots`.
 */
import type { QueryClient } from '@tanstack/react-query';
import type { RosterVeteran } from '@uma/schema';
import type { CalibrationSuggestion } from '@uma/engine';
import type { AppServices } from './services.ts';
import { FIT_SUMMARY_KEY, type EngineContextState, type SessionFit } from './engine.ts';
import type { SessionCalibration } from './calibration.ts';
import { notifyRulesChanged, storedOverrideRaw } from './rulesSession.ts';
import { staleReasons, type CalibrationProvenance } from '../lib/calibration.ts';
import {
  LOCAL_MODEL_SCHEMA,
  localModelKey,
  overrideKey,
  restoreRaw,
  saveLocalModel,
  writeOverrideState,
  type ActiveOverride,
  type LocalModelEnvelope,
} from '../lib/rulesOverride.ts';
import { ulid } from '../lib/ulid.ts';
import { withRulesLock } from './rulesLock.ts';
import type { FitOutput } from '../workers/engine.api.ts';
import type { MasterData } from '../master/load.ts';
import type { FixtureGolden } from './services.ts';

export type Eligibility =
  | { ok: true; suggestion: CalibrationSuggestion }
  | { ok: false; reason: string };

/** Whether the session report's proposal may be applied to the active context right now. */
export function applyEligibility(
  session: SessionCalibration | null,
  ctx: EngineContextState | undefined,
  current: CalibrationProvenance | null,
): Eligibility {
  if (!session) return { ok: false, reason: 'no calibration report' };
  if (!ctx || !current) return { ok: false, reason: 'the engine context is loading' };
  const r = session.output.report;
  if (r.stats.status !== 'suggested') return { ok: false, reason: `stats status is ${r.stats.status}, not suggested` };
  const s = r.suggestions.find((x) => x.rule === 'blueStatGain' && x.kind === 'multiplier');
  if (!s) return { ok: false, reason: 'the report made no blueStatGain proposal' };
  if (!s.proposed.every((x) => Number.isFinite(x) && x >= 0)) return { ok: false, reason: 'the proposal has invalid values' };
  if (!s.change) return { ok: false, reason: 'the proposal equals the rules in force (×1), so there is nothing to apply' };
  const stale = staleReasons(session.provenance, current);
  if (stale.length) return { ok: false, reason: `the report is stale (${stale.join(', ')}); run calibration again` };
  if (session.output.context.fingerprint !== ctx.fingerprint) return { ok: false, reason: 'the report was computed under another rules context; run calibration again' };
  if (ctx.overrideProblem) return { ok: false, reason: 'resolve the rules override problem first (reset)' };
  return { ok: true, suggestion: s };
}

/** What the confirmation dialog shows and what confirming binds to. */
export interface ApplyProposal {
  reportId: string;
  provenanceKey: string;
  storedRaw: string | null;
  storedRevision: number;
  contextFingerprint: string;
  suggestion: CalibrationSuggestion;
}

export type ApplyOutcome =
  | { status: 'applied'; override: ActiveOverride; fit: SessionFit; revision: number }
  | { status: 'cancelled' }
  | { status: 'refused'; message: string }
  | { status: 'failed'; message: string };

export interface ApplyArgs {
  proposal: ApplyProposal;
  session: SessionCalibration;
  ctx: EngineContextState;
  master: MasterData;
  golden?: FixtureGolden;
  roster: RosterVeteran[];
  rosterEtag: string | null;
  rosterIdentity: string;
  /** False once the caller's authority is gone (inputs changed, unmount, user cancel). */
  isCurrent: () => boolean;
  onCandidateStart?: (cancel: () => void) => void;
}

const REFUSED = 'The source changed while applying (report, roster, master or rules override, possibly in another tab). Nothing was applied; the active rules and model are unchanged.';

export async function applyProposal(services: AppServices, qc: QueryClient, a: ApplyArgs): Promise<ApplyOutcome> {
  const { now } = services;
  const fresh = () => a.isCurrent() && storedOverrideRaw(services) === a.proposal.storedRaw;
  if (!fresh()) return { status: 'refused', message: REFUSED };
  if (!services.candidateEngine) return { status: 'failed', message: 'No isolated candidate engine is available; nothing was applied.' };
  const s = a.proposal.suggestion;
  const r = a.session.output.report;
  const at = now();
  const override: ActiveOverride = {
    id: ulid(at.getTime(), Math.random),
    appliedAt: at.toISOString(),
    rule: 'blueStatGain',
    proposed: [s.proposed[0], s.proposed[1], s.proposed[2]],
    verified: false,
    source: `BROWSER-LOCAL override from calibration report ${r.id} (×${s.multiplier} proposal; unverified statistical value, not a game fact; this browser only)`,
    sourceReport: {
      id: r.id,
      generatedAt: r.generatedAt,
      multiplier: s.multiplier,
      contextFingerprint: a.session.output.context.fingerprint,
      current: [s.current[0], s.current[1], s.current[2]],
      rosterEtag: a.session.provenance.rosterEtag,
      rosterIdentity: a.session.provenance.rosterIdentity,
    },
    base: { contextKind: a.ctx.kind, masterVersion: a.ctx.masterVersion, rulesVersion: a.ctx.baseRulesVersion, fingerprint: a.ctx.baseFingerprint },
  };
  const candidate = services.candidateEngine();
  try {
    const cfg = await candidate.configure({
      bundle: a.master.bundle,
      kind: a.ctx.kind,
      ...(a.golden ? { golden: a.golden } : {}),
      override: { id: override.id, rule: 'blueStatGain', proposed: [...override.proposed], baseFingerprint: override.base.fingerprint, sourceReportId: r.id, multiplier: s.multiplier },
    });
    if (!fresh()) return a.isCurrent() ? { status: 'refused', message: REFUSED } : { status: 'cancelled' };
    if (!cfg.ok) return { status: 'failed', message: `The candidate context could not be built: ${cfg.error.message}. Nothing was applied.` };
    if (!cfg.value.override || cfg.value.overrideRejected) return { status: 'failed', message: `The candidate override was refused: ${cfg.value.overrideRejected ?? 'unknown reason'}. Nothing was applied.` };
    if (cfg.value.baseFingerprint !== a.ctx.baseFingerprint) return { status: 'refused', message: REFUSED };
    const job = candidate.fit(a.roster, { nowIso: now().toISOString() });
    a.onCandidateStart?.(job.cancel);
    const out = await job.promise;
    if (out.status === 'cancelled' || out.status === 'superseded') return { status: 'cancelled' };
    if (!fresh()) return a.isCurrent() ? { status: 'refused', message: REFUSED } : { status: 'cancelled' };
    if (out.status === 'crashed') return { status: 'failed', message: `The candidate fit failed: the engine worker stopped: ${out.message}. Nothing was applied.` };
    if (!out.result.ok) return { status: 'failed', message: `The candidate fit failed: ${out.result.error.message}. Nothing was applied.` };
    const fit: FitOutput = out.result.value;
    if (fit.contextFingerprint !== cfg.value.fingerprint || !fit.overridden) return { status: 'failed', message: 'The candidate fit did not run under the candidate context. Nothing was applied.' };
    return await withRulesLock(services.store, services.source.kind, () => commit(services, qc, a, override, fit, cfg.value.fingerprint));
  } catch (e) {
    return { status: 'failed', message: `Apply failed: ${e instanceof Error ? e.message : String(e)}. No successful application is claimed; review the active rules shown above.` };
  } finally {
    candidate.dispose();
  }
}

/** Synchronous commit (no await): model envelope, then CAS override write; rollback on failure. */
function commit(services: AppServices, qc: QueryClient, a: ApplyArgs, override: ActiveOverride, fit: FitOutput, fingerprint: string): ApplyOutcome {
  const { store, source, now } = services;
  const mode = source.kind;
  if (!a.isCurrent() || storedOverrideRaw(services) !== a.proposal.storedRaw) return { status: 'refused', message: REFUSED };
  let oldModel: string | null;
  try {
    oldModel = store.getItem(localModelKey(mode));
  } catch (e) {
    return { status: 'failed', message: `Browser storage could not be read (${e instanceof Error ? e.message : String(e)}). Nothing was applied.` };
  }
  const env: LocalModelEnvelope = {
    schema: LOCAL_MODEL_SCHEMA,
    v: 1,
    mode,
    overrideId: override.id,
    contextFingerprint: fingerprint,
    baseFingerprint: override.base.fingerprint,
    masterVersion: a.ctx.masterVersion,
    rosterEtag: a.rosterEtag,
    rosterIdentity: a.rosterIdentity,
    snapshot: fit.snapshot,
    savedAt: now().toISOString(),
  };
  const m = saveLocalModel(store, mode, env);
  if (!m.ok) {
    const restored = restoreRaw(store, localModelKey(mode), oldModel);
    return { status: 'failed', message: `The fitted model couldn't be kept in this browser (${m.reason}). Nothing was applied${restored ? '' : '; the previous local model could not be restored and will be refitted'}.` };
  }
  const w = writeOverrideState(store, mode, a.proposal.storedRaw, override);
  if (!w.ok) {
    const restored = restoreRaw(store, localModelKey(mode), oldModel);
    // A failed write may have left a partial value: restore the exact previous override string.
    const current = (() => { try { return store.getItem(overrideKey(mode)); } catch { return undefined; } })();
    const overrideRestored = current === a.proposal.storedRaw || restoreRaw(store, overrideKey(mode), a.proposal.storedRaw);
    notifyRulesChanged(store);
    return {
      status: 'failed',
      message: `The override couldn't be saved (${w.reason}). Nothing was applied${restored && overrideRestored ? '' : '; browser storage may be inconsistent, so the stored state is re-read and any mismatch forces a refit'}.`,
    };
  }
  const sessionFit: SessionFit = { output: fit, reason: 'context-changed', at: now().toISOString() };
  qc.setQueryData(FIT_SUMMARY_KEY, sessionFit);
  void qc.invalidateQueries({ queryKey: ['local-model'] });
  notifyRulesChanged(store);
  return { status: 'applied', override, fit: sessionFit, revision: w.revision };
}

export type ResetOutcome = { status: 'reset'; note: string | null } | { status: 'refused'; message: string } | { status: 'failed'; message: string };

/**
 * Explicit reset to the base context (published rules in production, the SYNTHETIC golden context in
 * fixture mode), bound to the exact stored override string the user confirmed. Clears only this
 * mode's override and local overridden model; never touches the server or master data.
 */
export async function resetOverride(services: AppServices, qc: QueryClient, expectedRaw: string | null): Promise<ResetOutcome> {
  try {
    return await withRulesLock(services.store, services.source.kind, () => resetLocked(services, qc, expectedRaw));
  } catch (e) {
    return { status: 'failed', message: `Reset failed: ${e instanceof Error ? e.message : String(e)}. The previous rules remain active.` };
  }
}

function resetLocked(services: AppServices, qc: QueryClient, expectedRaw: string | null): ResetOutcome {
  const { store, source } = services;
  if (storedOverrideRaw(services) !== expectedRaw) return { status: 'refused', message: 'The rules override changed in another tab since you confirmed. Nothing was reset; review the current state and try again.' };
  const modelKey = localModelKey(source.kind);
  const provenanceKey = `uma:${source.kind}:model-fit`;
  let oldModel: string | null;
  let oldProvenance: string | null;
  try { oldModel = store.getItem(modelKey); oldProvenance = store.getItem(provenanceKey); }
  catch (e) { return { status: 'failed', message: `Reset failed reading storage: ${String(e)}. The previous rules remain active.` }; }
  // Remove stale provenance BEFORE activation. A failed reset must retain the previous rules.
  const modelRemoved = restoreRaw(store, modelKey, null);
  const provenanceRemoved = restoreRaw(store, provenanceKey, null);
  if (!modelRemoved || !provenanceRemoved) {
    const restoredModel = restoreRaw(store, modelKey, oldModel);
    const restoredProvenance = restoreRaw(store, provenanceKey, oldProvenance);
    void qc.invalidateQueries({ queryKey: ['local-model'] });
    return { status: 'failed', message: `Reset could not clear local model/provenance. The previous rules remain active.${restoredModel && restoredProvenance ? '' : ' Storage rollback was incomplete; the model may need refitting.'}` };
  }
  const w = writeOverrideState(store, source.kind, expectedRaw, null);
  if (!w.ok) {
    const restoredOverride = restoreRaw(store, overrideKey(source.kind), expectedRaw);
    const restoredModel = restoreRaw(store, modelKey, oldModel);
    const restoredProvenance = restoreRaw(store, provenanceKey, oldProvenance);
    void qc.invalidateQueries({ queryKey: ['local-model'] });
    notifyRulesChanged(store);
    return { status: 'failed', message: `Reset failed: ${w.reason}.${restoredOverride && restoredModel && restoredProvenance ? ' The previous rules and model remain active.' : ' Storage rollback was incomplete; the actual stored rules are shown above and refitting may be required.'}` };
  }
  qc.removeQueries({ queryKey: FIT_SUMMARY_KEY });
  void qc.invalidateQueries({ queryKey: ['local-model'] });
  void qc.invalidateQueries({ queryKey: ['model-snapshot'] });
  notifyRulesChanged(store);
  return { status: 'reset', note: modelRemoved && provenanceRemoved ? null : 'Old local model/provenance could not be removed completely. Review storage before reuse; no server snapshot was deleted.' };
}
