import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scorePlayers } from '../src/scoring.js';
import { buildDraft, buildBestDraft, mulberry32, bestSingleTransfer } from '../src/draft.js';
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

test('the optimal squad never scores fewer effective points than a locked variant', () => {
  // Regression guard for the "100/100 shows fewer points than a locked squad" paradox: the
  // unlocked optimum must be >= any constrained (locked) build on the shared objective, in
  // both normal and Bench Boost modes.
  const boot = bigBootstrap();
  const scored = scorePlayers(boot, makeFixtures(), 1, 5);
  const anchor = [...scored].sort((a, b) => b.projHorizon - a.projHorizon)[0].id; // the top premium
  for (const benchBoostGw of [null, 1]) {
    const optimal = buildBestDraft(scored, { budget: 100, benchBoostGw });
    const locked = buildBestDraft(scored, { budget: 100, benchBoostGw, lockedIds: [anchor] });
    assert.ok(typeof optimal.effectiveProjection === 'number', 'effectiveProjection is returned');
    assert.ok(
      optimal.effectiveProjection >= locked.effectiveProjection - 1e-6,
      `optimal (${optimal.effectiveProjection}) >= locked (${locked.effectiveProjection}) [benchBoostGw=${benchBoostGw}]`
    );
  }
});

test('Triple Captain triples the captain on only the chosen gameweek', () => {
  const boot = bigBootstrap();
  const scored = scorePlayers(boot, makeFixtures(), 1, 5);
  const plain = buildBestDraft(scored, { budget: 100 });
  const tc = buildBestDraft(scored, { budget: 100, tripleCaptainGw: 1 });
  const g1 = tc.pointsByGw.find((g) => g.gw === 1);
  const g2 = tc.pointsByGw.find((g) => g.gw === 2);
  assert.equal(g1.tripleCaptain, true, 'GW1 is the Triple Captain week');
  assert.equal(g2.tripleCaptain, false, 'other weeks are unaffected');
  // GW1 total is base + 2×captain (triple); a normal week is base + 1×captain (double).
  assert.ok(Math.abs(g1.points - (g1.base + 2 * g1.captainPoints)) < 0.01, 'captain tripled on the TC week');
  assert.ok(Math.abs(g2.points - (g2.base + g2.captainPoints)) < 0.01, 'captain only doubled elsewhere');
  assert.ok(tc.effectiveProjection > plain.effectiveProjection - 1e-6, 'Triple Captain adds points');
});

test('a Bench Boost draft still builds a full, legal squad on a tight budget', () => {
  const boot = bigBootstrap();
  const scored = scorePlayers(boot, makeFixtures(), 1, 5);
  for (const budget of [92, 95, 100]) {
    const d = buildBestDraft(scored, { budget, benchBoostGw: 1 });
    const all = [...d.startingXI, ...d.bench];
    assert.equal(all.length, 15, `full squad at £${budget}m under Bench Boost`);
    assert.ok(d.totalCost <= budget + 1e-6, 'within budget');
    const byTeam = {};
    for (const p of all) byTeam[p.teamId] = (byTeam[p.teamId] || 0) + 1;
    assert.ok(Math.max(...Object.values(byTeam)) <= 3, 'max 3 per club');
  }
});

test('Bench Boost mode excludes non-playing players so the bench actually scores', () => {
  const boot = bigBootstrap();
  const scored = scorePlayers(boot, makeFixtures(), 1, 5).map((p) => ({ ...p }));
  // Mark a couple of cheap forwards as non-playing 0-minute academy types.
  const cheapFwds = scored.filter((p) => p.position === 'FWD').sort((a, b) => a.price - b.price).slice(0, 2);
  for (const p of cheapFwds) { p.nailed = false; p.minutes = 0; }
  const bb = buildBestDraft(scored, { budget: 100, benchBoostGw: 1 });
  const squad = [...bb.startingXI, ...bb.bench];
  assert.ok(!squad.some((p) => cheapFwds.some((c) => c.id === p.id)), 'no 0-minute player is picked under Bench Boost');
  const normal = buildBestDraft(scored, { budget: 100 });
  // Without Bench Boost the cheap enabler is allowed (not required, but the filter must be off).
  assert.ok(normal.complete);
});

