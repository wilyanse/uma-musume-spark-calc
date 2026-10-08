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
  PlanInput,
  RankOptions,
  RankProgress,
  RankResult,
} from '@uma/engine';
import { goldenContextLoader } from '../fixture-only/golden-context.ts';
import type { GoldenContextInput } from '../../../../packages/engine/scripts/golden-context.ts';

export type ContextKind = 'production' | 'golden-fixture';

/** 01 §1 ULID (same pattern the schema enforces on snapshot ids). */
const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

export interface ContextInfo {
  kind: ContextKind;
  masterVersion: string;
  rulesVersion: string;
  unverifiedRules: string[];
  placeholderRules: string[];
  warnings: string[];
  /** Rule overrides applied on top of the published rules (golden fixture only). */
  overrides: { rule: string; source: string }[];
  /** The engine's training-row confidence threshold (`MIN_CONFIDENCE`, 50 §4), for display. */
  minConfidence?: number;
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
  rank(
    snapshot: ModelSnapshot,
    input: PlanInput,
    roster: RosterVeteran[],
    target: CmTarget,
    opts: RankOptions,
    onProgress?: (p: RankProgress) => void,
  ): EngineResult<RankResult>;
  modelKind(): string;
}

export function createEngineApi(): EngineApi {
  let ctx: EngineContext | null = null;
  let info: ContextInfo | null = null;
  const need = (): EngineContext => {
    if (!ctx) throw new NotConfiguredError('engine context not configured');
    return ctx;
  };
  return {
    configure: (input) =>
      wrap(() => {
        const bundle = validateBundle(input.bundle);
        let overrides: ContextInfo['overrides'] = [];
        if (input.kind === 'golden-fixture') {
          if (!goldenContextLoader) throw new NotConfiguredError('golden-fixture context is not built into production');
          if (!input.golden) throw new NotConfiguredError('golden-fixture context needs golden-truth.json');
          ctx = goldenContextLoader(bundle, input.golden);
          overrides = [
            { rule: 'blueStatGain', source: input.golden.syntheticInheritance.rulesOverrides.blueStatGain.source },
            ...Object.keys(input.golden.syntheticInheritance.inheritanceTurns).map((id) => ({
              rule: `inheritanceTurns(${id})`,
              source: 'SYNTHETIC (golden-truth.json syntheticInheritance, Q-120)',
            })),
          ];
        } else {
          ctx = loadContext(bundle, bundle.rules);
        }
        // ctx and info always change together (a failed configure keeps the previous pair).
        info = {
          kind: input.kind,
          masterVersion: ctx.masterVersion,
          rulesVersion: ctx.rules.version,
          unverifiedRules: [...ctx.unverifiedRules],
          placeholderRules: [...ctx.placeholderRules],
          warnings: [...ctx.warnings],
          overrides,
          minConfidence: MIN_CONFIDENCE,
        };
        return info;
      }),
    fit: (roster, opts) =>
      wrap(() => {
        const c = need();
        const now = new Date(opts.nowIso);
        const { snapshot, report } = fitTrainingModelDetailed(c, roster, {
          now: () => now,
          ...(opts.id ? { id: () => opts.id! } : {}),
        });
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
          },
        };
      }),
    rank: (snapshot, input, roster, target, opts, onProgress) =>
      wrap(() => rankPairsDetailed(need(), snapshot, input, roster, target, opts, onProgress)),
    modelKind: () => MODEL_KIND,
  };
}
