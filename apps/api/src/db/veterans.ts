import {
  APT_KEYS,
  STAT_KEYS,
  type CaptureField,
  type RosterVeteran,
  type RosterVeteranDetail,
  type TrainMode,
  type Veteran,
} from '@uma/schema';

/** 01 §6. */
export function deriveTrainMode(epithet: string): TrainMode {
  return epithet.trim().toLowerCase() === 'independent learner' ? 'independent' : 'manual';
}

export interface VeteranMeta {
  id: string;
  fingerprint: string;
  masterVersion: string;
  captureId: string;
  capturedAt: string;
  minConfidence: number;
  trainMode: TrainMode;
  modeSource: 'epithet' | 'override';
  now: string;
}

const VETERAN_COLUMNS = [
  'id',
  'fingerprint',
  'character_id',
  'outfit_id',
  'rank',
  'rating',
  'epithet',
  'train_mode',
  'mode_source',
  'spd',
  'sta',
  'pow',
  'gut',
  'wit',
  ...APT_KEYS.map((k) => `apt_${k}`),
  'scenario_id',
  'races',
  'wins',
  'fans',
  'date_acquired',
  'master_version',
  'capture_id',
  'captured_at',
  'min_confidence',
  'created_at',
  'updated_at',
] as const;

const UPDATABLE = VETERAN_COLUMNS.filter((c) => c !== 'id' && c !== 'created_at');

/**
 * The `updated_at` a write to an existing row stores: `now`, or 1 ms after the stored value when
 * the clock hasn't moved past it. It is therefore strictly increasing per row (and always after
 * `created_at`), which is what the optimistic write guard of migration 0003 relies on: a resolve
 * that still sees the `updated_at` it loaded knows no other write landed in between (T04b).
 */
export const bumpUpdatedAt = (now: string, old = 'veterans.updated_at') =>
  `CASE WHEN ${now} > ${old} THEN ${now}
     ELSE strftime('%Y-%m-%dT%H:%M:%fZ', ${old}, '+0.001 seconds') END`;

/** SET list shared by the ingest upsert and the resolve update; `val(c)` is the new value of `c`. */
const setList = (val: (c: string) => string) =>
  UPDATABLE.map((c) =>
    c === 'train_mode'
      ? // `override` rows keep their train_mode (01 §6): later writes never overwrite an override.
        `train_mode = CASE WHEN veterans.mode_source = 'override' THEN veterans.train_mode ELSE ${val(c)} END`
      : c === 'mode_source'
        ? `mode_source = veterans.mode_source`
        : c === 'updated_at'
          ? `updated_at = ${bumpUpdatedAt(val(c))}`
          : `${c} = ${val(c)}`,
  ).join(', ');

/** Ingest: insert, or update the row with the same fingerprint. `created_at = updated_at` ⇔ inserted. */
const UPSERT_SQL = `INSERT INTO veterans (${VETERAN_COLUMNS.join(', ')}) VALUES (${VETERAN_COLUMNS.map(() => '?').join(', ')})
   ON CONFLICT(fingerprint) DO UPDATE SET ${setList((c) => `excluded.${c}`)}
   RETURNING id, created_at = updated_at AS created`;

/** Resolve: update the existing row by id; never inserts, so a deleted veteran stays deleted. */
const UPDATE_SQL = `UPDATE veterans SET ${setList((c) => `?${VETERAN_COLUMNS.indexOf(c as (typeof VETERAN_COLUMNS)[number]) + 1}`)}
   WHERE id = ?1`;

/**
 * First statement of a guarded read-modify-write batch (migration 0003): the whole D1 batch aborts
 * with `stale_veteran_write` unless veteran `id` still has the loaded `updatedAt` and, when given,
 * review item `reviewItemId` is still open on it.
 */
export function writeGuardStatement(
  db: D1Database,
  id: string,
  updatedAt: string,
  reviewItemId: string | null = null,
): D1PreparedStatement {
  return db
    .prepare(
      'INSERT INTO veteran_write_guard (veteran_id, updated_at, review_item_id) VALUES (?, ?, ?)',
    )
    .bind(id, updatedAt, reviewItemId);
}

/** True when a D1 error is the write guard refusing a stale batch. */
export const isStaleWrite = (e: unknown): boolean => String(e).includes('stale_veteran_write');