test('Bench Boost is applied to only the chosen gameweek', () => {
  const boot = bigBootstrap();
  const scored = scorePlayers(boot, makeFixtures(), 1, 5);
  const d = buildBestDraft(scored, { budget: 100, benchBoostGw: 1 });
  const bbWeeks = d.pointsByGw.filter((g) => g.benchBoost);
  assert.equal(bbWeeks.length, 1, 'exactly one Bench Boost gameweek');
  assert.equal(bbWeeks[0].gw, 1, 'it is the chosen gameweek');
  assert.equal(d.pointsByGw.find((g) => g.gw === 2).benchBoost, false, 'other weeks are XI-only');
});

test('effectiveProjection sums the per-GW series and doubles the best starter each week', () => {
  const boot = bigBootstrap();
  const scored = scorePlayers(boot, makeFixtures(), 1, 5);
  const d = buildBestDraft(scored, { budget: 100, benchBoostGw: null });
  const seriesSum = d.pointsByGw.reduce((s, g) => s + g.points, 0);
  assert.ok(Math.abs(d.effectiveProjection - seriesSum) < 0.05, 'effective = sum of per-GW points');
  for (const g of d.pointsByGw) {
    assert.ok(Math.abs(g.points - (g.base + g.captainPoints)) < 0.01, 'GW total = base + doubled captain');
    if (g.base > 0) assert.ok(g.captainId != null, 'a captain is chosen each scoring GW');
  }
  assert.ok(d.effectiveProjection > d.projectedPoints, 'captain doubling adds points on top of the XI');
});

