// Transfer recommendation engine.
//
// Given a scored player universe and the manager's current squad (with selling prices, bank
// and free transfers), find the moves that add the most projected points over the next 3
// gameweeks — accounting for the –4 hit when going beyond the free-transfer allowance.
//
// Everything here is pure: `scored` comes from scoring.js, `squad` is normalised upstream
// from the FPL picks endpoint, so the engine is fully unit-testable offline.

import { topByPosition } from './scoring.js';

const HIT_COST = 4; // points deducted per extra transfer beyond the free allowance

// Build a single best swap for one owned player: the highest-projected affordable
// replacement in the same position that we don't already own. `budgetForSwap` is the bank
// plus the money freed by selling the outgoing player.
function bestReplacement(scored, ownedPlayer, budgetForSwap, ownedIds) {
  const candidates = topByPosition(scored, ownedPlayer.elementType, {
    maxPrice: budgetForSwap,
    excludeIds: ownedIds,
    limit: 5,
  });
  const best = candidates[0];
  if (!best) return null;
  const gain = round(best.projNext3 - ownedPlayer.projNext3);
  return { out: ownedPlayer, in: best, gain };
}

// Rank single-transfer suggestions across the whole squad.
export function suggestTransfers(scored, squad, { limit = 6 } = {}) {
  const ownedIds = new Set(squad.players.map((p) => p.id));
  const bank = squad.bank ?? 0; // in £m
  const freeTransfers = squad.freeTransfers ?? 1;

  const scoredById = new Map(scored.map((p) => [p.id, p]));
  // Enrich owned players with their live projection and selling price.
  const owned = squad.players
    .map((p) => {
      const s = scoredById.get(p.id);
      if (!s) return null;
      return { ...s, sellingPrice: p.sellingPrice ?? s.price };
    })
    .filter(Boolean);

  const swaps = [];
  for (const op of owned) {
    const budget = round(bank + op.sellingPrice);
    const swap = bestReplacement(scored, op, budget, ownedIds);
    if (swap && swap.gain > 0) swaps.push(swap);
  }

  swaps.sort((a, b) => b.gain - a.gain);

  // Net gain after hit cost: the first `freeTransfers` moves are free, the rest cost 4 each.
  const ranked = swaps.slice(0, limit).map((s, i) => {
    const hit = i < freeTransfers ? 0 : HIT_COST;
    return {
      out: brief(s.out),
      in: brief(s.in),
      grossGain: s.gain,
      hit,
      netGain: round(s.gain - hit),
      reason: explain(s.out, s.in),
    };
  });

  // A combined move: the two best non-overlapping swaps (different positions or players).
  const doubleMove = buildDoubleMove(swaps, freeTransfers);

  return {
    bank,
    freeTransfers,
    single: ranked,
    double: doubleMove,
    // If nothing beats the current squad, say so explicitly rather than inventing a move.
    hold: ranked.length === 0,
  };
}

function buildDoubleMove(swaps, freeTransfers) {
  if (swaps.length < 2) return null;
  const first = swaps[0];
  const second = swaps.find(
    (s) => s.out.id !== first.out.id && s.in.id !== first.in.id
  );
  if (!second) return null;
  const gross = round(first.gain + second.gain);
  const hits = Math.max(0, 2 - freeTransfers) * HIT_COST;
  return {
    moves: [
      { out: brief(first.out), in: brief(first.in) },
      { out: brief(second.out), in: brief(second.in) },
    ],
    grossGain: gross,
    hit: hits,
    netGain: round(gross - hits),
  };
}

// When we don't know the manager's squad yet (pre-season, or no team set), fall back to a
// value watchlist: the best projected players per position to build or plan around.
export function watchlist(scored) {
  return {
    GKP: topByPosition(scored, 1, { limit: 5 }).map(brief),
    DEF: topByPosition(scored, 2, { limit: 8 }).map(brief),
    MID: topByPosition(scored, 3, { limit: 8 }).map(brief),
    FWD: topByPosition(scored, 4, { limit: 6 }).map(brief),
  };
}

function explain(out, inn) {
  const bits = [];
  bits.push(`${inn.name} projects ${round(inn.projNext3 - out.projNext3)} pts more than ${out.name} over the next 3 GWs`);
  if (out.status !== 'a') bits.push(`${out.name} is flagged (${out.news || out.status})`);
  if (inn.onPens) bits.push('on penalties');
  if (inn.form > out.form) bits.push(`better form (${inn.form} vs ${out.form})`);
  // Price-change timing.
  if (inn.priceTrend?.direction === 'rising') bits.push(`${inn.name} is rising soon — buy now`);
  if (out.priceTrend?.direction === 'falling') bits.push(`${out.name} is falling — sell before the drop`);
  return bits.join('; ');
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
    form: p.form,
    value: p.value,
    status: p.status,
    news: p.news,
    onPens: p.onPens,
    selectedBy: p.selectedBy,
    priceTrend: p.priceTrend || null,
    xgi90: p.advanced?.xgi90 ?? null,
  };
}

function round(n) {
  return Math.round(n * 100) / 100;
}
