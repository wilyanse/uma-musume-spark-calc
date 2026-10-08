/**
 * Engine worker surface (60 §1): real `@uma/engine` calls behind Comlink. This module is loaded
 * ONLY inside the worker (and by Node unit tests); the main bundle imports its types only.
 *
 * - Inputs arrive structured-cloned, so the worker never shares objects with the UI; it also
 *   never mutates them (the engine is pure).
 * - Typed engine errors do not survive Comlink's error transfer (only name/message do), so every
 *   call returns an `EngineResult` with a plain, typed error description instead of throwing.
 * - Context: `production` = published master + published rules VERBATIM (unverified rules stay
 *   unverified). `golden-fixture` = T08's `loadGoldenContext` (published rules except the
 *   documented SYNTHETIC blueStatGain and inheritance turns from golden-truth.json). Only the
 *   fixture-mode UI ever asks for the golden context.
 * - T15c (62): an optional BROWSER-LOCAL override replaces the base context's blueStatGain table
 *   with the ABSOLUTE values a calibration report proposed (never a multiplier re-applied to the
 *   current table), bound to the base context's fingerprint. Every context carries a SHA-256
 *   identity of its exact effective inputs; fit reports it and rank refuses any other identity.
 */
import {
  CardsFile,
  CharactersFile,
  AffinityFile,
  OutfitsFile,
  RanksFile,
  Rules,
  ScenariosFile,
  SkillsFile,
  SparksFile,
  VocabFile,
} from '@uma/schema';
import type { CmTarget, ModelSnapshot, RosterVeteran } from '@uma/schema';
import type { Rules as RulesT } from '@uma/schema';
import type { MasterBundle } from '@uma/master-data';
import {
  calibrateRules,
  fitTrainingModelDetailed,
  InsufficientDataError,
  loadContext,
  ModelInputError,
  rankPairsDetailed,
  RefitRequiredError,
  RulesError,
  ScoreRequiresSamplesError,
  SkillPosteriorError,
  UnknownIdError,
  NumericError,
  IllegalPairError,
  MODEL_KIND,
  MIN_CONFIDENCE,
} from '@uma/engine';
import type {
  CalibrationReport,
  EngineContext,
  FitReport,
  PerStar,
  PlanInput,
  RankOptions,
  RankProgress,
  RankResult,
} from '@uma/engine';
import { goldenContextLoader } from '../fixture-only/golden-context.ts';
import type { GoldenContextInput } from '../../../../packages/engine/scripts/golden-context.ts';
import { digestOf } from '../lib/digest.ts';

export type ContextKind = 'production' | 'golden-fixture';

/** 01 §1 ULID (same pattern the schema enforces on snapshot ids). */
const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

/** The identity scheme of `ContextInfo.fingerprint` (bump when the hashed inputs change). */
export const CONTEXT_IDENTITY = 'uma-web-context-v1';

/**
 * T15c: a browser-local blueStatGain override as the worker receives it. `proposed` are the
 * ABSOLUTE star values a calibration report proposed relative to the context it ran under; they
 * REPLACE the base table (repeat applications cannot compound). `baseFingerprint` binds it to the
 * base (published or synthetic-fixture) context it was created for.
 */
export interface WorkerOverride {
  id: string;
  rule: 'blueStatGain';
  proposed: [number, number, number];
  baseFingerprint: string;
  sourceReportId: string;
  multiplier: number;
}

export interface ContextInfo {
  kind: ContextKind;
  masterVersion: string;
  rulesVersion: string;
  unverifiedRules: string[];
  placeholderRules: string[];
  warnings: string[];
  /** Rule overrides applied on top of the published rules (golden fixture synthetic values, and a T15c browser-local override). */
  overrides: { rule: string; source: string }[];
  /** The engine's training-row confidence threshold (`MIN_CONFIDENCE`, 50 §4), for display. */
  minConfidence?: number;
  /** T15c: SHA-256 identity of the exact EFFECTIVE context (master bytes, rules, synthetic turns, override). */
  fingerprint: string;
  /** T15c: the same identity for the base context without any browser-local override. */
  baseFingerprint: string;
  /** T15c: rules.version of the base context (the effective version differs under an override). */
  baseRulesVersion: string;
  /** T15c: the browser-local override in force, or null. */
  override: { id: string; rule: 'blueStatGain'; proposed: [number, number, number]; sourceReportId: string; multiplier: number } | null;
  /** T15c: why a requested override was NOT applied (the base context stays in force), or null. */
  overrideRejected: string | null;
  /** T15c: the rules actually in force (effective values and sources), for the S07 rules table. */
  effectiveRules: RulesT;
}

