/** S04 Support cards (F03) + deck builder (5 owned + 1 Friend). */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import type { CardType } from '@uma/schema';
import { Page } from '../components/Layout.tsx';
import { Banner, Empty, ErrorBanner, LbDiamonds, Loading, TypeChip } from '../components/atoms.tsx';
import { useMaster, useOwnedCards } from '../app/queries.ts';
import { useServices } from '../app/services.ts';
import { errorText } from '../api/errors.ts';
import type { OwnedCardRow } from '../api/types.ts';
import type { MasterData } from '../master/load.ts';
import { dateTime } from '../lib/format.ts';
import {
  addOwned,
  duplicateCards,
  loadDeck,
  missing,
  removeSlot,
  saveDeck,
  setFriend,
  type DeckDraft,
} from '../lib/deck.ts';

/**
 * Borrowed Friend defaults and the level bound come from the approved S04 design
 * (docs/design/screens/S04-cards.html: LB4 selected, `<input min=1 max=50 value=50>`). The 01 §3
 * `DeckSlot.level` contract has no upper bound and master data has no per-card level cap, so this
 * is a UI bound, not a game fact.
 */
export const FRIEND_DEFAULT = { lb: 4, level: 50 } as const;
export const FRIEND_LEVEL_MAX = 50;

function FriendLevel({ level, onChange }: { level: number; onChange: (n: number) => void }) {
  const [raw, setRaw] = useState(String(level));
  const t = raw.trim();
  const n = Number(t);
  const ok = /^\d+$/.test(t) && n >= 1 && n <= FRIEND_LEVEL_MAX;
  return (
    <span className="grid" style={{ gap: 2 }}>
      <label className="field">
        <span className="sr">Friend level</span>
        <input
          className="input w-sm"
          type="number"
          inputMode="numeric"
          min={1}
          max={FRIEND_LEVEL_MAX}
          value={raw}
          aria-invalid={ok ? undefined : true}
          onChange={(e) => {
            setRaw(e.target.value);
            const v = e.target.value.trim();
            const x = Number(v);
            if (/^\d+$/.test(v) && x >= 1 && x <= FRIEND_LEVEL_MAX) onChange(x);
          }}
        />
      </label>
      {!ok && (
        <small className="hint" role="status">
          Enter a level from 1 to {FRIEND_LEVEL_MAX}.
        </small>
      )}
    </span>
  );
}

const TYPES: CardType[] = ['speed', 'stamina', 'power', 'guts', 'wit', 'friend', 'group'];

/**
 * Sync line. `GET /owned-cards` returns rows with a per-row `syncedAt` and no `heldCount` (Q-71),
 * so "Held n / 255" can't be shown truthfully: the stored row count is shown instead, labelled.
 */
export function syncLine(rows: readonly OwnedCardRow[]): string {
  if (rows.length === 0) return '';
  const last = rows.reduce((a, r) => (r.syncedAt > a ? r.syncedAt : a), rows[0]!.syncedAt);
  return `Last sync ${dateTime(last)} · ${rows.length} cards stored · held count not reported`;
}

