-- Optimistic concurrency for read-modify-write paths (T04b; T04 review r2 S1).
-- A review resolve loads the veteran, edits it in JS, then writes it back in one D1 batch. The
-- first statement of that batch inserts into this view; the trigger aborts the whole batch
-- (transaction) unless the veteran still has the `updated_at` that was loaded and, when given,
-- the review item is still open on that veteran. Every write to `veterans` moves `updated_at`
-- strictly forward (see src/db/veterans.ts `bumpUpdatedAt`), so a matching value means "nothing
-- changed since the read". Nothing is ever stored through the view.
CREATE VIEW veteran_write_guard AS
  SELECT id AS veteran_id, updated_at, NULL AS review_item_id FROM veterans;

CREATE TRIGGER trg_veteran_write_guard INSTEAD OF INSERT ON veteran_write_guard
BEGIN
  SELECT RAISE(ABORT, 'stale_veteran_write')
  WHERE NOT EXISTS (SELECT 1 FROM veterans WHERE id = NEW.veteran_id AND updated_at = NEW.updated_at)
     OR (NEW.review_item_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM review_items
                         WHERE id = NEW.review_item_id AND veteran_id = NEW.veteran_id
                           AND status = 'open'));
END;

-- A review item whose index-based `/sparks/<n>…` target was removed by a `/sparks/<owner>`
-- correction (T04b review r1 S1). Its path is kept (the audit record of what was reviewed) but
-- that index now names another spark or nothing, so the item is no longer listed: joining it to
-- the field now at that path would attach another spark's field to it. Internal; not in the API.
ALTER TABLE review_items ADD COLUMN retired INTEGER NOT NULL DEFAULT 0 CHECK (retired IN (0, 1));