/** The persisted id of a veteran, resolved inside the transaction (never a JS-side guess; B1). */
export const ID_BY_FINGERPRINT = '(SELECT id FROM veterans WHERE fingerprint = ?1)';

const CHILD_TABLES = [
  'veteran_skills',
  'veteran_sparks',
  'veteran_deck',
  'veteran_parents',
] as const;

/** RETURNING row of the ingest upsert (statement 0 of `writeVeteranStatements` in upsert mode). */
export interface UpsertResult {
  id: string;
  created: number;
}

/**
 * Statements that (re)write one veteran and its child rows: write the `veterans` row, delete the
 * child rows, then one multi-row insert per table. Rows travel as one JSON parameter each and are
 * expanded with `json_each`, so a statement never exceeds D1's 100 bound parameters however many
 * rows it has. Insertion order is preserved in rowid: it is the only record of the capture's
 * array order, which review-item paths such as `/sparks/3/stars` index into.
 *
 * Statement 0 writes the `veterans` row. In `upsert` mode (ingest) its single RETURNING row is the
 * persisted id. In `update` mode (resolve) it updates the row `meta.id` only and never inserts;
 * callers put the write guard before it so the batch aborts if the row changed or vanished.
 * Child rows are keyed by `meta.fingerprint`, i.e. by the row that exists after statement 0.
 */
export function writeVeteranStatements(
  db: D1Database,
  v: Veteran,
  meta: VeteranMeta,
  mode: 'upsert' | 'update',
): D1PreparedStatement[] {
  const s = v.stats;
  const a = v.aptitudes;
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(mode === 'upsert' ? UPSERT_SQL : UPDATE_SQL)
      .bind(
        meta.id,
        meta.fingerprint,
        v.characterId,
        v.outfitId,
        v.rank,
        v.rating,
        v.epithet,
        meta.trainMode,
        meta.modeSource,
        ...STAT_KEYS.map((k) => s[k]),
        ...APT_KEYS.map((k) => a[k]),
        v.scenarioId,
        v.career.races,
        v.career.wins,
        v.career.fans,
        v.career.dateAcquired,
        meta.masterVersion,
        meta.captureId,
        meta.capturedAt,
        meta.minConfidence,
        meta.now,
        meta.now,
      ),
  ];
  for (const t of CHILD_TABLES) {
    stmts.push(
      db.prepare(`DELETE FROM ${t} WHERE veteran_id = ${ID_BY_FINGERPRINT}`).bind(meta.fingerprint),
    );
  }
  const insertMany = (sql: string, rows: unknown[]) => {
    if (rows.length > 0) stmts.push(db.prepare(sql).bind(meta.fingerprint, JSON.stringify(rows)));
  };
  insertMany(
    `INSERT INTO veteran_skills (veteran_id, skill_id, level)
     SELECT ${ID_BY_FINGERPRINT}, json_extract(value, '$.s'), json_extract(value, '$.l') FROM json_each(?2) ORDER BY key`,
    v.skills.map((k) => ({ s: k.skillId, l: k.level })),
  );
  insertMany(
    `INSERT INTO veteran_sparks (veteran_id, owner, spark_id, type, stars)
     SELECT ${ID_BY_FINGERPRINT}, json_extract(value, '$.o'), json_extract(value, '$.s'), json_extract(value, '$.t'),
            json_extract(value, '$.n') FROM json_each(?2) ORDER BY key`,
    v.sparks.map((k) => ({ o: k.owner, s: k.sparkId, t: k.type, n: k.stars })),
  );
  insertMany(
    `INSERT INTO veteran_deck (veteran_id, slot, card_id, lb, level, borrowed)
     SELECT ${ID_BY_FINGERPRINT}, json_extract(value, '$.n'), json_extract(value, '$.c'), json_extract(value, '$.l'),
            json_extract(value, '$.v'), json_extract(value, '$.b') FROM json_each(?2) ORDER BY key`,
    v.deck.map((d) => ({ n: d.slot, c: d.cardId, l: d.lb, v: d.level, b: d.borrowed ? 1 : 0 })),
  );
  insertMany(
    `INSERT INTO veteran_parents (veteran_id, slot, character_id, outfit_id, is_guest, guest_trainer)
     SELECT ${ID_BY_FINGERPRINT}, json_extract(value, '$.n'), json_extract(value, '$.c'), json_extract(value, '$.o'),
            json_extract(value, '$.g'), json_extract(value, '$.t') FROM json_each(?2) ORDER BY key`,
    v.parents.map((p) => ({
      n: p.slot,
      c: p.characterId,
      o: p.outfitId,
      g: p.isGuest ? 1 : 0,
      t: p.guestTrainer,
    })),
  );
  return stmts;
}