export function CardsScreen() {
  const owned = useOwnedCards();
  const master = useMaster();
  const { store, source } = useServices();
  const navigate = useNavigate();
  const [deck, setDeckState] = useState<DeckDraft>(() => loadDeck(store, source.kind));
  const [full, setFull] = useState(false);
  const [type, setType] = useState<CardType | ''>('');
  const [lb, setLb] = useState<'' | 'max' | 'rest'>('');
  const [rarity, setRarity] = useState('');
  const [search, setSearch] = useState('');
  const [friendQuery, setFriendQuery] = useState('');
  const setDeck = (d: DeckDraft) => {
    setDeckState(d);
    saveDeck(store, source.kind, d);
    setFull(false);
  };
  const m = master.data;
  const rows = owned.data;
  const filtered = useMemo(() => {
    if (!rows || !m) return [];
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const c = m.cards.get(r.cardId);
      return (
        (!type || c?.type === type) &&
        (!rarity || c?.rarity === rarity) &&
        (!lb || (lb === 'max' ? r.lb === 4 : r.lb < 4)) &&
        (!q || `${c?.name ?? ''} ${c?.title ?? ''} ${r.cardId}`.toLowerCase().includes(q))
      );
    });
  }, [rows, m, type, rarity, lb, search]);

  const actions = rows && rows.length > 0 ? <span className="hint">{syncLine(rows)}</span> : null;

  let grid;
  if (owned.isError) grid = <ErrorBanner text={<>Couldn't load your cards. {errorText(owned.error)}</>} onRetry={() => void owned.refetch()} />;
  else if (!rows || !m) grid = <Loading label="Loading cards…" />;
  else if (rows.length === 0)
    grid = (
      <Empty>
        <p>No cards synced yet. Run the support-card sync from the capture agent.</p>
      </Empty>
    );
  else
    grid = (
      <>
        <form className="filters" aria-label="Card filters" onSubmit={(e) => e.preventDefault()}>
          <label className="field">
            <span>Type</span>
            <select className="input" value={type} onChange={(e) => setType(e.target.value as CardType | '')}>
              <option value="">All types</option>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t[0]!.toUpperCase() + t.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Limit break</span>
            <select className="input" value={lb} onChange={(e) => setLb(e.target.value as '' | 'max' | 'rest')}>
              <option value="">Any</option>
              <option value="max">LB4 (max)</option>
              <option value="rest">LB0–3</option>
            </select>
          </label>
          <label className="field">
            <span>Rarity</span>
            <select className="input" value={rarity} onChange={(e) => setRarity(e.target.value)}>
              <option value="">All</option>
              <option>SSR</option>
              <option>SR</option>
              <option>R</option>
            </select>
          </label>
          <label className="field">
            <span>Search</span>
            <input className="input" placeholder="Card name" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
        </form>
        <div className="pager" style={{ padding: '0 0 6px' }}>
          <span>
            Showing {filtered.length} of {rows.length} owned cards
          </span>
        </div>
        {filtered.length === 0 ? (
          <Empty>No cards match these filters.</Empty>
        ) : (
          <div className="cardgrid">
            {filtered.map((r) => (
              <OwnedTile
                key={r.cardId}
                r={r}
                m={m}
                inDeck={deck.slice(0, 5).some((s) => s?.cardId === r.cardId)}
                onAdd={() => {
                  const next = addOwned(deck, r);
                  if (next) setDeck(next);
                  else setFull(true);
                }}
              />
            ))}
          </div>
        )}
      </>
    );

  return (
    <Page title="Support cards" actions={actions}>
      <div className="split wide-r">
        <div>{grid}</div>
        {m && (
          <DeckBuilder
            deck={deck}
            m={m}
            full={full}
            friendQuery={friendQuery}
            setFriendQuery={setFriendQuery}
            setDeck={setDeck}
            onUse={() => void navigate('/planner')}
          />
        )}
      </div>
    </Page>
  );
}

function OwnedTile({ r, m, inDeck, onAdd }: { r: OwnedCardRow; m: MasterData; inDeck: boolean; onAdd: () => void }) {
  const c = m.cards.get(r.cardId);
  return (
    <div className={`cardtile${inDeck ? ' sel' : ''}`}>
      <div className="art">
        <span className="rar">{c?.rarity ?? '?'}</span>art
      </div>
      <b>{c?.name ?? r.cardId}</b>
      {c && <small className="muted">{c.title}</small>}
      {c ? <TypeChip type={c.type} /> : <small className="muted">unknown card</small>}
      <LbDiamonds n={r.lb} />
      <span>Lv {r.level}</span>
      <button type="button" className="btn sm" disabled={inDeck} onClick={onAdd}>
        {inDeck ? 'In deck' : 'Add to deck'}
      </button>
    </div>
  );
}

