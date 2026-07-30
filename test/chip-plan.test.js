import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestChipPlan, validateChipPlan, normalizeChipPlan, parseChipPlan, serializeChipPlan, CHIP_SLOTS } from '../src/chip-plan.js';

const dbl = (gw, n = 3) => ({ gw, doubleTeams: Array.from({ length: n }, (_, i) => i + 1), blankTeams: [] });
const blank = (gw, n = 2) => ({ gw, doubleTeams: [], blankTeams: Array.from({ length: n }, (_, i) => i + 1) });
const attack = (gw, index) => ({ gw, index, fixtures: [] });

test('suggestChipPlan puts Triple Captain on the pre-computed premium week', () => {
  const plan = suggestChipPlan({
    dgwBgw: [dbl(26)],
    attackGws: [attack(3, 9), attack(10, 6)],
    tripleCaptain: { name: 'Haaland', opponent: 'COV', gw: 3, promoted: true },
    targetGw: 1,
  });
  assert.equal(plan['3xc1'].gw, 3);
  assert.match(plan['3xc1'].reason, /Haaland/);
});

test('suggestChipPlan puts Bench Boost on the biggest Double and never doubles up a GW', () => {
  const plan = suggestChipPlan({
    dgwBgw: [dbl(15, 6), dbl(12, 4)],
    attackGws: [attack(3, 9)],
    tripleCaptain: { name: 'Haaland', opponent: 'COV', gw: 3, promoted: true },
    targetGw: 1,
  });
  assert.equal(plan['bboost1'].gw, 15, 'biggest double');
  // No two chips share a gameweek within a half (only one chip per GW is allowed).
  const half1 = ['wildcard1', 'bboost1', '3xc1', 'freehit1'].map((s) => plan[s]?.gw).filter((g) => g != null);
  assert.equal(new Set(half1).size, half1.length, 'unique GWs in the first half');
});

test('suggestChipPlan keeps every chip inside its half and on/after the target GW', () => {
  const plan = suggestChipPlan({ dgwBgw: [], attackGws: [], tripleCaptain: null, targetGw: 6 });
  for (const s of CHIP_SLOTS) {
    const gw = plan[s.slot]?.gw;
    if (gw == null) continue;
    assert.ok(gw >= s.min && gw <= s.max, `${s.slot} within GW${s.min}-${s.max}`);
    assert.ok(gw >= 6, `${s.slot} not in the past`);
  }
});

test('validateChipPlan flags a Bench Boost with no Double and names the nearest one', () => {
  const reviews = validateChipPlan({ bboost1: 10 }, { dgwBgw: [dbl(15)], attackGws: [], targetGw: 1 });
  const bb = reviews.find((r) => r.slot === 'bboost1');
  assert.equal(bb.ok, false);
  assert.match(bb.note, /GW15/);
});

test('validateChipPlan passes a Bench Boost that lands on a Double', () => {
  const reviews = validateChipPlan({ bboost1: 15 }, { dgwBgw: [dbl(15)], attackGws: [], targetGw: 1 });
  assert.equal(reviews.find((r) => r.slot === 'bboost1').ok, true);
});

test('validateChipPlan rejects a chip planned outside its half', () => {
  const reviews = validateChipPlan({ freehit1: 25 }, { dgwBgw: [], attackGws: [], targetGw: 1 });
  const fh = reviews.find((r) => r.slot === 'freehit1');
  assert.equal(fh.ok, false);
  assert.match(fh.note, /outside/i);
});

test('normalizeChipPlan drops out-of-half and non-numeric entries', () => {
  const clean = normalizeChipPlan({ wildcard1: 8, bboost1: 99, '3xc2': 25, freehit1: 'x' });
  assert.deepEqual(clean, { wildcard1: 8, '3xc2': 25 });
});

test('parse/serialize round-trips a plan', () => {
  const map = { wildcard1: 8, bboost1: 15, '3xc1': 3 };
  assert.deepEqual(parseChipPlan(serializeChipPlan(map)), map);
  assert.deepEqual(parseChipPlan('wildcard1:8,3xc1:3'), { wildcard1: 8, '3xc1': 3 });
});
