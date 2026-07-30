import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveTargetGw,
  teamFixturesFrom,
  difficultyMultiplier,
  detectDgwBgw,
  fixturesPerTeamInGw,
} from '../src/fdr.js';
import { makeBootstrap, makeFixtures, makeElement } from './helpers.js';

test('resolveTargetGw picks the next GW in pre-season', () => {
  const boot = makeBootstrap([makeElement()]);
  assert.equal(resolveTargetGw(boot.events), 1);
});

test('resolveTargetGw prefers the current live GW', () => {
  const events = [
    { id: 1, finished: true, is_current: false, is_next: false },
    { id: 2, finished: false, is_current: true, is_next: false },
  ];
  assert.equal(resolveTargetGw(events), 2);
});

test('teamFixturesFrom returns two rows for a double gameweek', () => {
  const fx = teamFixturesFrom(makeFixtures(), 1, 1, 1); // team 1, from GW1, span 1 GW
  assert.equal(fx.length, 2); // ARS plays twice in GW1
  assert.ok(fx.every((f) => f.gw === 1));
});

test('difficultyMultiplier rewards easy fixtures and penalises hard ones', () => {
  assert.ok(difficultyMultiplier(1, true) > difficultyMultiplier(3, true));
  assert.ok(difficultyMultiplier(5, true) < difficultyMultiplier(3, true));
  // Home carries a small bump over away at equal difficulty.
  assert.ok(difficultyMultiplier(3, true) > difficultyMultiplier(3, false));
});

test('fixturesPerTeamInGw counts appearances', () => {
  const counts = fixturesPerTeamInGw(makeFixtures(), 1);
  assert.equal(counts.get(1), 2); // team 1 plays twice in GW1
  assert.equal(counts.get(2), 1);
});

test('detectDgwBgw flags the double and the blank', () => {
  const boot = makeBootstrap([makeElement()]);
  const report = detectDgwBgw(makeFixtures(), boot.teams, 1, 3);
  const gw1 = report.find((r) => r.gw === 1);
  const gw2 = report.find((r) => r.gw === 2);
  assert.ok(gw1 && gw1.doubleTeams.includes(1)); // team 1 has a double in GW1
  assert.ok(gw2 && gw2.blankTeams.includes(1)); // team 1 blanks in GW2
});