function DeckBuilder({
  deck,
  m,
  full,
  friendQuery,
  setFriendQuery,
  setDeck,
  onUse,
}: {
  deck: DeckDraft;
  m: MasterData;
  full: boolean;
  friendQuery: string;
  setFriendQuery: (s: string) => void;
  setDeck: (d: DeckDraft) => void;
  onUse: () => void;
}) {
  const q = friendQuery.trim().toLowerCase();
  const matches = q.length < 2 ? [] : m.bundle.cards.filter((c) => `${c.name} ${c.title}`.toLowerCase().includes(q)).slice(0, 8);
  const friend = deck[5];
  const miss = missing(deck);
  const dups = duplicateCards(deck);
  return (
    <section className="panel" aria-labelledby="deck-t">
      <header>
        <span id="deck-t">Deck builder</span> <small className="muted">5 owned + 1 Friend</small>
      </header>
      <div className="body grid">
        {deck.slice(0, 5).map((s, i) => {
          const c = s ? m.cards.get(s.cardId) : undefined;
          return (
            <div key={i} className="cardtile" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              {s ? (
                <>
                  <span>
                    <small className="muted">Slot {i + 1}</small>
                    <br />
                    <b>{c?.name ?? s.cardId}</b> {c && <TypeChip type={c.type} />}
                  </span>
                  <span>
                    <LbDiamonds n={s.lb} />
                    <br />
                    <small>Lv {s.level}</small>
                  </span>
                  <button type="button" className="btn sm" aria-label={`Remove slot ${i + 1}`} onClick={() => setDeck(removeSlot(deck, i))}>
                    ✕
                  </button>
                </>
              ) : (
                <span className="muted">
                  Slot {i + 1} · Empty slot
                </span>
              )}
            </div>
          );
        })}
        <div className="cardtile friend">
          <small className="muted">{friend && !friend.borrowed ? 'Slot 6 · owned (not borrowed)' : 'Slot 6 · Friend (borrowed)'}</small>
          {friend ? (
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span>
                <b>{m.cards.get(friend.cardId)?.name ?? friend.cardId}</b>{' '}
                {m.cards.get(friend.cardId) && <TypeChip type={m.cards.get(friend.cardId)!.type} />}
              </span>
              <label className="field">
                <span className="sr">Friend limit break</span>
                <select
                  className="input"
                  value={friend.lb}
                  onChange={(e) => setDeck(setFriend(deck, { ...friend, lb: Number(e.target.value) }))}
                >
                  {[0, 1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      LB{n}
                    </option>
                  ))}
                </select>
              </label>
              <FriendLevel key={friend.cardId} level={friend.level} onChange={(level) => setDeck(setFriend(deck, { ...friend, level }))} />
              <button type="button" className="btn sm" aria-label="Remove slot 6" onClick={() => setDeck(setFriend(deck, null))}>
                ✕
              </button>
            </div>
          ) : (
            <span className="muted">Empty slot</span>
          )}
          {friend?.borrowed && (
            <small className="hint">
              Defaults LB{FRIEND_DEFAULT.lb} · Lv{FRIEND_DEFAULT.level} — edit to match the friend's card.
            </small>
          )}
        </div>
        <label className="field">
          <span>Friend card (any card in the game)</span>
          <input className="input" placeholder="Search all cards…" value={friendQuery} onChange={(e) => setFriendQuery(e.target.value)} />
        </label>
        {matches.length > 0 && (
          <div role="listbox" aria-label="All cards" className="grid" style={{ gap: 2 }}>
            {matches.map((c) => (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={friend?.cardId === c.id}
                className="cand"
                onClick={() => {
                  // LB/level of a borrowed card are chosen by the user; the labelled defaults are editable.
                  setDeck(setFriend(deck, { cardId: c.id, lb: friend?.lb ?? FRIEND_DEFAULT.lb, level: friend?.level ?? FRIEND_DEFAULT.level }));
                  setFriendQuery('');
                }}
              >
                <span>
                  <b>{c.name}</b> <span className="muted">· {c.title}</span>
                </span>
                <TypeChip type={c.type} />
              </button>
            ))}
          </div>
        )}
        {full && <Banner kind="warn">The deck already has 5 owned cards. Remove one first.</Banner>}
        {miss > 0 && <p className="hint">Choose {miss} more card(s) to complete the deck.</p>}
        {dups.length > 0 && (
          <Banner kind="warn">A card can be in the deck only once: {dups.map((d) => m.cards.get(d)?.name ?? d).join(', ')}.</Banner>
        )}
        <div className="row">
          <button type="button" className="btn primary" disabled={miss > 0 || dups.length > 0} onClick={onUse}>
            Use in planner
          </button>
          <button type="button" className="btn" onClick={() => setDeck([null, null, null, null, null, null])}>
            Clear
          </button>
        </div>
      </div>
    </section>
  );
}