export type EngineErrorInfo =
  | { name: 'RefitRequiredError'; message: string; reason: RefitRequiredError['reason']; kind: string }
  | {
      name: 'InsufficientDataError';
      message: string;
      eligible: number;
      train: number;
      holdout: number;
      /** The engine's own requirement text (e.g. "need ≥ 5 train rows …"), or null if absent. */
      requirement: string | null;
    }
  | { name: 'ModelInputError'; message: string; code: string }
  | { name: 'SkillPosteriorError'; message: string; code: string }
  | { name: 'NumericError'; message: string; code: string }
  | {
      name:
        | 'UnknownIdError'
        | 'RulesError'
        | 'ScoreRequiresSamplesError'
        | 'IllegalPairError'
        | 'MasterSchemaError'
        | 'NotConfiguredError'
        | 'ProvenanceMismatchError'
        | 'Error';
      message: string;
    };

export type EngineResult<T> = { ok: true; value: T } | { ok: false; error: EngineErrorInfo };

export function describeError(e: unknown): EngineErrorInfo {
  if (e instanceof RefitRequiredError)
    return { name: 'RefitRequiredError', message: e.message, reason: e.reason, kind: e.kind };
  if (e instanceof InsufficientDataError)
    return {
      name: 'InsufficientDataError',
      message: e.message,
      eligible: e.eligible,
      train: e.train,
      holdout: e.holdout,
      requirement: insufficientRequirement(e.message),
    };
  if (e instanceof ModelInputError) return { name: 'ModelInputError', message: e.message, code: e.code };
  if (e instanceof SkillPosteriorError)
    return { name: 'SkillPosteriorError', message: e.message, code: e.code };
  if (e instanceof NumericError) return { name: 'NumericError', message: e.message, code: e.code };
  if (e instanceof UnknownIdError) return { name: 'UnknownIdError', message: e.message };
  if (e instanceof RulesError) return { name: 'RulesError', message: e.message };
  if (e instanceof ScoreRequiresSamplesError)
    return { name: 'ScoreRequiresSamplesError', message: e.message };
  if (e instanceof IllegalPairError) return { name: 'IllegalPairError', message: e.message };
  if (e instanceof MasterSchemaError) return { name: 'MasterSchemaError', message: e.message };
  if (e instanceof NotConfiguredError) return { name: 'NotConfiguredError', message: e.message };
  if (e instanceof ProvenanceMismatchError) return { name: 'ProvenanceMismatchError', message: e.message };
  return { name: 'Error', message: e instanceof Error ? e.message : String(e) };
}

/**
 * The requirement clause of the engine's InsufficientDataError message
 * (`insufficient training data: <requirement> (eligible …)`), so the UI repeats the engine's own
 * thresholds instead of copying its constants (T13 review r1 N1).
 */
export function insufficientRequirement(message: string): string | null {
  const m = /^insufficient training data: (.+?) \(eligible \d+, train \d+, holdout \d+\)$/.exec(message);
  return m ? m[1]! : null;
}

class MasterSchemaError extends Error {
  override name = 'MasterSchemaError';
}
class NotConfiguredError extends Error {
  override name = 'NotConfiguredError';
}
/** T15c: a snapshot's claimed context identity is not the worker's current context. */
class ProvenanceMismatchError extends Error {
  override name = 'ProvenanceMismatchError';
}

const finiteNonNeg = (t: readonly unknown[]): t is [number, number, number] =>
  t.length === 3 && t.every((x) => typeof x === 'number' && Number.isFinite(x) && x >= 0);

/**
 * T15c: a NEW context whose blueStatGain table is exactly `table` (absolute values), verified:false
 * with `source`. The same construction as the engine's `withBlueStatGainMultiplier` (spread of the
 * read-only master maps, new rules/tables, blueStatGain marked unverified) but with the proposed
 * values themselves, so applying a proposal can never multiply an already-applied table again.
 */
