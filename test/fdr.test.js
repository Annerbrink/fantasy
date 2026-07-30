import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveTargetGw,
  teamFixturesFrom,
  difficultyMultiplier,
  detectDgwBgw,
  fixturesPerTeamInGw,
  normalizeTeamStrength,
  gameweekAttackIndex,
  teamFixtureOutlook,
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

test('normalizeTeamStrength maps the strongest team to 1 and weakest to 0', () => {
  const teams = [
    { id: 1, short_name: 'A', strength_overall_home: 5, strength_overall_away: 5 },
    { id: 2, short_name: 'B', strength_overall_home: 3, strength_overall_away: 3 },
    { id: 3, short_name: 'C', strength_overall_home: 1, strength_overall_away: 1 },
  ];
  const norm = normalizeTeamStrength(teams);
  assert.equal(norm.get(1).home, 1);
  assert.equal(norm.get(3).home, 0);
  assert.ok(norm.get(2).home > 0 && norm.get(2).home < 1);
});

test('gameweekAttackIndex ranks a strong team v weak team as the standout fixture', () => {
  const teams = [
    { id: 1, short_name: 'STR', strength_overall_home: 5, strength_overall_away: 5 },
    { id: 2, short_name: 'WEK', strength_overall_home: 1, strength_overall_away: 1 },
  ];
  // GW1: strong team 1 at home vs weak team 2, an easy fixture for team 1 (difficulty 2).
  const fixtures = [{ event: 1, team_h: 1, team_a: 2, team_h_difficulty: 2, team_a_difficulty: 5 }];
  const idx = gameweekAttackIndex(fixtures, teams, 1, 3);
  assert.equal(idx.length, 1);
  const top = idx[0].fixtures[0];
  assert.equal(top.team, 'STR');
  assert.equal(top.opponent, 'WEK');
});

test('teamFixtureOutlook ranks the easiest run as best', () => {
  const boot = makeBootstrap([makeElement()]);
  const outlook = teamFixtureOutlook(makeFixtures(), boot.teams, 1, 3);
  assert.ok(outlook.best.length > 0 && outlook.tough.length > 0);
  // best is sorted by attackScore desc — highest first
  assert.ok(outlook.best[0].attackScore >= outlook.best[outlook.best.length - 1].attackScore);
});
