/**
 * S07 calibration diagnostics helpers (T15b, 61). Pure: no engine runtime import (type-only), no
 * storage, no clock.
 *
 * - `fmtNum`: a null / non-finite metric is "unavailable", never 0 and never `toFixed(null)`.
 * - `selectionView`: the stats SELECTION authority is `stats.status` (+ its reasons). The raw
 *   `stats.identification.status` is a full-train rank diagnostic that can read 'identified'
 *   while mixed-stat / fold gating blocks selection (T15 r4 S1), so it is only ever shown as a
 *   numeric diagnostic, with the conflict flagged.
 * - `provenanceOf` / `staleReasons`: what a calibration run was computed from (context kind,
 *   master/rules versions, roster ETag + content identity), so an old report is never shown as
 *   current and a late reply for older inputs is refused.
 */
import type { RosterVeteran } from '@uma/schema';
import type { CalibrationReport } from '@uma/engine';
import type { ContextKind } from '../workers/engine.api.ts';
import { digestOf } from './digest.ts';

export const UNAVAILABLE = 'unavailable';

export function fmtNum(x: number | null | undefined, digits = 2): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return UNAVAILABLE;
  const s = Math.abs(x).toFixed(digits);
  return x < 0 && Number(s) !== 0 ? `−${s}` : s;
}

export interface SelectionView {
  /** A multiplier was selected (status suggested or boundary). */
  made: boolean;
  /** Selected AND suggested (status 'suggested'). */
  suggested: boolean;
  status: CalibrationReport['stats']['status'];
  /** Why no selection was made (engine text), empty when made. */
  reasons: string[];
  /** Raw rank diagnostic says 'identified'. */
  rawIdentified: boolean;
  /** The raw diagnostic says identified but selection is blocked: show both, never one alone. */
  gateConflict: boolean;
}

export function selectionView(stats: CalibrationReport['stats']): SelectionView {
  const made = (stats.status === 'suggested' || stats.status === 'boundary') && stats.selected !== null;
  const reasons =
    stats.status === 'nonidentifiable'
      ? [...(stats.nonidentifiable?.reasons ?? [])]
      : stats.status === 'insufficient-data'
        ? stats.insufficient ? [stats.insufficient] : []
        : [];
  const rawIdentified = stats.identification?.status === 'identified';
  return { made, suggested: made && stats.status === 'suggested', status: stats.status, reasons, rawIdentified, gateConflict: rawIdentified && !made };
}

/**
 * Roster content identity: row count + SHA-256 of the canonical roster JSON (T15c: model reuse is
 * authorised against it, so a collision-resistant digest replaces T15b's 32-bit FNV hash).
 */
const rosterIds = new WeakMap<readonly RosterVeteran[], string>();
export function rosterIdentity(roster: readonly RosterVeteran[]): string {
  let id = rosterIds.get(roster);
  if (!id) {
    id = `${roster.length}:${digestOf(roster)}`;
    rosterIds.set(roster, id);
  }
  return id;
}

export interface CalibrationProvenance {
  contextKind: ContextKind;
  /** T15c: effective context identity (rules values, overrides, master, synthetic inputs). */
  contextFingerprint: string;
  masterVersion: string;
  rulesVersion: string;
  rosterEtag: string | null;
  rosterIdentity: string;
  rosterRows: number;
}

export function provenanceOf(
  ctx: { kind: ContextKind; masterVersion: string; rulesVersion: string; fingerprint: string },
  loadedMasterVersion: string,
  roster: { etag: string | null; roster: readonly RosterVeteran[] },
): CalibrationProvenance {
  return {
    contextKind: ctx.kind,
    contextFingerprint: ctx.fingerprint,
    // The loaded master wins: a context still configured for an older master is itself stale.
    masterVersion: loadedMasterVersion === ctx.masterVersion ? ctx.masterVersion : loadedMasterVersion,
    rulesVersion: ctx.rulesVersion,
    rosterEtag: roster.etag,
    rosterIdentity: rosterIdentity(roster.roster),
    rosterRows: roster.roster.length,
  };
}

/** Human-readable reasons the `run` provenance differs from `now` (empty = current). */
export function staleReasons(run: CalibrationProvenance, now: CalibrationProvenance): string[] {
  const out: string[] = [];
  if (run.rosterEtag !== now.rosterEtag || run.rosterIdentity !== now.rosterIdentity) out.push('roster changed');
  if (run.masterVersion !== now.masterVersion) out.push('master data changed');
  if (run.rulesVersion !== now.rulesVersion || run.contextFingerprint !== now.contextFingerprint) out.push('rules changed');
  if (run.contextKind !== now.contextKind) out.push('engine context changed');
  return out;
}

export const provenanceKey = (p: CalibrationProvenance) =>
  [p.contextKind, p.contextFingerprint, p.masterVersion, p.rulesVersion, p.rosterEtag ?? '', p.rosterIdentity].join('|');