test('draft players carry a per-gameweek projection for the GW stepper', () => {
  const boot = bigBootstrap();
  const scored = scorePlayers(boot, makeFixtures(), 1, 5);
  const draft = buildBestDraft(scored, { budget: 100 });
  const someone = draft.startingXI[0];
  assert.ok(Number.isFinite(someone.teamId), 'briefs carry teamId (for the max-3-per-club check)');
  assert.ok(Array.isArray(someone.pointsByGw) && someone.pointsByGw.length > 0, 'starting XI carries pointsByGw');
  assert.ok(someone.pointsByGw.every((g) => typeof g.gw === 'number' && typeof g.points === 'number'));
  assert.ok(draft.bench[0].pointsByGw.length > 0, 'bench carries pointsByGw too');
  // Per-player GW points sum across the XI to the squad-level series *base* (before captain).
  const gw1 = draft.pointsByGw[0].gw;
  const xiSum = draft.startingXI.reduce((s, p) => s + (p.pointsByGw.find((g) => g.gw === gw1)?.points || 0), 0);
  assert.ok(Math.abs(xiSum - draft.pointsByGw[0].base) < 0.05, 'XI per-player GW points sum to the squad base');
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

test('by default the backup goalkeeper is the cheapest option (one keeper plays)', () => {
  const boot = bigBootstrap();
  const scored = scorePlayers(boot, makeFixtures(), 1, 5);
  const draft = buildBestDraft(scored, { budget: 100 });
  const gkPrices = draft.squad.GKP.map((p) => p.price).sort((a, b) => a - b);
  const cheapestGk = Math.min(...scored.filter((p) => p.position === 'GKP').map((p) => p.price));
  assert.equal(draft.squad.GKP.length, 2);
  assert.equal(gkPrices[0], cheapestGk, 'the backup keeper is still at the cheapest price point');
});

test('at the cheapest keeper price, the reserved backup is a playing keeper (not a 0-minute dud)', () => {
  const boot = bigBootstrap();
  // Two £4.0m keepers: one nailed (plays), one a 0-minute bench-warmer. The backup should be
  // the nailed one — same price, but actual cover.
  const scored = scorePlayers(boot, makeFixtures(), 1, 5).map((p) => ({ ...p }));
  const cheapGks = scored.filter((p) => p.position === 'GKP').sort((a, b) => a.price - b.price).slice(0, 2);
  cheapGks[0].price = 4.0; cheapGks[0].nailed = true; cheapGks[0].projHorizon = 8; cheapGks[0].projNext3 = 5;
  cheapGks[1].price = 4.0; cheapGks[1].nailed = false; cheapGks[1].projHorizon = 1; cheapGks[1].projNext3 = 0.5;
  const draft = buildBestDraft(scored, { budget: 100 });
  const backup = draft.squad.GKP.slice().sort((a, b) => a.price - b.price)[0];
  assert.equal(backup.id, cheapGks[0].id, 'the nailed £4.0m keeper is chosen over the 0-minute one');
});

test('the squad always includes a nailed keeper (prefers a slightly pricier nailed one)', () => {
  const boot = bigBootstrap();
  const scored = scorePlayers(boot, makeFixtures(), 1, 5).map((p) => ({ ...p }));
  // Make every cheap keeper a non-playing dud except one nailed keeper £0.5m dearer.
  const gks = scored.filter((p) => p.position === 'GKP').sort((a, b) => a.price - b.price);
  for (const g of gks) { g.nailed = false; g.projHorizon = 1; g.projNext3 = 0.5; }
  const nailed = gks[1]; // the second-cheapest becomes the only nailed keeper
  nailed.nailed = true; nailed.projHorizon = 9; nailed.projNext3 = 6;
  const draft = buildBestDraft(scored, { budget: 100 });
  assert.ok(draft.squad.GKP.some((p) => p.nailed), 'at least one nailed keeper is reserved');
  const backup = draft.squad.GKP.slice().sort((a, b) => a.price - b.price)[0];
  assert.equal(backup.id, nailed.id, 'the nailed keeper is preferred as the cheap backup');
});

test('bestSingleTransfer finds an improving free transfer for a weakened squad', () => {
  const boot = bigBootstrap();
  const scored = scorePlayers(boot, makeFixtures(), 1, 5);
  const opt = buildBestDraft(scored, { budget: 100 });
  const ids = [...opt.startingXI, ...opt.bench].map((p) => p.id);
  const owned = new Set(ids);
  // Swap one starting midfielder for a weaker, affordable, unused one to open an upgrade.
  const midOut = opt.startingXI.find((p) => p.position === 'MID');
  const weakMid = scored
    .filter((p) => p.position === 'MID' && !owned.has(p.id) && p.price <= midOut.price)
    .sort((a, b) => a.projHorizon - b.projHorizon)[0];
  assert.ok(weakMid, 'a weaker affordable mid exists to create the opportunity');
  const weakenedIds = ids.map((id) => (id === midOut.id ? weakMid.id : id));
  const remaining = Math.round((100 - weakenedIds.reduce((s, id) => s + scored.find((p) => p.id === id).price, 0)) * 10) / 10;

  const t = bestSingleTransfer(scored, weakenedIds, { budgetRemaining: remaining });
  assert.ok(t && t.gain > 0, 'suggests a positive-gain transfer');
  assert.equal(t.in.position, t.out.position, 'a same-position swap');
});

test('bestSingleTransfer returns null when nothing improves an unchanged optimal-ish squad', () => {
  const boot = bigBootstrap();
  const scored = scorePlayers(boot, makeFixtures(), 1, 5);
  const opt = buildBestDraft(scored, { budget: 100 });
  const ids = [...opt.startingXI, ...opt.bench].map((p) => p.id);
  const t = bestSingleTransfer(scored, ids, { budgetRemaining: opt.remaining });
  // Either no improvement, or a genuinely positive one — never a non-positive suggestion.
  assert.ok(t === null || t.gain > 0);
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
