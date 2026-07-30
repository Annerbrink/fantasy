// Per-player upcoming schedule: which teams they face over the next few gameweeks, home/away,
// fixture difficulty, and the model's projected points for each week. Powers the "click a
// player" popup. Pure and unit-testable; reuses the same scoring path as the rest of the app so
// the per-GW points match the draft stepper exactly.

import { teamFixturesFrom, indexTeams } from './fdr.js';
import { projectByGameweek, minutesReliability } from './scoring.js';
import { softOpponentBonuses } from './expert-notes.js';

const POS = { 1: 'GKP', 2: 'DEF', 3: 'MID', 4: 'FWD' };

// Build one manager-facing schedule for a single player. Groups fixtures by gameweek, so a
// Double Gameweek lists two opponents and a Blank lists none (points 0).
export function buildPlayerSchedule(bootstrap, fixtures, targetGw, playerId, horizon = 6) {
  const el = bootstrap.elements.find((p) => p.id === Number(playerId));
  if (!el) return null;

  const teamById = indexTeams(bootstrap.teams);
  // League maxima for minutes reliability — computed exactly as scorePlayers does.
  const refs = {
    maxStarts: Math.max(0, ...bootstrap.elements.map((p) => p.starts || 0)),
    maxMinutes: Math.max(0, ...bootstrap.elements.map((p) => p.minutes || 0)),
  };
  const reliability = minutesReliability(el, refs);
  const softBonus = softOpponentBonuses(bootstrap.teams);

  // Per-GW points (a DGW is summed, a BGW is 0) — identical to the projection used everywhere.
  const pointsByGw = projectByGameweek(el, fixtures, targetGw, horizon, reliability, softBonus);
  const pointsFor = (gw) => pointsByGw.find((g) => g.gw === gw)?.points ?? 0;

  // Fixtures over the window, grouped into one entry per gameweek.
  const fx = teamFixturesFrom(fixtures, el.team, targetGw, horizon);
  const byGw = new Map();
  for (let gw = targetGw; gw < targetGw + horizon; gw += 1) {
    byGw.set(gw, { gw, points: pointsFor(gw), fixtures: [] });
  }
  for (const f of fx) {
    const group = byGw.get(f.gw);
    if (!group) continue;
    group.fixtures.push({
      opponent: teamById.get(f.opponent)?.short_name || String(f.opponent),
      home: f.home,
      difficulty: f.difficulty ?? 3,
    });
  }

  return {
    id: el.id,
    name: el.web_name,
    team: teamById.get(el.team)?.short_name || '',
    position: POS[el.element_type],
    price: el.now_cost / 10,
    horizon,
    total: Math.round(pointsByGw.reduce((s, g) => s + g.points, 0) * 100) / 100,
    schedule: [...byGw.values()].sort((a, b) => a.gw - b.gw),
  };
}
