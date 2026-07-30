import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTransfers } from '../src/planner.js';

// Minimal scored rows with pointsByGw over a 3-GW horizon.
function p(id, et, price, weekly, over = {}) {
  return {
    id, name: `P${id}`, team: 'ARS', position: ['', 'GKP', 'DEF', 'MID', 'FWD'][et], elementType: et, price,
    status: 'a', chanceNext: null, projHorizon: weekly.reduce((s, x) => s + x, 0),
    pointsByGw: weekly.map((points, j) => ({ gw: j + 1, points })),
    ...over,
  };
}

test('planTransfers recommends upgrading a weak owned player and sequences by gain', () => {
  const scored = [
    p(1, 3, 6.0, [2, 2, 2]), // owned weak MID
    p(2, 3, 6.5, [6, 6, 6]), // strong affordable upgrade
    p(3, 4, 8.0, [3, 3, 3]), // owned weak FWD
    p(4, 4, 8.5, [8, 8, 8]), // strong affordable upgrade (+15 > MID's +12)
  ];
  const squad = { bank: 1.0, freeTransfers: 1, players: [{ id: 1, sellingPrice: 6.0 }, { id: 3, sellingPrice: 8.0 }] };
  const plan = planTransfers(scored, squad, { horizon: 3, weeks: 4 });

  assert.ok(plan.hasSquad);
  assert.ok(plan.roadmap.length >= 2, 'plans multiple weeks');
  // The bigger-gain swap (FWD 3→4, +12 over horizon) should be scheduled first (week 0).
  assert.equal(plan.roadmap[0].out.id, 3);
  assert.equal(plan.roadmap[0].in.id, 4);
  assert.ok(plan.roadmap[0].realizedGain > plan.roadmap[1].realizedGain - 1e-9);
});

test('planTransfers flags a move worth a -4 hit now', () => {
  const scored = [
    p(1, 3, 6.0, [1, 1, 1]),
    p(2, 3, 6.0, [6, 6, 6]), // +15 over horizon → clearly worth a hit
  ];
  const squad = { bank: 0.5, freeTransfers: 1, players: [{ id: 1, sellingPrice: 6.0 }] };
  const plan = planTransfers(scored, squad, { horizon: 3, weeks: 2 });
  assert.ok(plan.hitWorthy.some((h) => h.in.id === 2));
});
