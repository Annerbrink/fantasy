import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCoachMessages } from '../src/coach-prompt.js';

const advice = {
  targetGw: 1,
  manager: null,
  transfers: { watchlistOnly: true },
  captain: { captain: { name: 'Haaland', team: 'MCI' }, vice: { name: 'Saka', team: 'ARS' }, differential: null },
  chips: [],
  rivals: null,
  fixtureOutlook: { best: [], tough: [] },
  attackGws: [],
  keyPlayers: {
    GKP: [{ name: 'Raya', team: 'ARS', price: 6 }],
    DEF: [{ name: 'Gabriel', team: 'ARS', price: 8 }],
    MID: [{ name: 'B.Fernandes', team: 'MUN', price: 12 }],
    FWD: [{ name: 'Haaland', team: 'MCI', price: 15.5 }],
  },
  priceWatch: { risers: [{ name: 'Semenyo', team: 'MCI' }], fallers: [{ name: 'Isak', team: 'NEW' }] },
};

test('coach prompt includes a closed list of current players', () => {
  const { user } = buildCoachMessages(advice);
  assert.match(user, /currentPlayers/);
  assert.match(user, /Haaland/);
  assert.match(user, /B\.Fernandes/);
});

test('coach prompt forbids naming players outside the data', () => {
  const { system } = buildCoachMessages(advice);
  assert.match(system, /NEVER name any player/i);
});

test('coach prompt surfaces price risers and fallers', () => {
  const { user } = buildCoachMessages(advice);
  assert.match(user, /priceRisers/);
  assert.match(user, /Semenyo/);
  assert.match(user, /priceFallers/);
});
