/**
 * T15 evidence runner (TEST-ONLY, not production): runs `calibrateRules` on the committed golden
 * inputs and prints input file hashes, the stat/aptitude/skill summaries and measured runtimes.
 * Reads files; writes nothing unless `--out <path>` is given (a JSON summary, e.g. under the
 * scratch dir). Usage:
 *   node packages/engine/test/calibrate/golden-report.ts [--out <file>] [--variants]
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { calibrateRules } from '../../src/index.ts';
import type { CalibrationReport, EngineContext } from '../../src/index.ts';
import type { RosterVeteran } from '@uma/schema';
import { GOLDEN_DIR } from '../golden/load.ts';
import { calibrationRoster, goldenCtx, opts, publishedCtx, roster } from './helpers.ts';

const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const variants = args.includes('--variants');
const sha = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex');
const files = ['roster.json', 'roster.calibration-x1.3.json', 'truth.json'].map((f) =>
  join(GOLDEN_DIR, f),
);
const publishedRules = join(
  GOLDEN_DIR,
  '../../../../apps/web/public/master/global-20260930/rules.json',
);
const hashes = Object.fromEntries(
  [...files, publishedRules].map((f) => [
    f.replace(/^.*packages\//, 'packages/').replace(/^.*apps\//, 'apps/'),
    sha(f),
  ]),
);

function run(name: string, ctx: () => EngineContext, rows: readonly RosterVeteran[], extra = {}) {
  const t = performance.now();
  const r: CalibrationReport = calibrateRules(
    ctx(),
    rows,
    opts({ timer: () => performance.now(), ...extra }),
  );
  const wall = performance.now() - t;
  const s = r.stats;
  const at = (m: number) => s.grid.find((g) => Math.abs(g.multiplier - m) < 1e-9)?.holdoutMae;
  const line = {
    name,
    status: r.status,
    statStatus: s.status,
    used: r.population.used,
    excluded: r.population.excluded,
    split: [r.split.trainIds.length, r.split.holdoutIds.length],
    dropped: r.split.dropped.length,
    coupling: r.split.lineageCoupling,
    selected: s.selected,
    trainCvSelected: s.trainCvSelected,
    holdoutMaeOfTrainCvSelection: s.evaluation.holdoutMaeOfTrainCvSelection,
    currentHoldoutMae: s.evaluation.currentHoldoutMae,
    maeAt: {
      '0.5': at(0.5),
      '1.0': at(1),
      '1.2': at(1.2),
      '1.3': at(1.3),
      '1.4': at(1.4),
      '2.0': at(2),
    },
    bootstrap: s.bootstrap,
    uncertainty: s.uncertainty.status,
    selectionAgreement: s.selectionAgreement,
    withoutInheritance: s.withoutInheritance?.holdoutMae ?? null,
    nonidentifiable: s.nonidentifiable ?? null,
    identification: s.identification
      ? {
          status: s.identification.status,
          basis: s.identification.basis,
          saturated: s.identification.saturated,
          designRank: s.identification.designRank,
          basisRank: s.identification.basisRank,
          trainRows: s.identification.trainRows,
          minRelativeResidual: Math.min(
            ...s.identification.perStat.map((p) => p.relativeResidual ?? Infinity),
          ),
          confoundedStats: s.identification.confoundedStats,
          folds: s.identification.folds.map((f) => f.status),
        }
      : null,
    suggestions: r.suggestions.map((x) => ({
      rule: x.rule,
      multiplier: x.multiplier,
      proposed: x.proposed,
    })),
    candidates: r.candidates.map((c) => ({
      m: c.multiplier,
      status: c.status,
      mae: c.fit?.holdoutMae,
      coverage80: c.fit?.coverage80,
      fp: c.fit?.trainFingerprint,
    })),
    aptitude: {
      status: r.aptitude.status,
      cells: r.aptitude.cells,
      fullLikelihood: r.aptitude.fullLikelihood,
      logLik: r.aptitude.logLik,
      possibleCells: r.aptitude.possibleCells,
      conditionalLogLik: r.aptitude.conditionalLogLik,
      impossible: r.aptitude.impossible,
      belowBase: r.aptitude.belowBase,
      aboveMax: r.aptitude.aboveMax,
      unreachable: r.aptitude.unreachable,
      uncertain: r.aptitude.uncertainCells,
      invalidObserved: r.aptitude.invalidObserved,
    },
    skills: r.skills.candidates.map((c) => ({
      m: c.multiplier,
      status: c.holdout.status,
      cells: c.holdout.cells,
      expected: c.holdout.expected,
      observed: c.holdout.observed,
      z: c.holdout.z,
      brier: c.holdout.brier,
      lineageOnly: [c.holdout.lineageOnly.expected, c.holdout.lineageOnly.observed],
      contradictions: c.holdout.contradictions,
    })),
    runtime: { ...r.runtime, wallMs: wall },
    warnings: r.warnings,
  };
  return line;
}

const out: Record<string, unknown> = { hashes, node: process.version, runs: [] as unknown[] };
const runs = out.runs as unknown[];
runs.push(run('x1.3 roster, golden context, stored split', () => goldenCtx(), calibrationRoster));
runs.push(run('base roster, golden context, stored split', () => goldenCtx(), roster));
runs.push(run('x1.3 roster, published context', publishedCtx, calibrationRoster));
if (variants) {
  runs.push(run('x1.3 roster, golden ×1.3 context', () => goldenCtx(1.3), calibrationRoster));
  runs.push(run('x1.3 roster, golden ×2 context', () => goldenCtx(2), calibrationRoster));
  runs.push(
    run('x1.3 roster, grid 0..4 step 0.01', () => goldenCtx(), calibrationRoster, {
      grid: { min: 0, max: 4, step: 0.01 },
      bootstrap: 0,
    }),
  );
  runs.push(
    run('x1.3 roster, seeded split t15-holdout', () => goldenCtx(), calibrationRoster, {
      split: undefined,
    }),
  );
  for (const seed of ['t15-alt-1', 't15-alt-2', 't15-alt-3', 't15-alt-4', 't15-alt-5']) {
    runs.push(
      run(`x1.3 roster, seeded split ${seed}`, () => goldenCtx(), calibrationRoster, {
        split: undefined,
        splitSeed: seed,
        bootstrap: 0,
      }),
    );
    runs.push(
      run(`base roster, seeded split ${seed}`, () => goldenCtx(), roster, {
        split: undefined,
        splitSeed: seed,
        bootstrap: 0,
      }),
    );
  }
}
for (const r of runs as ReturnType<typeof run>[]) {
  console.log(
    `${r.name} | ${r.status}/${r.statStatus} | used ${r.used} split ${r.split.join('/')} | ` +
      `holdout-argmin ${r.selected?.multiplier ?? '-'} (${r.selected?.holdoutMae.toFixed(3) ?? '-'}) ` +
      `trainCV-argmin ${r.trainCvSelected?.multiplier ?? '-'} holdoutMaeOfTrainCvSel ${r.holdoutMaeOfTrainCvSelection?.toFixed(3) ?? '-'} current ${r.currentHoldoutMae?.toFixed(3) ?? '-'} ` +
      `noInh ${r.withoutInheritance?.toFixed(3) ?? '-'} | ident ${r.identification ? `${r.identification.status} ${r.identification.basis} rank ${r.identification.basisRank}/${r.identification.trainRows} minRes ${r.identification.minRelativeResidual.toExponential(2)}` : '-'} | boot ${r.bootstrap ? `${r.bootstrap.p05}/${r.bootstrap.p50}/${r.bootstrap.p95}` : `- (${r.uncertainty})`} | ` +
      `apt ${r.aptitude.status} full ${r.aptitude.fullLikelihood} ll ${r.aptitude.logLik?.toFixed(2) ?? 'null'} cond ${r.aptitude.conditionalLogLik?.toFixed(2) ?? 'null'}/${r.aptitude.possibleCells} imp ${r.aptitude.impossible} (below ${r.aptitude.belowBase} above ${r.aptitude.aboveMax} gap ${r.aptitude.unreachable}) invalid ${r.aptitude.invalidObserved} | ` +
      `skills ${r.skills.map((s) => `E${s.expected.toFixed(1)}/O${s.observed} z${s.z?.toFixed(2)} ${s.status}`).join(' ')} | ` +
      `ms total ${r.runtime.totalMs.toFixed(0)} grid ${r.runtime.gridMs.toFixed(0)} (${r.runtime.gridPoints} pts) fits ${r.runtime.candidateFitMs.toFixed(0)} (${r.runtime.candidateFits}) boot ${r.runtime.bootstrapMs.toFixed(0)}`,
  );
}
console.log(JSON.stringify(hashes, null, 1));
if (outAt >= 0) writeFileSync(args[outAt + 1]!, JSON.stringify(out, null, 1) + '\n');
