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

// Underlying-numbers nudge: reward players whose Opta-derived stats show they create/
// prevent chances even when points haven't landed yet. All small and capped — a tie-breaker,
// not a rewrite of the projection. Uses expected goal involvements, plus a light ICT-index
// and defensive-contribution touch (the latter matters for the new defensive scoring).
function underlyingBonus(player) {
  const xgi90 = num(player.expected_goal_involvements_per_90);
  const ict = num(player.ict_index); // season ICT (0..~500), normalised small
  const defCon90 = num(player.defensive_contribution_per_90);
  const attack = Math.min(xgi90 * 0.6, 1.2);
  const ictNudge = Math.min(ict / 1500, 0.4); // ~0.4 max for elite ICT
  // Defensive Contributions are a major, repeatable points source this season — weight them.
  const defNudge = Math.min(defCon90 / 25, 0.6);
  // "Multiple routes to points": penalty and set-piece takers carry a higher floor.
  const onPens = player.penalties_order === 1;
  const onSetPieces = player.corners_and_indirect_freekicks_order === 1 || player.direct_freekicks_order === 1;
  const setPieceBonus = (onPens ? 0.5 : 0) + (onSetPieces ? 0.25 : 0);
  return attack + ictNudge + defNudge + setPieceBonus;
}

// Opta-derived advanced stats carried on each scored row (all free from bootstrap-static).
function advancedStats(player) {
  return {
    xg: num(player.expected_goals),
    xa: num(player.expected_assists),
    xgi: num(player.expected_goal_involvements),
    xg90: num(player.expected_goals_per_90),
    xa90: num(player.expected_assists_per_90),
    xgi90: num(player.expected_goal_involvements_per_90),
    ict: num(player.ict_index),
    influence: num(player.influence),
    creativity: num(player.creativity),
    threat: num(player.threat),
    defCon: num(player.defensive_contribution),
    defCon90: num(player.defensive_contribution_per_90),
    starts: player.starts || 0,
    minutes: player.minutes || 0,
  };
}

// Minutes reliability ("nailed-ness"): FPL points require playing time, so a limited-minutes
// player should not project like a regular starter with the same per-appearance rates. From a
// blend of start-share and minutes-share (normalised to the league maxima, so it scales with
// the season and works pre-season off last-season totals). `refs` = { maxStarts, maxMinutes }.
// Returns 0.35..1.0; neutral (1) when there is no minutes data at all.
export function minutesReliability(player, refs) {
  const maxStarts = refs?.maxStarts || 0;
  const maxMinutes = refs?.maxMinutes || 0;
  if (maxStarts === 0 && maxMinutes === 0) return 1;
  const startShare = maxStarts > 0 ? (player.starts || 0) / maxStarts : 0;
  const minShare = maxMinutes > 0 ? (player.minutes || 0) / maxMinutes : 0;
  const share = 0.6 * startShare + 0.4 * minShare;
  return 0.35 + 0.65 * Math.max(0, Math.min(1, share));
}

// Project a player over a set of upcoming fixtures. Each fixture contributes
// base * difficultyMultiplier; a Double Gameweek naturally contributes twice, a Blank zero.
// `reliability` scales the whole projection by expected playing time.
function projectOverFixtures(player, fixtures, reliability = 1) {
  const base = (baseExpectation(player) + underlyingBonus(player)) * reliability;
  const avail = availabilityFactor(player);
  let total = 0;
  for (const fx of fixtures) {
    total += base * difficultyMultiplier(fx.difficulty, fx.home);
  }
  return total * avail;
}

// Per-gameweek projection: one point total per GW across the window (a Double Gameweek sums
// both fixtures, a Blank is 0). Powers the points-over-gameweeks chart.
export function projectByGameweek(player, fixtures, targetGw, window = 6, reliability = 1) {
  const base = (baseExpectation(player) + underlyingBonus(player)) * reliability;
  const avail = availabilityFactor(player);
  const fx = teamFixturesFrom(fixtures, player.team, targetGw, window);
  const out = [];
  for (let gw = targetGw; gw < targetGw + window; gw += 1) {
    const inGw = fx.filter((f) => f.gw === gw);
    const points = inGw.reduce((s, f) => s + base * difficultyMultiplier(f.difficulty, f.home), 0) * avail;
    out.push({ gw, points: Math.round(points * 100) / 100 });
  }
  return out;
}

// Sum several players' per-gameweek projections into one squad-level series.
export function sumPointsByGw(players) {
  const byGw = new Map();
  for (const p of players) {
    for (const { gw, points } of p.pointsByGw || []) {
      byGw.set(gw, (byGw.get(gw) || 0) + points);
    }
  }
  return [...byGw.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([gw, points]) => ({ gw, points: Math.round(points * 100) / 100 }));
}

// Score every player and return an enriched, sortable list. `fixtures` is the raw FPL
// fixtures array; `targetGw` is the gameweek we're planning for.
export function scorePlayers(bootstrap, fixtures, targetGw, horizon = 0) {
  const teamById = new Map(bootstrap.teams.map((t) => [t.id, t]));
  // League maxima for the minutes-reliability normalisation (computed once).
  const refs = {
    maxStarts: Math.max(0, ...bootstrap.elements.map((p) => p.starts || 0)),
    maxMinutes: Math.max(0, ...bootstrap.elements.map((p) => p.minutes || 0)),
  };
  return bootstrap.elements.map((p) => {
    const reliability = minutesReliability(p, refs);
    const next1 = teamFixturesFrom(fixtures, p.team, targetGw, 1);
    const next3 = teamFixturesFrom(fixtures, p.team, targetGw, 3);
    const projNext = projectOverFixtures(p, next1, reliability);
    const projNext3 = projectOverFixtures(p, next3, reliability);
    // Optional longer horizon (e.g. the draft builder projects several GWs ahead).
    const projHorizon = horizon > 0 ? projectOverFixtures(p, teamFixturesFrom(fixtures, p.team, targetGw, horizon), reliability) : projNext3;
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
      projHorizon: round(projHorizon),
      // Per-gameweek projection for the points graph (draft horizon, else a 6-GW default).
      pointsByGw: projectByGameweek(p, fixtures, targetGw, horizon > 0 ? horizon : 6, reliability),
      // Opta-derived advanced stats (free from bootstrap-static).
      advanced: advancedStats(p),
      // Minutes reliability ("nailed-ness") — how much playing time weights the projection.
      reliability: Math.round(reliability * 100) / 100,
      nailed: reliability >= 0.8,
      minutes: p.minutes || 0,
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
