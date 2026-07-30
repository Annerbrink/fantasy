import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyseRivals } from '../src/rivals.js';

test('rankGainTargets favours high-projection, low-ownership players you do not own', () => {
  const scoredById = new Map([
    [10, { name: 'Diff', team: 'ARS', position: 'MID', price: 8, projNext3: 15 }],   // great, unowned by rivals
    [11, { name: 'Template', team: 'MCI', position: 'FWD', price: 12, projNext3: 15 }], // great, everyone owns
    [12, { name: 'Weak', team: 'BHA', position: 'DEF', price: 4, projNext3: 2 }],
  ]);
  const rivalPicks = [
    { entry: 1, players: [11] },
    { entry: 2, players: [11] },
    { entry: 3, players: [11] },
  ];
  const r = analyseRivals({ standings: [], myPlayers: [], rivalPicks, scoredById,
    playerNameById: new Map([[10, 'Diff'], [11, 'Template'], [12, 'Weak']]) });
  assert.ok(r.rankGainTargets.length > 0);
  // Diff (unowned by rivals) should out-rank Template (owned by all) despite equal projection.
  assert.equal(r.rankGainTargets[0].id, 10);
  const diff = r.rankGainTargets.find((p) => p.id === 10);
  const templ = r.rankGainTargets.find((p) => p.id === 11);
  assert.ok(diff.rankGain > (templ ? templ.rankGain : 0));
});

test('templateRisks flags high-owned strong players you do not own', () => {
  const scoredById = new Map([[11, { name: 'Template', team: 'MCI', position: 'FWD', price: 12, projNext3: 14 }]]);
  const rivalPicks = [ { entry: 1, players: [11] }, { entry: 2, players: [11] } ];
  const r = analyseRivals({ standings: [], myPlayers: [], rivalPicks, scoredById,
    playerNameById: new Map([[11, 'Template']]) });
  assert.ok(r.templateRisks.some((p) => p.id === 11));
});
