import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceTrends } from '../src/prices.js';

function el(over = {}) {
  return {
    id: 1,
    web_name: 'P',
    team: 1,
    now_cost: 70,
    selected_by_percent: '10.0', // owners = 10% * total_players
    transfers_in_event: 0,
    transfers_out_event: 0,
    cost_change_event: 0,
    cost_change_start: 0,
    ...over,
  };
}
function boot(elements) {
  return { total_players: 1000, teams: [{ id: 1, short_name: 'ARS' }], elements };
}

test('heavy net transfers in classify as rising', () => {
  // owners = 100; net = +30 → momentum 0.30 ≥ 0.05
  const { byId } = priceTrends(boot([el({ id: 1, transfers_in_event: 40, transfers_out_event: 10 })]));
  assert.equal(byId.get(1).direction, 'rising');
});

test('heavy net transfers out classify as falling', () => {
  const { byId } = priceTrends(boot([el({ id: 1, transfers_in_event: 5, transfers_out_event: 45 })]));
  assert.equal(byId.get(1).direction, 'falling');
});

test('a price change already applied today forces direction regardless of momentum', () => {
  const rose = priceTrends(boot([el({ id: 1, cost_change_event: 1 })]));
  assert.equal(rose.byId.get(1).direction, 'rising');
  const fell = priceTrends(boot([el({ id: 2, cost_change_event: -1 })]));
  assert.equal(fell.byId.get(2).direction, 'falling');
});

test('low activity stays stable and lists rank by momentum', () => {
  const { byId, risers, fallers } = priceTrends(
    boot([
      el({ id: 1, transfers_in_event: 1, transfers_out_event: 1 }), // stable
      el({ id: 2, transfers_in_event: 60, transfers_out_event: 5 }), // big riser
      el({ id: 3, transfers_in_event: 2, transfers_out_event: 50 }), // faller
    ])
  );
  assert.equal(byId.get(1).direction, 'stable');
  assert.equal(risers[0].id, 2);
  assert.equal(fallers[0].id, 3);
});