export function insertFieldsStatement(
  db: D1Database,
  fingerprint: string,
  fields: CaptureField[],
): D1PreparedStatement[] {
  if (fields.length === 0) return [];
  const rows = fields.map((f) => ({
    p: f.path,
    r: f.rawText,
    v: f.value === undefined ? null : JSON.stringify(f.value),
    c: f.confidence,
    s: f.status,
    x: JSON.stringify(f.candidates),
    k: f.cropKey,
  }));
  return [
    db
      .prepare(
        `INSERT INTO capture_fields (veteran_id, path, raw_text, value_json, confidence, status, candidates_json, crop_key)
         SELECT ${ID_BY_FINGERPRINT}, json_extract(value, '$.p'), json_extract(value, '$.r'), json_extract(value, '$.v'),
                json_extract(value, '$.c'), json_extract(value, '$.s'), json_extract(value, '$.x'),
                json_extract(value, '$.k') FROM json_each(?2) ORDER BY key`,
      )
      .bind(fingerprint, JSON.stringify(rows)),
  ];
}

/**
 * 40 §4 parent matching, one statement. A non-guest parent with a known outfit is matched to the
 * roster veteran having the same (characterId, outfitId) — provided exactly one such veteran
 * exists whose own (`self`) sparks contain every (sparkId, stars) shown for that parent on the
 * child's Inspiration tab. A parent with no sparks (unreadable tab) never matches.
 *
 * Recomputes the parents of `veteranId`, of every child currently matched to it, and of every
 * child whose parent shares either given (characterId, outfitId) pair, so it covers insert,
 * re-ingest, resolve and delete alike.
 */
export function matchParentsStatement(
  db: D1Database,
  veteran: { id: string } | { fingerprint: string },
  pairs: [string, string][],
): D1PreparedStatement {
  const p1 = pairs[0];
  if (!p1) throw new Error('matchParentsStatement: at least one pair is required');
  const p2 = pairs[1] ?? p1;
  // `?1` is either the id itself or the fingerprint the id is looked up by inside the batch.
  const [idExpr, ref] =
    'id' in veteran ? ['?1', veteran.id] : [ID_BY_FINGERPRINT, veteran.fingerprint];
  return db
    .prepare(
      `UPDATE veteran_parents SET matched_veteran_id = (
         SELECT CASE WHEN COUNT(*) = 1 THEN MIN(c.id) END
         FROM veterans c
         WHERE c.character_id = veteran_parents.character_id
           AND c.outfit_id = veteran_parents.outfit_id
           AND EXISTS (SELECT 1 FROM veteran_sparks ps
                       WHERE ps.veteran_id = veteran_parents.veteran_id
                         AND ps.owner = 'parent' || veteran_parents.slot)
           AND NOT EXISTS (
             SELECT 1 FROM veteran_sparks ps
             WHERE ps.veteran_id = veteran_parents.veteran_id
               AND ps.owner = 'parent' || veteran_parents.slot
               AND NOT EXISTS (SELECT 1 FROM veteran_sparks os
                               WHERE os.veteran_id = c.id AND os.owner = 'self'
                                 AND os.spark_id = ps.spark_id AND os.stars = ps.stars)))
       WHERE is_guest = 0 AND outfit_id IS NOT NULL
         AND (veteran_id = ${idExpr} OR matched_veteran_id = ${idExpr}
              OR (character_id = ?2 AND outfit_id = ?3) OR (character_id = ?4 AND outfit_id = ?5))`,
    )
    .bind(ref, p1[0], p1[1], p2[0], p2[1]);
}

// ---------------------------------------------------------------------------------------------
// Reads

