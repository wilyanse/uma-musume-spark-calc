/**
 * blueStatGain identifiability on the TRAIN design (T15 review 1 N2, review 2 S-A).
 *
 * The stat check fits y_m = stat − E₀ − m·d with the 50 §4 ridge design X (intercept, scenario ×
 * mode cell one-hot, growth, card ids, card types, deck features). If a stat's sensitivity column
 * d lies in the column space of X, then m·d is exactly reproduced by a change of β: the
 * unpenalised least-squares fit is the same for every m, and the train/holdout MAE curve over m is
 * shaped only by the ridge penalty on that β change. Such an m is "design-confounded" (ridge-only)
 * and is not identified by data. A per-stat constant d is the special case of the intercept.
 *
 * Test: an orthonormal basis of the (column-normalised) design is built by modified Gram–Schmidt
 * with one full reorthogonalisation pass; a column joins the basis when its residual norm exceeds
 * RANK_REL_TOL of its own norm (relative rank tolerance). Each stat's d is projected (two passes)
 * and its relative residual ‖d − P d‖ / ‖d‖ is compared with COLLINEAR_REL_TOL. Both tolerances
 * are numeric guards against floating-point round-off, scale-free (d and every column are
 * normalised), and are not game facts.
 *
 * Saturation: when the basis rank reaches the number of train rows, every d is in the column space
 * and the test is vacuous (the ridge alone pins every coefficient). Then the test falls back to
 * the structural columns (everything except card-id columns), then to the intercept alone, and
 * reports `saturated: true` plus the basis used.
 *
 * Mixed stats: m is one shared multiplier of the blue table. It is identified when at least one
 * sensitive stat has a non-negligible residual; the confounded stats are listed and warned about,
 * since their part of the MAE criterion still varies with m only through the penalty.
 */
import { STAT_KEYS } from '@uma/schema';
import type { StatKey } from '@uma/schema';

/** Relative rank tolerance for accepting a design column into the basis (numeric guard). */
export const RANK_REL_TOL = 1e-10;
/**
 * A sensitivity whose relative residual off the design column space is at most this is
 * design-confounded. Numeric guard: well above double round-off of the projection (~1e-15 here)
 * and far below any real signal (the golden residuals are ≈ 0.6). Not a game fact.
 */
export const COLLINEAR_REL_TOL = 1e-7;
/**
 * A stat counts as sensitive on train rows when max|d| exceeds this fraction of the stat scale
 * (max |observed stat| on train rows, at least 1). Numeric guard against round-off, not a game fact.
 */
export const SENSITIVITY_REL_TOL = 1e-9;

export type IdentificationBasis = 'full-design' | 'structural-design' | 'intercept-only';
export type IdentificationStatus =
  'identified' | 'no-train-sensitivity' | 'intercept-confounded' | 'design-confounded';

export interface StatIdentification {
  stat: StatKey;
  /** max|d| over train rows exceeds SENSITIVITY_REL_TOL × the stat scale. */
  sensitive: boolean;
  /** ‖d − P d‖ / ‖d‖ against the basis used (null when not sensitive). */
  relativeResidual: number | null;
  /** relativeResidual ≤ COLLINEAR_REL_TOL (null when not sensitive). */
  confounded: boolean | null;
}

export interface FoldIdentification {
  fold: number;
  /** Rows the fold fit uses (train rows outside the fold). */
  rows: number;
  basis: IdentificationBasis;
  basisRank: number;
  saturated: boolean;
  status: IdentificationStatus;
}

export interface BlueIdentification {
  status: IdentificationStatus;
  basis: IdentificationBasis;
  /** The full design's rank reached the number of train rows (the full test is vacuous). */
  saturated: boolean;
  trainRows: number;
  /** Design columns including the intercept (0 when no design was supplied). */
  designColumns: number;
  /** Rank of the full design (null when no design was supplied). */
  designRank: number | null;
  basisRank: number;
  tolerance: number;
  perStat: StatIdentification[];
  /** Sensitive stats whose d lies in the basis column space. */
  confoundedStats: StatKey[];
  /** The same test on each CV fold's fitting rows (train-CV criterion and λ selection). */
  folds: FoldIdentification[];
}

