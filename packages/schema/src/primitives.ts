import { z } from 'zod';

const kebab = '[a-z0-9]+(?:-[a-z0-9]+)*';

/** Master-data ID of a given kind, e.g. `character:mejiro-mcqueen` (01 §1). */
const masterId = (kind: string) =>
  z.string().regex(new RegExp(`^${kind}:${kebab}$`), `expected a "${kind}:<slug>" master-data ID`);

export const CharacterId = masterId('character');
export const OutfitId = masterId('outfit');
export const SkillId = masterId('skill');
export const SparkId = masterId('spark');
export const CardId = masterId('card');
export const ScenarioId = masterId('scenario');
/** Any master-data ID (used where the kind varies, e.g. vocab entries, spark targets). */
export const AnyMasterId = z
  .string()
  .regex(new RegExp(`^[a-z]+:${kebab}$`), 'expected a "<kind>:<slug>" master-data ID');

/** User-data IDs are ULIDs (01 §1). */
export const Ulid = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'expected a ULID');

/** ISO-8601 UTC timestamp (01 §1). */
export const IsoUtc = z.iso.datetime();

/** Calendar date `YYYY-MM-DD` (01 §1). */
export const DateOnly = z.iso.date();

export const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, 'expected lowercase sha256 hex');

/** dHash hex string of an icon (01 §11). */
export const DHashHex = z.string().regex(/^[0-9a-f]+$/, 'expected lowercase hex');

export const Confidence = z.number().min(0).max(1);
export const NonEmpty = z.string().min(1);