interface VeteranRow {
  id: string;
  fingerprint: string;
  character_id: string;
  outfit_id: string;
  rank: string;
  rating: number;
  epithet: string;
  train_mode: TrainMode;
  mode_source: 'epithet' | 'override';
  scenario_id: string;
  races: number;
  wins: number;
  fans: number | null;
  date_acquired: string;
  master_version: string;
  captured_at: string;
  capture_id: string;
  min_confidence: number;
  /** Derived, not stored (T17): 1 when any current capture field is `low_confidence`. */
  has_low: number;
  updated_at: string;
  spd: number;
  sta: number;
  pow: number;
  gut: number;
  wit: number;
  [k: string]: unknown;
}
interface SkillRow {
  veteran_id: string;
  skill_id: string;
  level: number | null;
}
interface SparkRow {
  veteran_id: string;
  owner: 'self' | 'parent1' | 'parent2';
  spark_id: string;
  type: 'blue' | 'pink' | 'green' | 'white';
  stars: 1 | 2 | 3;
}
interface DeckRow {
  veteran_id: string;
  slot: number;
  card_id: string;
  lb: number;
  level: number;
  borrowed: number;
}
interface ParentRow {
  veteran_id: string;
  slot: 1 | 2;
  character_id: string;
  outfit_id: string | null;
  is_guest: number;
  guest_trainer: string | null;
  matched_veteran_id: string | null;
}
export interface FieldRow {
  veteran_id: string;
  path: string;
  raw_text: string | null;
  value_json: string | null;
  confidence: number;
  status: 'ok' | 'low_confidence' | 'corrected';
  candidates_json: string;
  crop_key: string | null;
}

export const fieldFromRow = (r: FieldRow): CaptureField => ({
  path: r.path,
  rawText: r.raw_text,
  value: r.value_json === null ? null : JSON.parse(r.value_json),
  confidence: r.confidence,
  status: r.status,
  candidates: JSON.parse(r.candidates_json),
  cropKey: r.crop_key,
});

const group = <T extends { veteran_id: string }>(rows: T[]): Map<string, T[]> => {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const list = m.get(r.veteran_id);
    if (list) list.push(r);
    else m.set(r.veteran_id, [r]);
  }
  return m;
};

interface Children {
  skills: Map<string, SkillRow[]>;
  sparks: Map<string, SparkRow[]>;
  deck: Map<string, DeckRow[]>;
  parents: Map<string, ParentRow[]>;
}

function assemble(r: VeteranRow, ch: Children): RosterVeteran {
  return {
    id: r.id,
    fingerprint: r.fingerprint,
    modeSource: r.mode_source,
    minConfidence: r.min_confidence,
    hasLowConfidence: r.has_low === 1,
    capturedAt: r.captured_at,
    characterId: r.character_id,
    outfitId: r.outfit_id,
    rank: r.rank,
    rating: r.rating,
    epithet: r.epithet,
    trainMode: r.train_mode,
    stats: { spd: r.spd, sta: r.sta, pow: r.pow, gut: r.gut, wit: r.wit },
    aptitudes: Object.fromEntries(
      APT_KEYS.map((k) => [k, r[`apt_${k}`]]),
    ) as RosterVeteran['aptitudes'],
    skills: (ch.skills.get(r.id) ?? []).map((s) => ({ skillId: s.skill_id, level: s.level })),
    sparks: (ch.sparks.get(r.id) ?? []).map((s) => ({
      owner: s.owner,
      sparkId: s.spark_id,
      type: s.type,
      stars: s.stars,
    })),
    deck: (ch.deck.get(r.id) ?? []).map((d) => ({
      slot: d.slot,
      cardId: d.card_id,
      lb: d.lb,
      level: d.level,
      borrowed: d.borrowed === 1,
    })),
    parents: (ch.parents.get(r.id) ?? []).map((p) => ({
      slot: p.slot,
      characterId: p.character_id,
      outfitId: p.outfit_id,
      isGuest: p.is_guest === 1,
      guestTrainer: p.guest_trainer,
      matchedVeteranId: p.matched_veteran_id,
    })),
    scenarioId: r.scenario_id,
    career: { races: r.races, wins: r.wins, fans: r.fans, dateAcquired: r.date_acquired },
  } as RosterVeteran;
}

/** Roster summary used for the ETag (40 §4): 1 query. */
export async function rosterStamp(
  db: D1Database,
): Promise<{ revision: number; maxUpdated: string | null; count: number }> {
  const row = await db
    .prepare(
      `SELECT (SELECT revision FROM roster_meta WHERE id = 1) AS revision,
              MAX(updated_at) AS max_updated, COUNT(*) AS n FROM veterans`,
    )
    .first<{ revision: number | null; max_updated: string | null; n: number }>();
  return { revision: row?.revision ?? 0, maxUpdated: row?.max_updated ?? null, count: row?.n ?? 0 };
}