export interface IdentifyOptions {
  /** Train design rows, column 0 the intercept (same order as the train sensitivities). */
  design?: readonly ArrayLike<number>[];
  /** Per design column: true when it is structural (not a card-id column). */
  structural?: readonly boolean[];
  /** Per stat scale for the sensitivity guard (default 1). */
  scale?: readonly number[];
  /** Fold id of each train row (CV partition); fold checks are skipped when absent. */
  folds?: readonly number[];
}

const norm = (v: Float64Array) => {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!;
  return Math.sqrt(s);
};

function project(basis: readonly Float64Array[], v: Float64Array): void {
  for (let pass = 0; pass < 2; pass++) {
    for (const q of basis) {
      let c = 0;
      for (let i = 0; i < v.length; i++) c += q[i]! * v[i]!;
      for (let i = 0; i < v.length; i++) v[i] = v[i]! - c * q[i]!;
    }
  }
}

/** Orthonormal basis of the selected columns of `cols` (each a length-n column vector). */
function orthoBasis(cols: readonly Float64Array[]): Float64Array[] {
  const basis: Float64Array[] = [];
  for (const c of cols) {
    const n0 = norm(c);
    if (!(n0 > 0)) continue;
    const v = Float64Array.from(c, (x) => x / n0);
    project(basis, v);
    const nv = norm(v);
    if (nv > RANK_REL_TOL) basis.push(v.map((x) => x / nv));
    if (basis.length >= v.length) break;
  }
  return basis;
}

function relResidual(basis: readonly Float64Array[], d: Float64Array): number {
  const n0 = norm(d);
  const v = Float64Array.from(d, (x) => x / n0);
  project(basis, v);
  return norm(v);
}

interface Tested {
  basis: IdentificationBasis;
  saturated: boolean;
  designRank: number | null;
  basisRank: number;
  perStat: StatIdentification[];
  interceptConstant: boolean;
}

function test(
  d: readonly (readonly number[])[],
  sensitive: readonly boolean[],
  design: readonly ArrayLike<number>[] | undefined,
  structural: readonly boolean[] | undefined,
): Tested {
  const n = d.length;
  const ones = new Float64Array(n).fill(1);
  const colsOf = (keep: (j: number) => boolean): Float64Array[] => {
    if (!design || !n) return [];
    const p = design[0]!.length;
    const out: Float64Array[] = [];
    for (let j = 0; j < p; j++) {
      if (!keep(j)) continue;
      out.push(Float64Array.from({ length: n }, (_, i) => design[i]![j]!));
    }
    return out;
  };
  const dCol = (k: number) => Float64Array.from(d, (row) => row[k]!);
  const intercept = orthoBasis([ones]);
  const interceptConstant = STAT_KEYS.every(
    (_, k) => !sensitive[k] || relResidual(intercept, dCol(k)) <= COLLINEAR_REL_TOL,
  );
  let basis: IdentificationBasis = 'intercept-only';
  let b = intercept;
  let saturated = false;
  let designRank: number | null = null;
  if (design && n) {
    const full = orthoBasis(colsOf(() => true));
    designRank = full.length;
    if (full.length < n) {
      basis = 'full-design';
      b = full;
    } else {
      saturated = true;
      const st = orthoBasis(colsOf((j) => structural?.[j] ?? true));
      if (st.length < n) {
        basis = 'structural-design';
        b = st;
      }
    }
  }
  const perStat = STAT_KEYS.map((stat, k): StatIdentification => {
    if (!sensitive[k]) return { stat, sensitive: false, relativeResidual: null, confounded: null };
    const r = relResidual(b, dCol(k));
    return { stat, sensitive: true, relativeResidual: r, confounded: r <= COLLINEAR_REL_TOL };
  });
  return { basis, saturated, designRank, basisRank: b.length, perStat, interceptConstant };
}

