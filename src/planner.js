// Multi-week transfer planner.
//
// Given your squad and per-gameweek projections over a horizon, build a patient week-by-week
// roadmap: the best single upgrade to make each week (1 free transfer per week, so no hits),
// best moves first so their benefit is captured over as many gameweeks as possible. Also
// flags the moves worth taking a -4 hit for now. Pure and unit-testable.

function round(n) { return Math.round(n * 100) / 100; }
function avail(p) {
  if (typeof p.chanceNext === 'number') return p.chanceNext > 0;
  return !['i', 's', 'u', 'n'].includes(p.status);
}
function brief(p) {
  return { id: p.id, name: p.name, team: p.team, position: p.position, price: p.price, projHorizon: p.projHorizon };
}

// `squad` = { players:[{id, sellingPrice}], bank (£m), freeTransfers }. `scored` rows must
// carry pointsByGw over at least `horizon` gameweeks (call scorePlayers with that horizon).
export function planTransfers(scored, squad, { horizon = 5, weeks = 4 } = {}) {
  const byId = new Map(scored.map((p) => [p.id, p]));
  const ownedIds = new Set(squad.players.map((p) => p.id));
  const bank = squad.bank ?? 0;
  const freeTransfers = squad.freeTransfers ?? 1;

  const owned = squad.players
    .map((p) => { const s = byId.get(p.id); return s ? { ...s, sellingPrice: p.sellingPrice ?? s.price } : null; })
    .filter(Boolean);

  const weeklyGain = (inn, out) => {
    const g = [];
    for (let j = 0; j < horizon; j += 1) {
      g.push(round((inn.pointsByGw?.[j]?.points || 0) - (out.pointsByGw?.[j]?.points || 0)));
    }
    return g;
  };

  // Best affordable same-position replacement for each owned player, ranked by horizon gain.
  const swaps = [];
  for (const op of owned) {
    const budget = round(bank + op.sellingPrice);
    const best = scored
      .filter((c) => c.elementType === op.elementType && !ownedIds.has(c.id) && c.price <= budget && avail(c))
      .sort((a, b) => (b.projHorizon || 0) - (a.projHorizon || 0))[0];
    if (!best) continue;
    const weekly = weeklyGain(best, op);
    const totalGain = round(weekly.reduce((s, x) => s + x, 0));
    if (totalGain > 0) swaps.push({ out: brief(op), in: brief(best), weekly, totalGain });
  }
  swaps.sort((a, b) => b.totalGain - a.totalGain);

  // Sequence non-overlapping swaps one per week (a free transfer each week → no hits).
  const usedOut = new Set(); const usedIn = new Set(); const roadmap = [];
  for (const s of swaps) {
    if (roadmap.length >= weeks) break;
    if (usedOut.has(s.out.id) || usedIn.has(s.in.id)) continue;
    const weekIdx = roadmap.length; // 0 = this GW, 1 = next, ...
    const realizedGain = round(s.weekly.slice(weekIdx).reduce((a, x) => a + x, 0)); // benefit from when it's made
    usedOut.add(s.out.id); usedIn.add(s.in.id);
    roadmap.push({ weekOffset: weekIdx, out: s.out, in: s.in, realizedGain, fullHorizonGain: s.totalGain });
  }

  // Moves worth an immediate -4 hit: their gain if made THIS week (from GW0) beats the hit,
  // even though the patient plan schedules them later.
  const hitWorthy = swaps
    .map((s) => ({ out: s.out, in: s.in, nowGain: round(s.weekly.reduce((a, x) => a + x, 0)) }))
    .filter((s) => s.nowGain - 4 > 1)
    .slice(0, 3);

  return { hasSquad: true, freeTransfers, bank, weeks, horizon, roadmap, hitWorthy };
}
