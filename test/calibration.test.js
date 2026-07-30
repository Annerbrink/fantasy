import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mae, meanBias, spearman, evaluateProjection } from '../src/calibration.js';

test('mae and bias compute correctly', () => {
  const pairs = [{ proj: 5, actual: 3 }, { proj: 2, actual: 4 }]; // errors 2 and 2; bias +2, -2
  assert.equal(mae(pairs), 2);
  assert.equal(meanBias(pairs), 0);
});

test('spearman is 1 for a perfectly-ordered projection', () => {
  const pairs = [
    { proj: 1, actual: 2 },
    { proj: 2, actual: 5 },
    { proj: 3, actual: 6 },
    { proj: 4, actual: 9 },
  ];
  assert.equal(spearman(pairs), 1);
});

test('spearman is -1 for a perfectly-reversed projection', () => {
  const pairs = [
    { proj: 4, actual: 1 },
    { proj: 3, actual: 2 },
    { proj: 2, actual: 3 },
    { proj: 1, actual: 4 },
  ];
  assert.equal(spearman(pairs), -1);
});

test('evaluateProjection pairs scored players with their actuals', () => {
  const scored = [{ id: 1, projNext: 6 }, { id: 2, projNext: 2 }, { id: 3, projNext: 4 }];
  const actual = new Map([[1, 7], [2, 1]]); // player 3 didn't feature
  const r = evaluateProjection(scored, actual, { field: 'projNext' });
  assert.equal(r.count, 2);
  assert.equal(r.mae, 1); // |6-7|=1, |2-1|=1
});
