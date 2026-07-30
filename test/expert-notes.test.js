import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promotedInfo, softOpponentBonuses, EXPERT_SOURCES, PROMOTED_TEAMS } from '../src/expert-notes.js';

test('promotedInfo matches Hull as the softest promoted side', () => {
  const hull = promotedInfo({ name: 'Hull City', short_name: 'HUL' });
  assert.ok(hull);
  assert.equal(hull.softness, 1.0);
  const cov = promotedInfo({ name: 'Coventry City', short_name: 'COV' });
  assert.ok(cov.softness < hull.softness, 'Coventry is a softer-in-name-only promoted side, weaker weight than Hull');
  assert.equal(promotedInfo({ name: 'Arsenal', short_name: 'ARS' }), null);
});

test('softOpponentBonuses gives Hull the biggest boost', () => {
  const teams = [
    { id: 1, name: 'Arsenal', short_name: 'ARS' },
    { id: 2, name: 'Hull City', short_name: 'HUL' },
    { id: 3, name: 'Coventry City', short_name: 'COV' },
  ];
  const bonuses = softOpponentBonuses(teams);
  assert.ok(!bonuses.has(1), 'non-promoted teams get no bonus');
  assert.ok(bonuses.get(2) > bonuses.get(3), 'Hull boost exceeds Coventry');
  assert.ok(bonuses.get(2) > 0);
});

test('two expert sources are provided to the coach', () => {
  assert.equal(EXPERT_SOURCES.length, 2);
  assert.ok(EXPERT_SOURCES.some((s) => /LetsTalkFPL/i.test(s.source)));
  assert.ok(PROMOTED_TEAMS.some((t) => /Hull/.test(t.name)));
});
