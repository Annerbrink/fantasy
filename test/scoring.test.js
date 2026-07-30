import { test } from 'node:test';
import assert from 'node:assert/strict';
import { availabilityFactor, baseExpectation, scorePlayers, topByPosition, projectByGameweek, sumPointsByGw } from '../src/scoring.js';
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

test('projectByGameweek gives per-GW points: double sums two fixtures, blank is zero', () => {
  // Team 1 doubles in GW1 and blanks in GW2; team 2 plays a single fixture in GW1.
  const p1 = projectByGameweek(makeElement({ team: 1, ep_next: '5.0' }), makeFixtures(), 1, 3);
  const p2 = projectByGameweek(makeElement({ team: 2, ep_next: '5.0' }), makeFixtures(), 1, 3);
  assert.equal(p1.length, 3);
  assert.equal(p1.find((s) => s.gw === 2).points, 0, 'team 1 blanks GW2 → zero');
  const dgw = p1.find((s) => s.gw === 1).points;
  const single = p2.find((s) => s.gw === 1).points;
  assert.ok(dgw > single, 'a double gameweek out-scores a single for the same base');
  assert.ok(dgw > 0);
});

test('sumPointsByGw adds squad members per gameweek', () => {
  const a = { pointsByGw: [{ gw: 1, points: 4 }, { gw: 2, points: 0 }] };
  const b = { pointsByGw: [{ gw: 1, points: 3 }, { gw: 2, points: 5 }] };
  const total = sumPointsByGw([a, b]);
  assert.deepEqual(total, [{ gw: 1, points: 7 }, { gw: 2, points: 5 }]);
});

test('scorePlayers attaches per-GW projection and advanced Opta stats', () => {
  const boot = makeBootstrap([makeElement({ id: 1, expected_goal_involvements_per_90: '0.8', ict_index: '120.0' })]);
  const scored = scorePlayers(boot, makeFixtures(), 1, 0);
  const p = scored[0];
  assert.ok(Array.isArray(p.pointsByGw) && p.pointsByGw.length === 6, 'default 6-GW window');
  assert.ok(p.advanced && p.advanced.xgi90 === 0.8);
  assert.equal(p.advanced.ict, 120);
});

test('minutes reliability makes a nailed starter out-project a fringe player with equal rates', () => {
  // Same per-appearance rates, very different playing time.
  const boot = makeBootstrap([
    makeElement({ id: 1, ep_next: '5.0', points_per_game: '5.0', starts: 34, minutes: 3000 }),
    makeElement({ id: 2, ep_next: '5.0', points_per_game: '5.0', starts: 6, minutes: 500 }),
  ]);
  const scored = scorePlayers(boot, makeFixtures(), 1);
  const nailed = scored.find((p) => p.id === 1);
  const fringe = scored.find((p) => p.id === 2);
  assert.ok(nailed.projNext3 > fringe.projNext3, 'the regular starter projects higher');
  assert.ok(nailed.nailed === true && fringe.nailed === false);
});

test('minutes reliability is neutral when no minutes data exists (guard)', () => {
  // makeElement has no starts/minutes → refs are zero → reliability 1 for all, ordering intact.
  const boot = makeBootstrap([
    makeElement({ id: 1, ep_next: '6.0' }),
    makeElement({ id: 2, ep_next: '3.0' }),
  ]);
  const scored = scorePlayers(boot, makeFixtures(), 1);
  assert.equal(scored[0].reliability, 1);
  assert.ok(scored.find((p) => p.id === 1).projNext3 > scored.find((p) => p.id === 2).projNext3);
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
