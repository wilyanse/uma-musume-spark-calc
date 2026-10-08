/**
 * T15b: the last calibration report of THIS tab/UI session (61). Kept in memory only, keyed by the
 * app's engine client (one per app instance), so it survives route changes but never reaches
 * storage, the API, the model snapshot or the query caches for model/roster. Dismiss clears it.
 */
import { useSyncExternalStore } from 'react';
import type { CalibrationOutput } from '../workers/engine.api.ts';
import type { CalibrationProvenance } from '../lib/calibration.ts';

export interface SessionCalibration {
  output: CalibrationOutput;
  provenance: CalibrationProvenance;
}

interface Slot {
  value: SessionCalibration | null;
  listeners: Set<() => void>;
}
const slots = new WeakMap<object, Slot>();
const slotOf = (owner: object): Slot => {
  let s = slots.get(owner);
  if (!s) {
    s = { value: null, listeners: new Set() };
    slots.set(owner, s);
  }
  return s;
};

export function setSessionCalibration(owner: object, value: SessionCalibration | null): void {
  const s = slotOf(owner);
  s.value = value;
  for (const l of s.listeners) l();
}

export function useSessionCalibration(owner: object): SessionCalibration | null {
  const s = slotOf(owner);
  return useSyncExternalStore(
    (l) => {
      s.listeners.add(l);
      return () => void s.listeners.delete(l);
    },
    () => s.value,
  );
}
