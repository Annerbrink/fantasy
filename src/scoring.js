// Per-player projected-points model.
//
// FPL gives us several forward-looking and backward-looking signals. We blend them into a
// single expected-points-per-appearance figure, then weight each of a player's upcoming
// fixtures by difficulty to project the next 1 and next 3 gameweeks. The model is a
// transparent heuristic (not a black box): every term is documented so the advice can be
// explained to the user rather than asserted.

import { teamFixturesFrom, difficultyMultiplier } from './fdr.js';

const POS = { 1: 'GKP', 2: 'DEF', 3: 'MID', 4: 'FWD' };

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

// How likely the player is to feature next round, from FPL's availability signals.
// status: a=available, d=doubtful, i=injured, s=suspended, u=unavailable, n=not in squad.
export function availabilityFactor(player) {
  const chance = player.chance_of_playing_next_round;
  if (typeof chance === 'number') return Math.max(0, Math.min(1, chance / 100));
  switch (player.status) {
    case 'a':
      return 1;
    case 'd':
      return 0.5; // doubtful with no explicit percentage
    case 'i':
    case 's':
    case 'u':
    case 'n':
      return 0;
    default:
      return 1;
  }
}

// Blended base expectation for a single appearance, before fixtures.
// - ep_next: FPL's own model for next-GW points (strong signal, present even in pre-season)
// - form: recent points per game (0 in pre-season, dominant once the season is live)
// - points_per_game: season average (carried from last season until GW1 completes)
// Weights are redistributed across whichever signals are actually present, so the model
// degrades gracefully in pre-season when form and live xG are still zero.
export function baseExpectation(player) {
  const signals = [];
  const ep = num(player.ep_next);
  const form = num(player.form);
  const ppg = num(player.points_per_game);
  if (ep > 0) signals.push([ep, 0.5]);
  if (form > 0) signals.push([form, 0.3]);
  if (ppg > 0) signals.push([ppg, 0.25]);
  if (signals.length === 0) return 0;
  const totalW = signals.reduce((s, [, w]) => s + w, 0);
  return signals.reduce((s, [v, w]) => s + v * w, 0) / totalW;
}

// Underlying-numbers nudge: expected goal involvements per 90 reward players who create
// chances even when their points haven't landed yet. Small, capped bonus.
function underlyingBonus(player) {
  const xgi90 = num(player.expected_goal_involvements_per_90);
  return Math.min(xgi90 * 0.6, 1.2);
}

// Project a player over a set of upcoming fixtures. Each fixture contributes
// base * difficultyMultiplier; a Double Gameweek naturally contributes twice, a Blank zero.
function projectOverFixtures(player, fixtures) {
  const base = baseExpectation(player) + underlyingBonus(player);
  const avail = availabilityFactor(player);
  let total = 0;
  for (const fx of fixtures) {
    total += base * difficultyMultiplier(fx.difficulty, fx.home);
  }
  return total * avail;
}

// Score every player and return an enriched, sortable list. `fixtures` is the raw FPL
// fixtures array; `targetGw` is the gameweek we're planning for.
export function scorePlayers(bootstrap, fixtures, targetGw) {
  const teamById = new Map(bootstrap.teams.map((t) => [t.id, t]));
  return bootstrap.elements.map((p) => {
    const next1 = teamFixturesFrom(fixtures, p.team, targetGw, 1);
    const next3 = teamFixturesFrom(fixtures, p.team, targetGw, 3);
    const projNext = projectOverFixtures(p, next1);
    const projNext3 = projectOverFixtures(p, next3);
    const price = p.now_cost / 10;
    return {
      id: p.id,
      name: p.web_name,
      team: teamById.get(p.team)?.short_name || '',
      teamId: p.team,
      position: POS[p.element_type],
      elementType: p.element_type,
      price,
      status: p.status,
      news: p.news || '',
      chanceNext: p.chance_of_playing_next_round,
      selectedBy: num(p.selected_by_percent),
      form: num(p.form),
      pointsPerGame: num(p.points_per_game),
      epNext: num(p.ep_next),
      totalPoints: p.total_points,
      xgi90: num(p.expected_goal_involvements_per_90),
      onPens: p.penalties_order === 1,
      onSetPieces: p.corners_and_indirect_freekicks_order === 1 || p.direct_freekicks_order === 1,
      projNext: round(projNext),
      projNext3: round(projNext3),
      // Value = projected points over the next 3 GWs per £m — the transfer/watchlist metric.
      value: price > 0 ? round(projNext3 / price) : 0,
      fixturesNext3: next3,
    };
  });
}

function round(n) {
  return Math.round(n * 100) / 100;
}

// Best available players in a position, ranked by 3-GW projection, optionally under a price
// cap and excluding players already owned. Used by the transfer engine and the watchlist.
export function topByPosition(scored, elementType, { maxPrice = Infinity, excludeIds = new Set(), limit = 10 } = {}) {
  return scored
    .filter(
      (p) =>
        p.elementType === elementType &&
        p.price <= maxPrice &&
        !excludeIds.has(p.id) &&
        availabilityFactorFromScored(p) > 0
    )
    .sort((a, b) => b.projNext3 - a.projNext3)
    .slice(0, limit);
}

// Availability check on an already-scored row (status kept for this purpose).
function availabilityFactorFromScored(p) {
  if (typeof p.chanceNext === 'number') return p.chanceNext / 100;
  return p.status === 'i' || p.status === 's' || p.status === 'u' || p.status === 'n' ? 0 : 1;
}

export { POS };