/**
 * T17 / ADR-0003: `hasLowConfidence` is derived from the CURRENT capture fields inside the same
 * SELECT as the veteran row (no stored column, no migration, no extra query): true iff any field
 * still has status `low_confidence`. Review item status is deliberately ignored, so a dismissed
 * item whose field was never corrected keeps the flag; `corrected`/`ok` fields never set it,
 * whatever their raw score. Uses the capture_fields (veteran_id, path) primary-key prefix.
 */
const SELECT_VETERAN = `SELECT v.*, EXISTS (SELECT 1 FROM capture_fields f
    WHERE f.veteran_id = v.id AND f.status = 'low_confidence') AS has_low
  FROM veterans v`;

/** Whole roster in 5 queries (40 §4: ≤ 6 with the stamp), assembled in JS. */
export async function loadRoster(db: D1Database): Promise<RosterVeteran[]> {
  const [vets, skills, sparks, deck, parents] = await db.batch([
    db.prepare(`${SELECT_VETERAN} ORDER BY v.captured_at DESC, v.id`),
    db.prepare('SELECT * FROM veteran_skills ORDER BY rowid'),
    db.prepare('SELECT * FROM veteran_sparks ORDER BY rowid'),
    db.prepare('SELECT * FROM veteran_deck ORDER BY veteran_id, slot'),
    db.prepare('SELECT * FROM veteran_parents ORDER BY veteran_id, slot'),
  ]);
  const ch: Children = {
    skills: group((skills as D1Result<SkillRow>).results),
    sparks: group((sparks as D1Result<SparkRow>).results),
    deck: group((deck as D1Result<DeckRow>).results),
    parents: group((parents as D1Result<ParentRow>).results),
  };
  return (vets as D1Result<VeteranRow>).results.map((r) => assemble(r, ch));
}

/** Stored columns a read-modify-write needs besides the API shape; never sent to clients. */
export interface VeteranRowMeta {
  masterVersion: string;
  captureId: string;
  /** The optimistic-concurrency token (migration 0003). */
  updatedAt: string;
}

/** One veteran with its capture fields, or null. 6 queries in one batch (one snapshot). */
export async function loadVeteranDetail(
  db: D1Database,
  id: string,
): Promise<(RosterVeteranDetail & { internal: VeteranRowMeta }) | null> {
  const [vets, skills, sparks, deck, parents, fields] = await db.batch([
    db.prepare(`${SELECT_VETERAN} WHERE v.id = ?`).bind(id),
    db.prepare('SELECT * FROM veteran_skills WHERE veteran_id = ? ORDER BY rowid').bind(id),
    db.prepare('SELECT * FROM veteran_sparks WHERE veteran_id = ? ORDER BY rowid').bind(id),
    db.prepare('SELECT * FROM veteran_deck WHERE veteran_id = ? ORDER BY slot').bind(id),
    db.prepare('SELECT * FROM veteran_parents WHERE veteran_id = ? ORDER BY slot').bind(id),
    db.prepare('SELECT * FROM capture_fields WHERE veteran_id = ? ORDER BY rowid').bind(id),
  ]);
  const row = (vets as D1Result<VeteranRow>).results[0];
  if (!row) return null;
  const ch: Children = {
    skills: group((skills as D1Result<SkillRow>).results),
    sparks: group((sparks as D1Result<SparkRow>).results),
    deck: group((deck as D1Result<DeckRow>).results),
    parents: group((parents as D1Result<ParentRow>).results),
  };
  return {
    ...assemble(row, ch),
    fields: (fields as D1Result<FieldRow>).results.map(fieldFromRow),
    internal: {
      masterVersion: row.master_version,
      captureId: row.capture_id,
      updatedAt: row.updated_at,
    },
  };
}

/** The plain `veteran` object (01 §3) of a loaded roster veteran, for re-validation. */
export function toVeteran(r: RosterVeteran): Veteran {
  return {
    characterId: r.characterId,
    outfitId: r.outfitId,
    rank: r.rank,
    rating: r.rating,
    epithet: r.epithet,
    trainMode: r.trainMode,
    stats: r.stats,
    aptitudes: r.aptitudes,
    skills: r.skills,
    sparks: r.sparks,
    deck: r.deck,
    parents: r.parents.map(({ matchedVeteranId: _m, ...p }) => p),
    scenarioId: r.scenarioId,
    career: r.career,
  };
}