export function withBlueStatGainTable(ctx: EngineContext, table: readonly number[], source: string, version: string): EngineContext {
  if (!finiteNonNeg(table)) throw new ModelInputError('bad-override', `blueStatGain override values must be finite and ≥ 0: ${JSON.stringify(table)}`);
  const scaled: PerStar = [table[0], table[1], table[2]];
  return {
    ...ctx,
    rules: {
      ...ctx.rules,
      version,
      blueStatGain: { ...ctx.rules.blueStatGain, '1': scaled[0], '2': scaled[1], '3': scaled[2], verified: false, source },
    },
    tables: { ...ctx.tables, blueStatGain: scaled },
    unverifiedRules: ctx.unverifiedRules.includes('blueStatGain') ? [...ctx.unverifiedRules] : [...ctx.unverifiedRules, 'blueStatGain'],
    placeholderRules: [...ctx.placeholderRules],
    warnings: [...ctx.warnings],
  };
}

/** Validates a requested override against the base context; returns the reason it is refused, or null. */
function overrideProblem(o: WorkerOverride, baseFingerprint: string): string | null {
  if (!o || typeof o !== 'object') return 'override is not an object';
  if (o.rule !== 'blueStatGain') return `unsupported rule ${String((o as { rule?: unknown }).rule)} (only blueStatGain proposals can be applied)`;
  if (!Array.isArray(o.proposed) || !finiteNonNeg(o.proposed)) return 'override values must be three finite numbers ≥ 0';
  if (typeof o.id !== 'string' || !ULID_RE.test(o.id)) return 'override id is not a ULID';
  if (o.baseFingerprint !== baseFingerprint) return 'it was created for a different base context (master, rules, mode or synthetic inputs changed)';
  return null;
}

function wrap<T>(fn: () => T): EngineResult<T> {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    return { ok: false, error: describeError(e) };
  }
}

/** Validates every master file against the shared schemas (60 §1: typed via @uma/schema). */
export function validateBundle(raw: MasterBundle): MasterBundle {
  const files = [
    ['characters', CharactersFile],
    ['outfits', OutfitsFile],
    ['skills', SkillsFile],
    ['sparks', SparksFile],
    ['cards', CardsFile],
    ['affinity', AffinityFile],
    ['scenarios', ScenariosFile],
    ['ranks', RanksFile],
    ['vocab', VocabFile],
    ['rules', Rules],
  ] as const;
  const out: Record<string, unknown> = { version: raw.version };
  for (const [key, schema] of files) {
    const r = schema.safeParse((raw as unknown as Record<string, unknown>)[key]);
    if (!r.success) throw new MasterSchemaError(`master ${key}.json: ${r.error.message}`);
    out[key] = r.data;
  }
  return out as unknown as MasterBundle;
}

export interface ConfigureInput {
  bundle: MasterBundle;
  kind: ContextKind;
  /** Required for `golden-fixture`: golden-truth.json's `syntheticInheritance`. */
  golden?: GoldenContextInput;
  /** T15c: browser-local override to apply on top of the base context (refused visibly if invalid). */
  override?: WorkerOverride | null;
}

/** A compact fit report for the UI (the full `FitReport` minus per-row lineage detail). */
export interface FitSummary {
  kind: FitReport['kind'];
  trainIds: number;
  holdoutIds: number;
  eligible: number;
  excluded: Record<string, number>;
  splitSource: FitReport['splitSource'];
  splitSeed: string | null;
  cvSeed: string;
  recencyClock: string;
  holdout: FitReport['holdout'];
  skills: Pick<FitReport['skills'], 'cells' | 'contradictions' | 'assumptions'>;
  warnings: string[];
}

/**
 * Fit result. The FitReport has holdout AGGREGATES only (MAE, pooled/per-stat coverage, bias): it
 * exposes no per-row predicted/actual values, so S07 cannot draw an honest scatter from it (Q-74)
 * and shows the per-stat aggregates instead.
 */
export interface FitOutput {
  snapshot: ModelSnapshot;
  summary: FitSummary;
  /** T15c: identity of the context this fit ran under, and whether a browser-local override was in force. */
  contextFingerprint: string;
  overridden: boolean;
}

/** T15c: what the caller claims about the snapshot it asks the worker to rank with. */
export interface SnapshotProvenance {
  contextFingerprint: string;
}

/**
 * T15b (61): provenance of the context a calibration ran under, captured inside the worker at
 * call time (not inferred by the UI). `synthetic` is true only for the fixture-only golden context.
 */