const statusOf = (t: Tested, anySensitive: boolean): IdentificationStatus =>
  !anySensitive
    ? 'no-train-sensitivity'
    : t.interceptConstant
      ? 'intercept-confounded'
      : t.perStat.some((s) => s.confounded === false)
        ? 'identified'
        : 'design-confounded';

/**
 * Whether a blueStatGain multiplier is identifiable from TRAIN rows. `train`/`hold` are per-row
 * sensitivities d = E₁ − E₀ (stat order). Holdout rows are evaluation only and never identify m.
 */
export function blueIdentifiability(
  train: readonly (readonly number[])[],
  hold: readonly (readonly number[])[],
  opts: IdentifyOptions = {},
): { identifiable: boolean; reasons: string[]; identification: BlueIdentification } {
  const scale = (k: number) => Math.max(1, opts.scale?.[k] ?? 1);
  const rowSens = (d: readonly number[]) =>
    d.some((x, k) => Math.abs(x) > SENSITIVITY_REL_TOL * scale(k));
  const sensitive = STAT_KEYS.map((_, k) =>
    train.some((d) => Math.abs(d[k]!) > SENSITIVITY_REL_TOL * scale(k)),
  );
  const anySensitive = sensitive.some(Boolean);
  const trainSens = train.filter(rowSens).length;
  const holdSens = hold.filter(rowSens).length;
  const t = test(train, sensitive, opts.design, opts.structural);
  const status = statusOf(t, anySensitive);
  const folds: FoldIdentification[] = [];
  if (opts.folds && opts.design) {
    const ids = [...new Set(opts.folds)].sort((a, b) => a - b);
    for (const f of ids) {
      const idx = train.map((_, i) => i).filter((i) => opts.folds![i] !== f);
      const sub = idx.map((i) => train[i]!);
      const fsens = STAT_KEYS.map((_, k) =>
        sub.some((d) => Math.abs(d[k]!) > SENSITIVITY_REL_TOL * scale(k)),
      );
      const ft = test(
        sub,
        fsens,
        idx.map((i) => opts.design![i]!),
        opts.structural,
      );
      folds.push({
        fold: f,
        rows: idx.length,
        basis: ft.basis,
        basisRank: ft.basisRank,
        saturated: ft.saturated,
        status: statusOf(ft, fsens.some(Boolean)),
      });
    }
  }
  const identification: BlueIdentification = {
    status,
    basis: t.basis,
    saturated: t.saturated,
    trainRows: train.length,
    designColumns: opts.design?.[0]?.length ?? 0,
    designRank: t.designRank,
    basisRank: t.basisRank,
    tolerance: COLLINEAR_REL_TOL,
    perStat: t.perStat,
    confoundedStats: t.perStat.filter((s) => s.confounded === true).map((s) => s.stat),
    folds,
  };
  const reasons: string[] = [];
  if (status === 'no-train-sensitivity') {
    reasons.push(
      `no train row's E[inh] depends on blueStatGain${holdSens ? ` (${holdSens} holdout row(s) do, but the holdout is evaluation only and cannot identify a multiplier)` : ''}`,
    );
  } else if (status === 'intercept-confounded') {
    reasons.push(
      `every train row has the same blueStatGain sensitivity per stat up to a relative ${COLLINEAR_REL_TOL} (${trainSens} of ${train.length} rows non-zero): m·d is a constant shift per stat, confounded with the intercept, so the train fit carries no information about m`,
    );
  } else if (status === 'design-confounded') {
    const maxRes = Math.max(...t.perStat.map((s) => s.relativeResidual ?? 0));
    reasons.push(
      `design-confounded: every sensitive stat's blueStatGain sensitivity lies in the column space of the train design (${t.basis}, rank ${t.basisRank} over ${train.length} train rows; max relative residual ${maxRes.toExponential(2)} ≤ ${COLLINEAR_REL_TOL}). Any m·d is absorbed by the cell/growth/card/type/deck coefficients, so a selected m would be ridge-only (set by the penalty, not by data); no multiplier is reported`,
    );
  }
  return { identifiable: status === 'identified', reasons, identification };
}
