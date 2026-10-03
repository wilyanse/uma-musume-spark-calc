/** Typed errors of the T06 training model, prediction and ranking (50 §4–§7, ADR-0002). */

/**
 * A snapshot whose statistical meaning this engine cannot use (ADR-0002 §4). `training-v1` is
 * legacy with unknown semantics and is never reinterpreted as v2; a snapshot fitted on another
 * master-data version also needs a refit (ADR-0002 §2.11).
 */
export class RefitRequiredError extends Error {
  override name = 'RefitRequiredError';
  readonly kind: string;
  readonly reason: 'legacy-kind' | 'unknown-kind' | 'master-version-mismatch' | 'malformed';
  constructor(kind: string, reason: RefitRequiredError['reason'], detail: string) {
    super(`refit required (${reason}, kind ${kind}): ${detail}`);
    this.kind = kind;
    this.reason = reason;
  }
}

/** Not enough eligible rows to fit (5-fold CV needs ≥ 5 train rows, the holdout ≥ 1). */
export class InsufficientDataError extends Error {
  override name = 'InsufficientDataError';
  readonly eligible: number;
  readonly train: number;
  readonly holdout: number;
  constructor(eligible: number, train: number, holdout: number, detail: string) {
    super(
      `insufficient training data: ${detail} (eligible ${eligible}, train ${train}, holdout ${holdout})`,
    );
    this.eligible = eligible;
    this.train = train;
    this.holdout = holdout;
  }
}

/** Invalid fit / predict / rank options (bad split, unknown locked parent, bad sample count…). */
export class ModelInputError extends Error {
  override name = 'ModelInputError';
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

/** Skill posterior failure (ADR-0002 §3): bad input, quadrature non-convergence or degeneracy. */
export class SkillPosteriorError extends Error {
  override name = 'SkillPosteriorError';
  readonly code: 'bad-input' | 'quadrature-nonconvergence' | 'degenerate';
  constructor(code: SkillPosteriorError['code'], message: string) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

/**
 * `scoreTarget` needs the joint samples (or a tally recorded for that exact target during
 * sampling). It never substitutes a product of marginals for the joint Monte Carlo pMeet.
 */
export class ScoreRequiresSamplesError extends Error {
  override name = 'ScoreRequiresSamplesError';
}