export interface CalibrationContextInfo {
  kind: ContextKind;
  synthetic: boolean;
  masterVersion: string;
  rulesVersion: string;
  unverifiedRules: string[];
  placeholderRules: string[];
  overrides: { rule: string; source: string }[];
  /** T15c: identity of the effective context the report was computed under. */
  fingerprint: string;
  baseFingerprint: string;
  overrideId: string | null;
}

/** Read-only diagnostics: the engine-local `CalibrationReport` (never stored or sent) + provenance. */
export interface CalibrationOutput {
  report: CalibrationReport;
  context: CalibrationContextInfo;
}

/** Serializable calibration inputs (no functions cross Comlink): clock and report id. */
export interface CalibrateOpts {
  nowIso: string;
  id?: string;
}

export interface EngineApi {
  configure(input: ConfigureInput): EngineResult<ContextInfo>;
  fit(roster: RosterVeteran[], opts: { nowIso: string; id?: string }): EngineResult<FitOutput>;
  /**
   * 50 §8 `calibrateRules` on the configured context (T15b). Pure: never changes the context, no
   * snapshot, no storage. Synchronous inside the worker; cancel = terminate (client.ts).
   */
  calibrate(roster: RosterVeteran[], opts: CalibrateOpts): EngineResult<CalibrationOutput>;
  /**
   * T15c: `provenance` is REQUIRED: the context identity the snapshot was fitted under. A missing or
   * different identity (or one contradicting a fit this worker ran) is a ProvenanceMismatchError.
   */
  rank(
    snapshot: ModelSnapshot,
    input: PlanInput,
    roster: RosterVeteran[],
    target: CmTarget,
    opts: RankOptions,
    provenance: SnapshotProvenance,
    onProgress?: (p: RankProgress) => void,
  ): EngineResult<RankResult>;
  modelKind(): string;
}

/**
 * Identity of the effective context: master bundle bytes (validated), the effective rules object,
 * the context kind and any synthetic inheritance turns, as canonical JSON under SHA-256.
 */
function contextIdentity(bundle: MasterBundle, kind: ContextKind, rules: RulesT, turns: unknown): string {
  return digestOf({ scheme: CONTEXT_IDENTITY, kind, master: digestOf(bundle), rules, syntheticTurns: turns ?? null });
}

