import { beforeEach, expect, it } from 'vitest';
import { makeCapture, makeHarness, problem, resetDb } from './helpers/harness.ts';

beforeEach(resetDb);

it('requires deck and parents in slot order so index-based review paths stay stable', async () => {
  const h = makeHarness();
  const deck = await makeCapture((c) => c.veteran.deck.reverse());
  const deckProblem = await problem(await h.call('POST', '/veterans', deck), 422);
  expect(deckProblem.errors).toContainEqual(
    expect.objectContaining({ path: '/veteran/deck/0/slot' }),
  );
  const parents = await makeCapture((c) => c.veteran.parents.reverse());
  const parentProblem = await problem(await h.call('POST', '/veterans', parents), 422);
  expect(parentProblem.errors).toContainEqual(
    expect.objectContaining({ path: '/veteran/parents/0/slot' }),
  );
});
