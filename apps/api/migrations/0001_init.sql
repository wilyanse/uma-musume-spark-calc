-- 01 §7 user-data schema. All tables STRICT.
CREATE TABLE veterans (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL UNIQUE,
  character_id TEXT NOT NULL,
  outfit_id TEXT NOT NULL,
  rank TEXT,
  rating INTEGER,
  epithet TEXT,
  train_mode TEXT NOT NULL,
  mode_source TEXT NOT NULL,
  spd INTEGER, sta INTEGER, pow INTEGER, gut INTEGER, wit INTEGER,
  apt_turf TEXT, apt_dirt TEXT, apt_sprint TEXT, apt_mile TEXT, apt_medium TEXT, apt_long TEXT,
  apt_front TEXT, apt_pace TEXT, apt_late TEXT, apt_end TEXT,
  scenario_id TEXT NOT NULL,
  races INTEGER, wins INTEGER, fans INTEGER, date_acquired TEXT,
  master_version TEXT NOT NULL,
  capture_id TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  min_confidence REAL NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE veteran_skills (
  veteran_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  level INTEGER,
  PRIMARY KEY (veteran_id, skill_id)
) STRICT;

CREATE TABLE veteran_sparks (
  veteran_id TEXT NOT NULL,
  owner TEXT NOT NULL,
  spark_id TEXT NOT NULL,
  type TEXT NOT NULL,
  stars INTEGER NOT NULL,
  PRIMARY KEY (veteran_id, owner, spark_id)
) STRICT;

CREATE TABLE veteran_deck (
  veteran_id TEXT NOT NULL,
  slot INTEGER NOT NULL,
  card_id TEXT NOT NULL,
  lb INTEGER NOT NULL,
  level INTEGER NOT NULL,
  borrowed INTEGER NOT NULL,
  PRIMARY KEY (veteran_id, slot)
) STRICT;

CREATE TABLE veteran_parents (
  veteran_id TEXT NOT NULL,
  slot INTEGER NOT NULL,
  character_id TEXT NOT NULL,
  outfit_id TEXT,
  is_guest INTEGER NOT NULL,
  guest_trainer TEXT,
  matched_veteran_id TEXT,
  PRIMARY KEY (veteran_id, slot)
) STRICT;

CREATE TABLE capture_fields (
  veteran_id TEXT NOT NULL,
  path TEXT NOT NULL,
  raw_text TEXT,
  value_json TEXT,
  confidence REAL NOT NULL,
  status TEXT NOT NULL,
  candidates_json TEXT NOT NULL,
  crop_key TEXT,
  PRIMARY KEY (veteran_id, path)
) STRICT;

CREATE TABLE review_items (
  id TEXT PRIMARY KEY,
  veteran_id TEXT NOT NULL,
  path TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolved_value_json TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
) STRICT;

CREATE TABLE owned_cards (
  card_id TEXT PRIMARY KEY,
  lb INTEGER NOT NULL,
  level INTEGER NOT NULL,
  confidence REAL NOT NULL,
  synced_at TEXT NOT NULL
) STRICT;

CREATE TABLE cm_targets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  body_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE model_snapshots (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  master_version TEXT NOT NULL,
  trained_at TEXT NOT NULL,
  n_samples INTEGER NOT NULL,
  params_json TEXT NOT NULL
) STRICT;

CREATE INDEX idx_veterans_character ON veterans (character_id);
CREATE INDEX idx_veterans_mode_scenario ON veterans (train_mode, scenario_id);
CREATE INDEX idx_veteran_sparks_spark ON veteran_sparks (spark_id);
CREATE INDEX idx_review_items_status ON review_items (status);
-- Supporting indexes for lookups the API performs (parent matching, review joins, latest snapshot).
CREATE INDEX idx_veteran_parents_match ON veteran_parents (character_id, outfit_id);
CREATE INDEX idx_review_items_veteran ON review_items (veteran_id);
CREATE INDEX idx_model_snapshots_kind ON model_snapshots (kind, trained_at);

-- The roster ETag is derived from max(updated_at) + count (40 §4). Parent matching changes
-- `matched_veteran_id` (part of the roster payload) without touching the child's row, so bump the
-- child's updated_at to one ms past the current max whenever its match changes.
CREATE TRIGGER trg_parent_match_bumps_updated_at
AFTER UPDATE OF matched_veteran_id ON veteran_parents
WHEN OLD.matched_veteran_id IS NOT NEW.matched_veteran_id
BEGIN
  UPDATE veterans
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', (SELECT MAX(updated_at) FROM veterans), '+0.001 seconds')
  WHERE id = NEW.veteran_id;
END;
