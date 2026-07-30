// Draft / squad builder.
//
// Picks a full 15-man FPL squad that maximises projected points over the chosen horizon,
// subject to the real FPL rules: exactly 2 GKP / 5 DEF / 5 MID / 3 FWD, a budget (default
// £100.0m), and no more than 3 players from any single club. Exact optimisation is an
// integer program; for advisory use we run a budget-aware greedy that reserves enough money
// to fill remaining slots, then improve with swaps. Deterministic and unit-tested.
//
// Two extras layered on top:
//   - `jitter` + a seeded RNG let the builder produce *alternative* drafts: perturbing each
//     player's ranking yields different-but-still-strong squads to compare.
//   - the builder reports the raw squad projection and fixture/value breakdown so callers
//     can turn it into a 0-100 team rating (see functions/api/draft.js).

const SQUAD = { 1: 2, 2: 5, 3: 5, 4: 3 }; // elementType -> count
const POS_NAME = { 1: 'GKP', 2: 'DEF', 3: 'MID', 4: 'FWD' };
const MAX_PER_TEAM = 3;

function proj(p) {
  return p.projHorizon ?? p.projNext3 ?? 0;
}

// Per-gameweek projected points for the squad, with the captain applied *each week*: the
// captain is the highest-projecting starter that gameweek and their points are doubled (that's
// how the armband works — and it can switch week to week, e.g. across a Double Gameweek). Only
// the starting XI scores in a normal week; the bench scores too *only on the one chosen Bench
// Boost gameweek* (`benchBoostGw`), since the chip fires on a single week. Returns one entry per
// GW: { gw, points (incl. captain), base (excl.), benchBoost, captainId, captainPoints }.
export function squadSeries(startingXI, bench = [], benchBoostGw = null) {
  const gws = (startingXI[0]?.pointsByGw || []).map((g) => g.gw);
  const ptOf = (p, gw) => p.pointsByGw?.find((g) => g.gw === gw)?.points || 0;
  return gws.map((gw) => {
    const isBB = benchBoostGw != null && gw === benchBoostGw;
    const scorers = isBB ? [...startingXI, ...bench] : startingXI;
    const base = scorers.reduce((s, p) => s + ptOf(p, gw), 0);
    let captainId = null;
    let captainPoints = 0;
    for (const p of startingXI) {
      const v = ptOf(p, gw);
      if (v > captainPoints) { captainPoints = v; captainId = p.id; }
    }
    return { gw, points: round(base + captainPoints), base: round(base), benchBoost: isBB, captainId, captainPoints: round(captainPoints) };
  });
}

// What the squad actually scores over the horizon, and the single objective the optimiser, the
// rating and the headline all share, so they can never disagree: the per-GW series (which
// doubles the best starter each week and adds the bench only on the Bench Boost week) summed.
export function effectiveProjection(startingXI, bench = [], benchBoostGw = null) {
  return round(squadSeries(startingXI, bench, benchBoostGw).reduce((s, g) => s + g.points, 0));
}
function available(p) {
  if (typeof p.chanceNext === 'number') return p.chanceNext > 0;
  return !['i', 's', 'u', 'n'].includes(p.status);
}

// Small, fast seeded PRNG so alternative drafts are reproducible from a seed.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Multi-start "optimal": the plain greedy only finds a local optimum, so we also run several
// jittered restarts and keep the highest-projecting *complete* squad. This is the squad shown
// as "optimal" and the benchmark the team rating is scored against.
export function buildBestDraft(scored, { budget = 100.0, attempts = 16, jitter = 0.35, lockedIds = [], benchBoostGw = null } = {}) {
  let best = buildDraft(scored, { budget, lockedIds, benchBoostGw });
  const consider = (candidate) => {
    if (candidate.complete && candidate.effectiveProjection > best.effectiveProjection) best = candidate;
  };
  // Jittered restarts escape the greedy's local optimum.
  for (let i = 1; i <= attempts; i += 1) {
    const seed = (Math.imul(i, 2654435761) ^ 0x9e3779b9) >>> 0;
    consider(buildDraft(scored, { budget, jitter, rng: mulberry32(seed), lockedIds, benchBoostGw }));
  }
  // Premium-anchored restarts: a pure greedy skips a £15m striker on value grounds, so seed a
  // build around each of the top projectors (that aren't already forced) — the effective
  // objective (XI + captain) then keeps whichever genuinely scores most. Deterministic.
  const forced = new Set(lockedIds);
  const premiums = [...scored]
    .filter((p) => available(p) && p.price > 0 && !forced.has(p.id))
    .sort((a, b) => proj(b) - proj(a))
    .slice(0, 6);
  for (const p of premiums) {
    consider(buildDraft(scored, { budget, lockedIds: [...lockedIds, p.id], benchBoostGw }));
  }
  return best;
}

