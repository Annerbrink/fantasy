import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlayerSchedule } from '../src/schedule.js';
import { makeBootstrap, makeFixtures, makeElement } from './helpers.js';

// team 1 has a Double in GW1 (vs team 2 and team 3) and a Blank in GW2; team 2 plays once in GW1.
function boot() {
  return makeBootstrap([
    makeElement({ id: 1, team: 1, ep_next: '5.0' }),
    makeElement({ id: 2, team: 2, ep_next: '4.0' }),
  ]);
}

test('buildPlayerSchedule groups fixtures by gameweek with opponents, H/A and difficulty', () => {
  const s = buildPlayerSchedule(boot(), makeFixtures(), 1, 1, 3);
  assert.equal(s.id, 1);
  assert.equal(s.team, 'ARS');
  assert.equal(s.schedule.length, 3, 'one entry per GW in the window');

  const gw1 = s.schedule.find((g) => g.gw === 1);
  assert.equal(gw1.fixtures.length, 2, 'GW1 is a Double for team 1');
  for (const f of gw1.fixtures) {
    assert.ok(typeof f.opponent === 'string' && f.opponent.length > 0, 'opponent short name');
    assert.ok(typeof f.home === 'boolean');
    assert.ok(f.difficulty >= 1 && f.difficulty <= 5);
  }
  assert.ok(gw1.points > 0, 'a played GW projects points');
});

test('a blank gameweek has no fixtures and zero points', () => {
  const s = buildPlayerSchedule(boot(), makeFixtures(), 1, 1, 3);
  const gw2 = s.schedule.find((g) => g.gw === 2);
  assert.equal(gw2.fixtures.length, 0, 'team 1 blanks GW2');
  assert.equal(gw2.points, 0);
});

test('the schedule total equals the sum of its per-GW points', () => {
  const s = buildPlayerSchedule(boot(), makeFixtures(), 1, 1, 3);
  const sum = s.schedule.reduce((a, g) => a + g.points, 0);
  assert.ok(Math.abs(s.total - sum) < 0.05);
});

test('an unknown player id returns null', () => {
  assert.equal(buildPlayerSchedule(boot(), makeFixtures(), 1, 999, 3), null);
});