export function createEngineApi(): EngineApi {
  let ctx: EngineContext | null = null;
  let info: ContextInfo | null = null;
  /** Snapshot id → identity of the context this worker fitted it under. */
  const fitted = new Map<string, string>();
  const need = (): EngineContext => {
    if (!ctx) throw new NotConfiguredError('engine context not configured');
    return ctx;
  };
  return {
    configure: (input) =>
      wrap(() => {
        // Build into locals; ctx and info are assigned together only on success (T15b N1).
        const bundle = validateBundle(input.bundle);
        let base: EngineContext;
        let overrides: ContextInfo['overrides'] = [];
        let turns: unknown = null;
        if (input.kind === 'golden-fixture') {
          if (!goldenContextLoader) throw new NotConfiguredError('golden-fixture context is not built into production');
          if (!input.golden) throw new NotConfiguredError('golden-fixture context needs golden-truth.json');
          base = goldenContextLoader(bundle, input.golden);
          turns = Object.fromEntries(
            Object.entries(input.golden.syntheticInheritance.inheritanceTurns).map(([id, t]) => [id, [...t.turns]]),
          );
          overrides = [
            { rule: 'blueStatGain', source: input.golden.syntheticInheritance.rulesOverrides.blueStatGain.source },
            ...Object.keys(input.golden.syntheticInheritance.inheritanceTurns).map((id) => ({
              rule: `inheritanceTurns(${id})`,
              source: 'SYNTHETIC (golden-truth.json syntheticInheritance, Q-120)',
            })),
          ];
        } else {
          base = loadContext(bundle, bundle.rules);
        }
        const baseFingerprint = contextIdentity(bundle, input.kind, base.rules, turns);
        let next = base;
        let override: ContextInfo['override'] = null;
        let overrideRejected: string | null = null;
        if (input.override) {
          const o = input.override;
          overrideRejected = overrideProblem(o, baseFingerprint);
          if (!overrideRejected) {
            const source = `BROWSER-LOCAL override from calibration report ${o.sourceReportId} (×${o.multiplier} proposal; unverified statistical value, not a game fact; this browser only)`;
            next = withBlueStatGainTable(base, o.proposed, source, `${base.rules.version}+local-${o.id}`);
            override = { id: o.id, rule: 'blueStatGain', proposed: [...o.proposed], sourceReportId: o.sourceReportId, multiplier: o.multiplier };
            overrides = [...overrides.filter((x) => x.rule !== 'blueStatGain'), { rule: 'blueStatGain', source }];
          }
        }
        const fingerprint = override ? contextIdentity(bundle, input.kind, next.rules, turns) : baseFingerprint;
        const nextInfo: ContextInfo = {
          kind: input.kind,
          masterVersion: next.masterVersion,
          rulesVersion: next.rules.version,
          unverifiedRules: [...next.unverifiedRules],
          placeholderRules: [...next.placeholderRules],
          warnings: [...next.warnings],
          overrides,
          minConfidence: MIN_CONFIDENCE,
          fingerprint,
          baseFingerprint,
          baseRulesVersion: base.rules.version,
          override,
          overrideRejected,
          effectiveRules: structuredClone(next.rules),
        };
        ctx = next;
        info = nextInfo;
        return nextInfo;
      }),
    fit: (roster, opts) =>
      wrap(() => {
        const c = need();
        const now = new Date(opts.nowIso);
        const i = info!;
        const { snapshot, report } = fitTrainingModelDetailed(c, roster, {
          now: () => now,
          ...(opts.id ? { id: () => opts.id! } : {}),
        });
        fitted.set(snapshot.id, i.fingerprint);
        const excluded: Record<string, number> = {};
        for (const r of report.rows) if (!r.eligible && r.reason) excluded[r.reason] = (excluded[r.reason] ?? 0) + 1;
        return {
          snapshot,
          summary: {
            kind: report.kind,
            trainIds: report.trainIds.length,
            holdoutIds: report.holdoutIds.length,
            eligible: report.rows.filter((r) => r.eligible).length,
            excluded,
            splitSource: report.splitSource,
            splitSeed: report.splitSeed,
            cvSeed: report.cvSeed,
            recencyClock: report.recencyClock,
            holdout: report.holdout,
            skills: {
              cells: report.skills.cells,
              contradictions: report.skills.contradictions,
              assumptions: report.skills.assumptions,
            },
            warnings: report.warnings,
          },
          contextFingerprint: i.fingerprint,
          overridden: i.override !== null,
        };
      }),
    calibrate: (roster, opts) =>
      wrap(() => {
        const c = need();
        const i = info!;
        const now = new Date(opts.nowIso);
        if (Number.isNaN(now.getTime())) throw new ModelInputError('bad-now', `nowIso ${opts.nowIso}`);
        // The id also names the candidate refit snapshots, which the schema requires to be ULIDs.
        if (opts.id !== undefined && !ULID_RE.test(opts.id)) throw new ModelInputError('bad-id', `report id ${opts.id} is not a ULID`);
        const report = calibrateRules(c, roster, {
          now: () => now,
          ...(opts.id ? { id: () => opts.id! } : {}),
        });
        return {
          report,
          context: {
            kind: i.kind,
            synthetic: i.kind === 'golden-fixture',
            masterVersion: report.masterVersion,
            rulesVersion: report.rulesVersion,
            unverifiedRules: [...i.unverifiedRules],
            placeholderRules: [...i.placeholderRules],
            overrides: i.overrides.map((o) => ({ ...o })),
            fingerprint: i.fingerprint,
            baseFingerprint: i.baseFingerprint,
            overrideId: i.override?.id ?? null,
          },
        };
      }),
    rank: (snapshot, input, roster, target, opts, provenance, onProgress) =>
      wrap(() => {
        const c = need();
        const i = info!;
        const claimed = provenance?.contextFingerprint;
        if (typeof claimed !== 'string') throw new ProvenanceMismatchError('rank needs the snapshot context identity; refit the model');
        if (claimed !== i.fingerprint) {
          throw new ProvenanceMismatchError(`the model was fitted under another rules context (${claimed.slice(0, 19)}…) than the active one (${i.fingerprint.slice(0, 19)}…); refit the model`);
        }
        const known = snapshot && typeof snapshot === 'object' ? fitted.get(snapshot.id) : undefined;
        if (known !== undefined && known !== i.fingerprint) {
          throw new ProvenanceMismatchError('this worker fitted the snapshot under another rules context; refit the model');
        }
        return rankPairsDetailed(c, snapshot, input, roster, target, opts, onProgress);
      }),
    modelKind: () => MODEL_KIND,
  };
}
