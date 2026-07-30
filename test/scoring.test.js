import { test } from 'node:test';
import assert from 'node:assert/strict';
import { availabilityFactor, baseExpectation, scorePlayers, topByPosition } from '../src/scoring.js';
import { makeBootstrap, makeFixtures, makeElement } from './helpers.js';

test('availabilityFactor gates injured and doubtful players', () => {
  assert.equal(availabilityFactor(makeElement({ status: 'a' })), 1);
  assert.equal(availabilityFactor(makeElement({ status: 'i' })), 0);
  assert.equal(availabilityFactor(makeElement({ status: 'd', chance_of_playing_next_round: 25 })), 0.25);
});

test('baseExpectation blends available signals and ignores zeros', () => {
  // Pre-season: form 0, so ep_next and ppg carry it — result should be positive and finite.
  const base = baseExpectation(makeElement({ ep_next: '5.0', form: '0.0', points_per_game: '4.0' }));
  assert.ok(base > 0 && base <= 5.1);
  // A player with no signals at all scores 0.
  assert.equal(baseExpectation(makeElement({ ep_next: '0.0', form: '0.0', points_per_game: '0.0' })), 0);
});

test('scorePlayers projects more points for a double gameweek', () => {
  const boot = makeBootstrap([
    makeElement({ id: 1, team: 1, ep_next: '5.0' }), // team 1 has a DGW in GW1
    makeElement({ id: 2, team: 2, ep_next: '5.0' }), // team 2 single fixture
  ]);
  const scored = scorePlayers(boot, makeFixtures(), 1);
  const p1 = scored.find((p) => p.id === 1);
  const p2 = scored.find((p) => p.id === 2);
  assert.ok(p1.projNext > p2.projNext, 'double-gameweek player should out-project the single');
});

test('topByPosition excludes owned and unavailable players and respects price cap', () => {
  const boot = makeBootstrap([
    makeElement({ id: 1, element_type: 3, now_cost: 60, ep_next: '6.0' }),
    makeElement({ id: 2, element_type: 3, now_cost: 120, ep_next: '9.0' }), // too expensive
    makeElement({ id: 3, element_type: 3, now_cost: 55, ep_next: '5.0', status: 'i' }), // injured
    makeElement({ id: 4, element_type: 3, now_cost: 58, ep_next: '5.5' }),
  ]);
  const scored = scorePlayers(boot, makeFixtures(), 1);
  const top = topByPosition(scored, 3, { maxPrice: 8.0, excludeIds: new Set([4]), limit: 5 });
  const ids = top.map((p) => p.id);
  assert.ok(ids.includes(1));
  assert.ok(!ids.includes(2), 'over price cap');
  assert.ok(!ids.includes(3), 'injured');
  assert.ok(!ids.includes(4), 'excluded (owned)');
});
