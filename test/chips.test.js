import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chipAdvice } from '../src/chips.js';

const attack = (gw, index = 5) => ({ gw, index, fixtures: [{ team: 'MCI', opponent: 'BHA', home: true }] });
const dbl = (gw, teams = [1, 2, 3]) => ({ gw, doubleTeams: teams, blankTeams: [] });
const blank = (gw, teams = [1, 2]) => ({ gw, doubleTeams: [], blankTeams: teams });

test('used chips are reported as used', () => {
  const advice = chipAdvice({ chipsUsed: new Set(['wildcard']), targetGw: 5 });
  const wc = advice.find((c) => c.chip === 'Wildcard');
  assert.equal(wc.status, 'used');
});

test('a double before the deadline is the Bench Boost / Triple Captain target', () => {
  const advice = chipAdvice({ dgwBgw: [dbl(8)], attackGws: [], targetGw: 5 });
  const bb = advice.find((c) => c.chip === 'Bench Boost');
  const tc = advice.find((c) => c.chip === 'Triple Captain');
  assert.equal(bb.status, 'target');
  assert.equal(bb.when, 'GW8');
  assert.equal(tc.status, 'target');
});

test('a double AFTER the half deadline is ignored (chip would have expired)', () => {
  // targetGw 17 → first-half deadline is GW19; a GW22 double is out of reach.
  const advice = chipAdvice({ dgwBgw: [dbl(22)], attackGws: [attack(18)], targetGw: 17 });
  const bb = advice.find((c) => c.chip === 'Bench Boost');
  assert.notEqual(bb.when, 'GW22');
  assert.equal(bb.status, 'urgent', 'near the deadline with no reachable double → urgent');
});

test('near the deadline with no double, chips become urgent (use before expiry)', () => {
  const advice = chipAdvice({ dgwBgw: [], attackGws: [attack(18)], targetGw: 17 });
  const tc = advice.find((c) => c.chip === 'Triple Captain');
  assert.equal(tc.status, 'urgent');
  assert.match(tc.recommendation, /GW19 deadline|expire|before it expires/i);
});

test('second-half chips use the GW38 deadline', () => {
  const advice = chipAdvice({ dgwBgw: [], attackGws: [], targetGw: 21 });
  const bb = advice.find((c) => c.chip === 'Bench Boost');
  // Plenty of time left (remaining = 17), so it holds and references GW38.
  assert.equal(bb.status, 'hold');
  assert.match(bb.recommendation, /GW38/);
});
