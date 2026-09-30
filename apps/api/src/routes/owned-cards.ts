import { Hono } from 'hono';
import { OWNED_CARDS_SYNC_RULES, OwnedCardsSync } from '@uma/schema';
import { validationError } from '../problem.ts';
import { nowIso, parseBody, type AppEnv } from '../http.ts';

export const ownedCards = new Hono<AppEnv>();

interface OwnedRow {
  card_id: string;
  lb: number;
  level: number;
  confidence: number;
  synced_at: string;
}

ownedCards.get('/owned-cards', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM owned_cards ORDER BY card_id',
  ).all<OwnedRow>();
  return c.json(
    results.map((r) => ({
      cardId: r.card_id,
      lb: r.lb,
      level: r.level,
      confidence: r.confidence,
      syncedAt: r.synced_at,
    })),
  );
});

// 01 §4: replaces the table atomically (one D1 batch); rejects a count mismatch unless ?partial=1.
ownedCards.put('/owned-cards', async (c) => {
  const sync = await parseBody(c, OwnedCardsSync);
  const partial = c.req.query('partial') === '1';
  const heldRule = OWNED_CARDS_SYNC_RULES[1];
  if (!partial && sync.cards.length !== sync.heldCount) {
    throw validationError(
      [{ path: heldRule.path, message: heldRule.message }],
      `cards.length (${sync.cards.length}) != heldCount (${sync.heldCount})`,
    );
  }

  const master = await c.var.deps.master(sync.masterVersion, c.env);
  if (!master) {
    throw validationError(
      [{ path: '/masterVersion', message: `unknown master data version "${sync.masterVersion}"` }],
      'Unknown master data version',
    );
  }
  const known = new Set(master.cards);
  const unknown = sync.cards.flatMap((card, i) =>
    known.has(card.cardId)
      ? []
      : [
          {
            path: `/cards/${i}/cardId`,
            kind: 'cards',
            id: card.cardId,
            message: `unknown cards ID "${card.cardId}" in master data ${sync.masterVersion}`,
          },
        ],
  );
  if (unknown.length > 0) throw validationError(unknown, 'Unknown master-data IDs');

  const db = c.env.DB;
  const now = nowIso(c);
  const stmts = [db.prepare('DELETE FROM owned_cards')];
  if (sync.cards.length > 0) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO owned_cards (card_id, lb, level, confidence, synced_at)
           SELECT json_extract(value, '$.c'), json_extract(value, '$.l'), json_extract(value, '$.v'),
                  json_extract(value, '$.f'), ?1 FROM json_each(?2)`,
        )
        .bind(
          now,
          JSON.stringify(
            sync.cards.map((k) => ({ c: k.cardId, l: k.lb, v: k.level, f: k.confidence })),
          ),
        ),
    );
  }
  await db.batch(stmts);
  return c.json({ count: sync.cards.length, partial, syncedAt: now });
});
