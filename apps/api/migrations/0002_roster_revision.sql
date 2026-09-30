-- Roster ETag (40 §4): max(updated_at) + count alone can go stale, because writes that don't move
-- max(updated_at) (same-millisecond clock, parent-match changes) leave it unchanged. A monotonic
-- revision, bumped by triggers under every write that changes the roster payload, is hashed as well.
DROP TRIGGER trg_parent_match_bumps_updated_at;

CREATE TABLE roster_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL
) STRICT;
INSERT INTO roster_meta (id, revision) VALUES (1, 0);

CREATE TRIGGER trg_roster_rev_insert AFTER INSERT ON veterans
BEGIN UPDATE roster_meta SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER trg_roster_rev_update AFTER UPDATE ON veterans
BEGIN UPDATE roster_meta SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER trg_roster_rev_delete AFTER DELETE ON veterans
BEGIN UPDATE roster_meta SET revision = revision + 1 WHERE id = 1; END;

-- A parent-match change alters the child's `parents[].matchedVeteranId` without touching its row.
CREATE TRIGGER trg_roster_rev_match AFTER UPDATE OF matched_veteran_id ON veteran_parents
WHEN OLD.matched_veteran_id IS NOT NEW.matched_veteran_id
BEGIN UPDATE roster_meta SET revision = revision + 1 WHERE id = 1; END;
