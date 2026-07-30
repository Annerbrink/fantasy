import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scorePlayers } from '../src/scoring.js';
import { buildDraft, buildBestDraft, mulberry32 } from '../src/draft.js';
import { makeBootstrap, makeFixtures, makeElement } from './helpers.js';

// Build a realistic-sized pool: enough players per position and several teams so the squad
// rules (quotas, budget, max-3-per-club) are actually exercised.
function bigBootstrap() {
  const elements = [];
  let id = 1;
  const perPos = { 1: 6, 2: 16, 3: 16, 4: 10 };
  const TEAMS = 10; // spread across 10 clubs so max-3-per-club allows a full 15
  for (const et of [1, 2, 3, 4]) {
    for (let i = 0; i < perPos[et]; i += 1) {
      elements.push(
        makeElement({
          id: id,
          element_type: et,
          team: (id % TEAMS) + 1,
          now_cost: 40 + (i % 6) * 10, // 4.0 .. 9.0
          ep_next: String(2 + (i % 6)), // varying projection
          points_per_game: String(2 + (i % 6)),
        })
      );
      id += 1;
    }
  }
  return makeBootstrap(elements, TEAMS);
}

test('buildDraft returns a full, legal 15-man squad within budget', () => {
  const boot = bigBootstrap();
  const scored = scorePlayers(boot, makeFixtures(), 1, 5);
  const draft = buildDraft(scored, { budget: 100 });

  const all = [...draft.squad.GKP, ...draft.squad.DEF, ...draft.squad.MID, ...draft.squad.FWD];
  assert.equal(all.length, 15, '15 players selected');
  assert.equal(draft.squad.GKP.length, 2);
  assert.equal(draft.squad.DEF.length, 5);
  assert.equal(draft.squad.MID.length, 5);
  assert.equal(draft.squad.FWD.length, 3);
  assert.ok(draft.totalCost <= 100 + 1e-6, `within budget (spent ${draft.totalCost})`);
  assert.ok(draft.complete);
});

test('buildDraft respects the max-3-per-club rule', () => {
  const boot = bigBootstrap();
  const scored = scorePlayers(boot, makeFixtures(), 1, 5);
  const draft = buildDraft(scored, { budget: 100 });

  const all = [...draft.squad.GKP, ...draft.squad.DEF, ...draft.squad.MID, ...draft.squad.FWD];
  const byTeam = {};
  for (const p of all) byTeam[p.team] = (byTeam[p.team] || 0) + 1;
  for (const [team, n] of Object.entries(byTeam)) {
    assert.ok(n <= 3, `no more than 3 from ${team} (had ${n})`);
  }
});

test('buildDraft picks a valid starting XI and formation', () => {
  const boot = bigBootstrap();
  const scored = scorePlayers(boot, makeFixtures(), 1, 5);
  const draft = buildDraft(scored, { budget: 100 });

  assert.equal(draft.startingXI.length, 11);
  assert.equal(draft.bench.length, 4);
  assert.ok(draft.captain && draft.vice);
  assert.match(draft.formation, /^\d-\d-\d$/);
  // Exactly one keeper starts.
  assert.equal(draft.startingXI.filter((p) => p.position === 'GKP').length, 1);
});

test('mulberry32 is deterministic for a given seed', () => {
  const a = mulberry32(12345);
  const b = mulberry32(12345);
  assert.equal(a(), b());
  assert.equal(a(), b());
});

test('a jittered draft stays legal, and the multi-start best is the projection ceiling', () => {
  const boot = bigBootstrap();
  const scored = scorePlayers(boot, makeFixtures(), 1, 5);
  const best = buildBestDraft(scored, { budget: 100 });
  const alt = buildDraft(scored, { budget: 100, jitter: 0.3, rng: mulberry32(7) });

  // Legal squad.
  const all = [...alt.squad.GKP, ...alt.squad.DEF, ...alt.squad.MID, ...alt.squad.FWD];
  assert.equal(all.length, 15);
  assert.ok(alt.totalCost <= 100 + 1e-6);
  const byTeam = {};
  for (const p of all) byTeam[p.team] = (byTeam[p.team] || 0) + 1;
  assert.ok(Math.max(...Object.values(byTeam)) <= 3);
  // The multi-start best is at least as good as any single alternative.
  assert.ok(best.squadProjection >= alt.squadProjection - 1e-6);
});

test('locked players are always included and never swapped out', () => {
  const boot = bigBootstrap();
  const scored = scorePlayers(boot, makeFixtures(), 1, 5);
  // Lock a couple of low-projection players the optimiser would normally skip.
  const weak = [...scored].sort((a, b) => a.projNext3 - b.projNext3).filter((p) => p.elementType === 3).slice(0, 1);
  const lockId = weak[0].id;
  const draft = buildDraft(scored, { budget: 100, lockedIds: [lockId] });
  const all = [...draft.squad.GKP, ...draft.squad.DEF, ...draft.squad.MID, ...draft.squad.FWD];
  assert.equal(all.length, 15, 'still a full squad');
  assert.ok(all.some((p) => p.id === lockId), 'the locked player is in the squad');
  assert.ok(draft.lockedIncluded.some((p) => p.id === lockId));
});

test('a locked player that breaks a constraint is reported excluded', () => {
  const boot = bigBootstrap();
  const scored = scorePlayers(boot, makeFixtures(), 1, 5);
  // Lock four forwards — only 3 fit the squad, so at least one is excluded.
  const fwds = scored.filter((p) => p.elementType === 4).slice(0, 4).map((p) => p.id);
  const draft = buildDraft(scored, { budget: 100, lockedIds: fwds });
  assert.ok(draft.lockedExcluded.length >= 1, 'a 4th forward cannot be locked');
  assert.equal(draft.squad.FWD.length, 3);
});

test('same seed reproduces the same alternative draft', () => {
  const boot = bigBootstrap();
  const scored = scorePlayers(boot, makeFixtures(), 1, 5);
  const a = buildDraft(scored, { budget: 100, jitter: 0.3, rng: mulberry32(42) });
  const b = buildDraft(scored, { budget: 100, jitter: 0.3, rng: mulberry32(42) });
  assert.deepEqual(a.startingXI.map((p) => p.id), b.startingXI.map((p) => p.id));
});