// benchBoostGw: the one gameweek you intend to play Bench Boost on (from the chip strategy). On
// that week the whole bench scores, so the squad is valued as 15; every other week only the XI
// scores. Null = no Bench Boost planned in this horizon.
export function buildDraft(scored, { budget = 100.0, jitter = 0, rng = Math.random, lockedIds = [], benchBoostGw = null } = {}) {
  const pool = scored.filter((p) => available(p) && p.price > 0);

  // Perturbed selection score. jitter = 0 → true projection (the optimal squad); jitter > 0
  // → each player's rank is nudged by up to ±jitter, producing a plausible alternative.
  const jittered = new Map();
  for (const p of pool) {
    const factor = jitter > 0 ? 1 + (rng() * 2 - 1) * jitter : 1;
    jittered.set(p.id, Math.max(0, proj(p) * factor));
  }
  const score = (p) => jittered.get(p.id) ?? proj(p);

  const minPrice = {};
  for (const et of Object.keys(SQUAD)) {
    const prices = pool.filter((p) => p.elementType === Number(et)).map((p) => p.price);
    minPrice[et] = prices.length ? Math.min(...prices) : 4.0;
  }

  const need = { ...SQUAD };
  const picked = [];
  const teamCount = new Map();
  const ownedIds = new Set();
  let spend = 0;

  const totalSlots = () => Object.values(need).reduce((s, n) => s + n, 0);
  const reserveAfter = (etPicked) => {
    let reserve = 0;
    for (const et of Object.keys(need)) {
      const remaining = need[et] - (Number(et) === etPicked ? 1 : 0);
      if (remaining > 0) reserve += remaining * minPrice[et];
    }
    return reserve;
  };
  const tryAdd = (p) => {
    const et = p.elementType;
    if (need[et] <= 0) return 'position full';
    if ((teamCount.get(p.teamId) || 0) >= MAX_PER_TEAM) return `max ${MAX_PER_TEAM} from ${p.team}`;
    if (spend + p.price + reserveAfter(et) > budget + 1e-9) return 'over budget';
    picked.push(p);
    ownedIds.add(p.id);
    need[et] -= 1;
    spend = round(spend + p.price);
    teamCount.set(p.teamId, (teamCount.get(p.teamId) || 0) + 1);
    return null;
  };

  // Lock in the user's must-have players first (sourced from all scored players so a flagged
  // pick can still be forced), then build the optimal squad around them.
  const lockedSet = new Set();
  const lockedIncluded = [];
  const lockedExcluded = [];
  for (const id of lockedIds) {
    const p = scored.find((x) => x.id === id);
    if (!p) { lockedExcluded.push({ id, reason: 'not found' }); continue; }
    if (ownedIds.has(id)) continue;
    const reason = tryAdd(p);
    if (reason) lockedExcluded.push({ id, name: p.name, reason });
    else { lockedSet.add(id); lockedIncluded.push(brief(p)); }
  }

  // Only one keeper plays each week, so the backup GK should be cheap — spend the saved budget
  // on outfield. But it must be a keeper who actually *plays*: reserve the cheapest nailed
  // keeper (falling back to the cheapest if none are nailed). That guarantees the squad has at
  // least one nailed keeper, gives real cover for injuries, and scores on a Bench Boost week —
  // rather than a £4.0 bench-warmer who never returns a point. Protected from the improvement
  // pass so it stays cheap; the starting GK is optimised by the greedy fill below.
  const cheapestBackupGk = () => {
    const gks = pool.filter((p) => p.elementType === 1 && !ownedIds.has(p.id));
    const nailedGks = gks.filter((p) => p.nailed);
    return (nailedGks.length ? nailedGks : gks).sort((a, b) => a.price - b.price || proj(b) - proj(a))[0];
  };
  let backupGkId = null;
  if (need[1] >= 1) {
    const gk = cheapestBackupGk();
    if (gk && tryAdd(gk) === null) backupGkId = gk.id;
  }
  const protectedIds = new Set(lockedSet);
  if (backupGkId != null) protectedIds.add(backupGkId);

  const ranked = [...pool].sort((a, b) => score(b) - score(a));
  for (const p of ranked) {
    if (totalSlots() === 0) break;
    if (ownedIds.has(p.id)) continue;
    tryAdd(p);
  }

  improve(picked, pool, teamCount, ownedIds, budget, () => spend, (v) => { spend = v; }, score, protectedIds);
  spend = round(picked.reduce((s, p) => s + p.price, 0));

  const startingXI = pickStartingXI(picked);
  const startIds = new Set(startingXI.map((p) => p.id));
  const bench = picked.filter((p) => !startIds.has(p.id)).sort((a, b) => a.elementType - b.elementType || proj(b) - proj(a));
  // The captain is the highest-projecting starter over the horizon (their points are doubled).
  const captain = [...startingXI].sort((a, b) => proj(b) - proj(a))[0] || null;
  const vice = [...startingXI].sort((a, b) => proj(b) - proj(a))[1] || null;

  const squadProjection = round(picked.reduce((s, p) => s + proj(p), 0));
  // Per-GW points with the captain doubled each week; the bench counts only on the Bench Boost
  // gameweek.
  const series = squadSeries(startingXI, bench, benchBoostGw);
  const effective = round(series.reduce((s, g) => s + g.points, 0));
  const avgFixtureDifficulty = squadAvgDifficulty(picked);

  return {
    budget,
    benchBoostGw,
    totalCost: spend,
    remaining: round(budget - spend),
    complete: picked.length === 15,
    projectedPoints: round(startingXI.reduce((s, p) => s + proj(p), 0)),
    squadProjection,
    // The objective the rating and headline share (XI + captain, or squad + captain under BB).
    effectiveProjection: effective,
    avgFixtureDifficulty,
    // Per-gameweek points with the captain doubled each week — carries { gw, points, base,
    // captainId, captainPoints } so the stepper can move the © and double that GW's best.
    pointsByGw: series,
    value: spend > 0 ? round(squadProjection / spend) : 0,
    formation: formationOf(startingXI),
    squad: groupByPosition(picked),
    startingXI: startingXI.map(brief),
    bench: bench.map(brief),
    captain: captain ? brief(captain) : null,
    vice: vice ? brief(vice) : null,
    lockedIncluded,
    lockedExcluded,
  };
}

