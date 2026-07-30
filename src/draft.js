// Draft / squad builder.
//
// Picks a full 15-man FPL squad that maximises projected points over the chosen horizon,
// subject to the real FPL rules: exactly 2 GKP / 5 DEF / 5 MID / 3 FWD, a budget (default
// £100.0m), and no more than 3 players from any single club. Exact optimisation is an
// integer program; for advisory use we run a budget-aware greedy that reserves enough money
// to fill remaining slots, then improve with swaps. Deterministic and unit-tested.

const SQUAD = { 1: 2, 2: 5, 3: 5, 4: 3 }; // elementType -> count
const POS_NAME = { 1: 'GKP', 2: 'DEF', 3: 'MID', 4: 'FWD' };
const MAX_PER_TEAM = 3;

function proj(p) {
  return p.projHorizon ?? p.projNext3 ?? 0;
}
function available(p) {
  if (typeof p.chanceNext === 'number') return p.chanceNext > 0;
  return !['i', 's', 'u', 'n'].includes(p.status);
}

export function buildDraft(scored, { budget = 100.0 } = {}) {
  const pool = scored.filter((p) => available(p) && p.price > 0);

  // Cheapest available price per position — used to reserve budget for unfilled slots.
  const minPrice = {};
  for (const et of Object.keys(SQUAD)) {
    const prices = pool.filter((p) => p.elementType === Number(et)).map((p) => p.price);
    minPrice[et] = prices.length ? Math.min(...prices) : 4.0;
  }

  const need = { ...SQUAD };
  const picked = [];
  const teamCount = new Map();
  let spend = 0;

  // Consider players by projected points (best first); accept when the pick keeps the rest
  // of the squad affordable and respects the per-club cap.
  const ranked = [...pool].sort((a, b) => proj(b) - proj(a));

  const totalSlots = () => Object.values(need).reduce((s, n) => s + n, 0);
  const reserveAfter = (etPicked) => {
    // Minimum cost to fill every remaining slot except one of etPicked (which we're filling).
    let reserve = 0;
    for (const et of Object.keys(need)) {
      const remaining = need[et] - (Number(et) === etPicked ? 1 : 0);
      if (remaining > 0) reserve += remaining * minPrice[et];
    }
    return reserve;
  };

  for (const p of ranked) {
    if (totalSlots() === 0) break;
    const et = p.elementType;
    if (need[et] <= 0) continue;
    if ((teamCount.get(p.teamId) || 0) >= MAX_PER_TEAM) continue;
    // Must still afford the cheapest fills for all other remaining slots.
    if (spend + p.price + reserveAfter(et) > budget + 1e-9) continue;

    picked.push(p);
    need[et] -= 1;
    spend = round(spend + p.price);
    teamCount.set(p.teamId, (teamCount.get(p.teamId) || 0) + 1);
  }

  // Improvement pass: try to spend leftover budget upgrading the weakest picks.
  improve(picked, pool, teamCount, budget, () => spend, (v) => { spend = v; }, need);
  spend = round(picked.reduce((s, p) => s + p.price, 0));

  const startingXI = pickStartingXI(picked);
  const startIds = new Set(startingXI.map((p) => p.id));
  const bench = picked.filter((p) => !startIds.has(p.id)).sort((a, b) => a.elementType - b.elementType || proj(b) - proj(a));
  const captain = [...startingXI].sort((a, b) => b.projNext - a.projNext)[0] || null;
  const vice = [...startingXI].sort((a, b) => b.projNext - a.projNext)[1] || null;

  return {
    budget,
    totalCost: spend,
    remaining: round(budget - spend),
    complete: picked.length === 15,
    projectedPoints: round(startingXI.reduce((s, p) => s + proj(p), 0)),
    formation: formationOf(startingXI),
    squad: groupByPosition(picked),
    startingXI: startingXI.map(brief),
    bench: bench.map(brief),
    captain: captain ? brief(captain) : null,
    vice: vice ? brief(vice) : null,
  };
}

// Greedy upgrade: for each pick (cheapest-impact first) see if a same-position, affordable,
// team-legal, unowned player raises projected points; take the biggest single gain, repeat.
function improve(picked, pool, teamCount, budget, getSpend, setSpend) {
  const ownedIds = new Set(picked.map((p) => p.id));
  for (let iter = 0; iter < 30; iter += 1) {
    let best = null;
    for (let i = 0; i < picked.length; i += 1) {
      const cur = picked[i];
      const budgetRoom = budget - getSpend() + cur.price;
      const candidates = pool.filter(
        (c) => c.elementType === cur.elementType && !ownedIds.has(c.id) && c.price <= budgetRoom + 1e-9 && proj(c) > proj(cur)
      );
      for (const c of candidates) {
        // Respect per-club cap (account for removing cur from its club).
        const cCount = (teamCount.get(c.teamId) || 0) - (c.teamId === cur.teamId ? 1 : 0);
        if (cCount >= MAX_PER_TEAM) continue;
        const gain = proj(c) - proj(cur);
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

// Best legal starting XI: 1 GKP, >=3 DEF, >=1 FWD, 11 total, maximising projected points.
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
    position: p.position,
    price: p.price,
    projNext: p.projNext,
    projNext3: p.projNext3,
    projHorizon: p.projHorizon ?? p.projNext3,
    selectedBy: p.selectedBy,
    onPens: p.onPens,
  };
}

function round(n) {
  return Math.round(n * 100) / 100;
}

export { SQUAD };
