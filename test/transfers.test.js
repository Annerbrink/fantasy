import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scorePlayers } from '../src/scoring.js';
import { suggestTransfers, watchlist } from '../src/transfers.js';
import { makeBootstrap, makeFixtures, makeElement } from './helpers.js';

function setup() {
  const boot = makeBootstrap([
    makeElement({ id: 1, element_type: 3, now_cost: 60, ep_next: '2.0', points_per_game: '2.0' }), // weak owned
    makeElement({ id: 2, element_type: 3, now_cost: 65, ep_next: '7.0', points_per_game: '7.0' }), // strong upgrade
    makeElement({ id: 3, element_type: 4, now_cost: 80, ep_next: '5.0', points_per_game: '5.0' }), // owned FWD
  ]);
  const scored = scorePlayers(boot, makeFixtures(), 1);
  return { scored };
}

test('suggestTransfers recommends upgrading a weak player within budget', () => {
  const { scored } = setup();
  const squad = {
    bank: 1.0,
    freeTransfers: 1,
    players: [
      { id: 1, sellingPrice: 6.0 },
      { id: 3, sellingPrice: 8.0 },
    ],
  };
  const out = suggestTransfers(scored, squad);
  assert.ok(out.single.length > 0, 'should propose at least one move');
  const best = out.single[0];
  assert.equal(best.out.id, 1, 'weakest player is sold');
  assert.equal(best.in.id, 2, 'best affordable upgrade is bought');
  assert.ok(best.grossGain > 0);
  assert.equal(best.hit, 0, 'first move is free');
});

test('suggestTransfers applies a hit cost beyond free transfers', () => {
  const { scored } = setup();
  // A squad where two upgrades exist but only 1 free transfer -> second move takes a -4.
  const boot2 = makeBootstrap([
    makeElement({ id: 1, element_type: 3, now_cost: 60, ep_next: '2.0' }),
    makeElement({ id: 2, element_type: 3, now_cost: 62, ep_next: '7.0' }),
    makeElement({ id: 3, element_type: 4, now_cost: 60, ep_next: '2.0' }),
    makeElement({ id: 4, element_type: 4, now_cost: 62, ep_next: '7.0' }),
  ]);
  const scored2 = scorePlayers(boot2, makeFixtures(), 1);
  const squad = {
    bank: 2.0,
    freeTransfers: 1,
    players: [
      { id: 1, sellingPrice: 6.0 },
      { id: 3, sellingPrice: 6.0 },
    ],
  };
  const out = suggestTransfers(scored2, squad);
  assert.ok(out.single.length >= 2);
  assert.equal(out.single[0].hit, 0);
  assert.equal(out.single[1].hit, 4, 'second move incurs a -4 hit');
});

test('watchlist returns best players per position', () => {
  const { scored } = setup();
  const wl = watchlist(scored);
  assert.ok(Array.isArray(wl.MID) && wl.MID.length > 0);
  assert.equal(wl.MID[0].id, 2, 'strongest MID leads the watchlist');
});