// Average upcoming fixture difficulty across the squad (lower = kinder run).
function squadAvgDifficulty(picked) {
  const diffs = [];
  for (const p of picked) {
    const fx = p.fixturesNext3 || [];
    if (fx.length) diffs.push(fx.reduce((s, f) => s + (f.difficulty || 3), 0) / fx.length);
    else diffs.push(3);
  }
  return diffs.length ? Math.round((diffs.reduce((s, d) => s + d, 0) / diffs.length) * 100) / 100 : null;
}

function improve(picked, pool, teamCount, ownedIds, budget, getSpend, setSpend, score, lockedSet = new Set()) {
  for (let iter = 0; iter < 30; iter += 1) {
    let best = null;
    for (let i = 0; i < picked.length; i += 1) {
      const cur = picked[i];
      if (lockedSet.has(cur.id)) continue; // never swap out a user-locked player
      const budgetRoom = budget - getSpend() + cur.price;
      const candidates = pool.filter(
        (c) => c.elementType === cur.elementType && !ownedIds.has(c.id) && c.price <= budgetRoom + 1e-9 && score(c) > score(cur)
      );
      for (const c of candidates) {
        const cCount = (teamCount.get(c.teamId) || 0) - (c.teamId === cur.teamId ? 1 : 0);
        if (cCount >= MAX_PER_TEAM) continue;
        const gain = score(c) - score(cur);
        if (!best || gain > best.gain) best = { i, cur, c, gain };
      }
    }
    if (!best) break;
    const { i, cur, c } = best;
    ownedIds.delete(cur.id);
    ownedIds.add(c.id);
    teamCount.set(cur.teamId, (teamCount.get(cur.teamId) || 0) - 1);
    teamCount.set(c.teamId, (teamCount.get(c.teamId) || 0) + 1);
    setSpend(round(getSpend() - cur.price + c.price));
    picked[i] = c;
  }
}

function pickStartingXI(squad) {
  const by = (et) => squad.filter((p) => p.elementType === et).sort((a, b) => proj(b) - proj(a));
  const gk = by(1), def = by(2), mid = by(3), fwd = by(4);

  const formations = [
    [3, 4, 3], [3, 5, 2], [4, 4, 2], [4, 3, 3], [5, 4, 1], [4, 5, 1], [5, 3, 2], [3, 3, 4],
  ];
  let best = null;
  for (const [d, m, f] of formations) {
    if (def.length < d || mid.length < m || fwd.length < f) continue;
    const xi = [gk[0], ...def.slice(0, d), ...mid.slice(0, m), ...fwd.slice(0, f)].filter(Boolean);
    if (xi.length !== 11) continue;
    const pts = xi.reduce((s, p) => s + proj(p), 0);
    if (!best || pts > best.pts) best = { xi, pts };
  }
  return best ? best.xi : [gk[0], ...def.slice(0, 4), ...mid.slice(0, 4), ...fwd.slice(0, 2)].filter(Boolean);
}

function formationOf(xi) {
  const c = { 2: 0, 3: 0, 4: 0 };
  for (const p of xi) if (c[p.elementType] != null) c[p.elementType] += 1;
  return `${c[2]}-${c[3]}-${c[4]}`;
}

function groupByPosition(squad) {
  const out = { GKP: [], DEF: [], MID: [], FWD: [] };
  for (const p of squad) out[POS_NAME[p.elementType]].push(brief(p));
  for (const k of Object.keys(out)) out[k].sort((a, b) => b.projHorizon - a.projHorizon);
  return out;
}

function brief(p) {
  return {
    id: p.id,
    name: p.name,
    team: p.team,
    teamId: p.teamId,
    position: p.position,
    price: p.price,
    projNext: p.projNext,
    projNext3: p.projNext3,
    projHorizon: p.projHorizon ?? p.projNext3,
    selectedBy: p.selectedBy,
    onPens: p.onPens,
    minutes: p.minutes || 0,
    nailed: p.nailed || false,
    // Per-gameweek projection so the Draft tab can step through GWs (a DGW is summed, a BGW 0).
    pointsByGw: p.pointsByGw || [],
  };
}

function round(n) {
  return Math.round(n * 100) / 100;
}

export { SQUAD };
