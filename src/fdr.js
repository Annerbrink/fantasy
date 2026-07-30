// Fixture analysis: which gameweek we're targeting, per-team upcoming fixture difficulty,
// and detection of Double (DGW) and Blank (BGW) gameweeks. All functions are pure — they
// take already-fetched `events`, `teams` and `fixtures` and return plain data — so they
// run identically in the Workers runtime and in offline unit tests.

// Determine the gameweek to plan for. During live play that's the current GW; between
// deadlines (and in pre-season) it's the next GW. Falls back to the first unfinished event.
export function resolveTargetGw(events) {
  const current = events.find((e) => e.is_current && !e.finished);
  if (current) return current.id;
  const next = events.find((e) => e.is_next);
  if (next) return next.id;
  const unfinished = events.find((e) => !e.finished);
  return unfinished ? unfinished.id : events[events.length - 1].id;
}

// Map team id -> team object for quick lookup.
export function indexTeams(teams) {
  const byId = new Map();
  for (const t of teams) byId.set(t.id, t);
  return byId;
}

// All fixtures for a team from `fromGw` onward, annotated from that team's perspective:
// difficulty (FPL's own 1=easy .. 5=hard), opponent, home/away.
export function teamFixturesFrom(fixtures, teamId, fromGw, count = 6) {
  const out = [];
  for (const f of fixtures) {
    if (f.event == null || f.event < fromGw) continue;
    if (f.team_h === teamId) {
      out.push({ gw: f.event, opponent: f.team_a, home: true, difficulty: f.team_h_difficulty });
    } else if (f.team_a === teamId) {
      out.push({ gw: f.event, opponent: f.team_h, home: false, difficulty: f.team_a_difficulty });
    }
  }
  out.sort((a, b) => a.gw - b.gw || (a.home === b.home ? 0 : a.home ? -1 : 1));
  // Keep fixtures spanning the next `count` gameweeks (a DGW contributes two rows).
  return out.filter((fx) => fx.gw < fromGw + count);
}

// Turn a difficulty (1..5) into an expected-points multiplier: easier fixtures lift a
// player's projection, harder ones suppress it. Home carries a small extra bump.
export function difficultyMultiplier(difficulty, home) {
  const d = typeof difficulty === 'number' ? difficulty : 3;
  const base = 1 + (3 - d) * 0.09; // diff 1 -> 1.18, diff 3 -> 1.0, diff 5 -> 0.82
  return base * (home ? 1.03 : 0.97);
}

// Average difficulty of a team's next `count` gameweeks (lower = kinder run).
export function fixtureRunScore(fixtures, teamId, fromGw, count = 5) {
  const fx = teamFixturesFrom(fixtures, teamId, fromGw, count);
  if (fx.length === 0) return { avg: null, fixtures: [] };
  const avg = fx.reduce((s, f) => s + (f.difficulty || 3), 0) / fx.length;
  return { avg: Math.round(avg * 100) / 100, fixtures: fx };
}

// Count fixtures per team within a specific gameweek to spot doubles/blanks.
export function fixturesPerTeamInGw(fixtures, gw) {
  const counts = new Map();
  for (const f of fixtures) {
    if (f.event !== gw) continue;
    counts.set(f.team_h, (counts.get(f.team_h) || 0) + 1);
    counts.set(f.team_a, (counts.get(f.team_a) || 0) + 1);
  }
  return counts;
}

// --- Team-strength mismatch analysis -------------------------------------------------
// "Good teams facing bad ones": combine each team's attacking strength with how easy their
// fixture is (FPL's own difficulty, which encodes the opponent's strength). Strengths are
// normalised across the league to 0..1 so this works whether the API exposes the 1-5 scale
// (pre-season) or the fine 1000-1400 scale (in-season).

function strengthValue(team, venue) {
  // Prefer the fine attack rating, then the overall venue rating, then the 1-5 `strength`.
  const attack = venue === 'home' ? team.strength_attack_home : team.strength_attack_away;
  const overall = venue === 'home' ? team.strength_overall_home : team.strength_overall_away;
  return attack || overall || team.strength || 3;
}

export function normalizeTeamStrength(teams) {
  const homeVals = teams.map((t) => strengthValue(t, 'home'));
  const awayVals = teams.map((t) => strengthValue(t, 'away'));
  const span = (vals) => {
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    return { min, range: max - min || 1 };
  };
  const h = span(homeVals);
  const a = span(awayVals);
  const map = new Map();
  for (const t of teams) {
    map.set(t.id, {
      home: (strengthValue(t, 'home') - h.min) / h.range,
      away: (strengthValue(t, 'away') - a.min) / a.range,
    });
  }
  return map;
}

// Ease of a fixture (0 hardest .. 1 easiest) from FPL's 1-5 difficulty.
function ease(difficulty) {
  const d = typeof difficulty === 'number' ? difficulty : 3;
  return (5 - d) / 4;
}

// Per-side attacking opportunity for one fixture: strong attack (0..1) meeting an easy
// fixture (0..1). Weighted toward the fixture ease, nudged by the attacker's strength.
function opportunity(strengthNorm, difficulty) {
  return Math.round((ease(difficulty) * 0.7 + strengthNorm * 0.3) * 1000) / 1000;
}

// Rank upcoming gameweeks by aggregate attacking opportunity, and surface the standout
// "good team vs bad team" fixtures in each — the raw material for chip timing and captaincy.
export function gameweekAttackIndex(fixtures, teams, fromGw, horizon = 8) {
  const teamById = indexTeams(teams);
  const strength = normalizeTeamStrength(teams);
  const perGw = new Map();

  for (const f of fixtures) {
    if (f.event == null || f.event < fromGw || f.event >= fromGw + horizon) continue;
    const entries = [
      { teamId: f.team_h, oppId: f.team_a, home: true, diff: f.team_h_difficulty, s: strength.get(f.team_h)?.home ?? 0.5 },
      { teamId: f.team_a, oppId: f.team_h, home: false, diff: f.team_a_difficulty, s: strength.get(f.team_a)?.away ?? 0.5 },
    ];
    for (const e of entries) {
      const opp = opportunity(e.s, e.diff);
      const gw = perGw.get(f.event) || { gw: f.event, index: 0, fixtures: [] };
      gw.index = Math.round((gw.index + opp) * 1000) / 1000;
      gw.fixtures.push({
        team: teamById.get(e.teamId)?.short_name || String(e.teamId),
        teamId: e.teamId,
        opponent: teamById.get(e.oppId)?.short_name || String(e.oppId),
        home: e.home,
        difficulty: e.diff,
        opportunity: opp,
      });
      perGw.set(f.event, gw);
    }
  }

  return [...perGw.values()]
    .map((g) => ({ ...g, fixtures: g.fixtures.sort((a, b) => b.opportunity - a.opportunity).slice(0, 5) }))
    .sort((a, b) => a.gw - b.gw);
}

// Per-team outlook over the next N gameweeks: average difficulty and total attacking
// opportunity, so we can rank teams with the kindest runs (buy) vs the toughest (avoid/sell).
export function teamFixtureOutlook(fixtures, teams, fromGw, n = 5) {
  const strength = normalizeTeamStrength(teams);
  const teamById = indexTeams(teams);
  const out = teams.map((t) => {
    const fx = teamFixturesFrom(fixtures, t.id, fromGw, n);
    const played = fx.length;
    const avgDiff = played ? fx.reduce((s, f) => s + (f.difficulty || 3), 0) / played : null;
    const oppScore = fx.reduce((s, f) => s + opportunity((f.home ? strength.get(t.id)?.home : strength.get(t.id)?.away) ?? 0.5, f.difficulty), 0);
    return {
      team: t.short_name,
      teamId: t.id,
      games: played,
      avgDifficulty: avgDiff != null ? Math.round(avgDiff * 100) / 100 : null,
      attackScore: Math.round(oppScore * 100) / 100,
      fixtures: fx.map((f) => ({
        gw: f.gw,
        opp: teamById.get(f.opponent)?.short_name || String(f.opponent),
        home: f.home,
        difficulty: f.difficulty,
      })),
    };
  }).filter((t) => t.games > 0);

  const best = [...out].sort((a, b) => b.attackScore - a.attackScore).slice(0, 6);
  const tough = [...out].sort((a, b) => (b.avgDifficulty || 0) - (a.avgDifficulty || 0)).slice(0, 6);
  return { best, tough };
}

// Scan a window of upcoming gameweeks and flag any that are doubles or blanks for some
// teams — the raw material for Bench Boost / Triple Captain / Free Hit timing advice.
export function detectDgwBgw(fixtures, teams, fromGw, horizon = 8) {
  const teamIds = teams.map((t) => t.id);
  const report = [];
  for (let gw = fromGw; gw < fromGw + horizon; gw += 1) {
    const counts = fixturesPerTeamInGw(fixtures, gw);
    const doubles = teamIds.filter((id) => (counts.get(id) || 0) >= 2);
    const blanks = teamIds.filter((id) => (counts.get(id) || 0) === 0);
    // A gameweek where every team plays exactly once is normal — skip it.
    const anyScheduled = teamIds.some((id) => (counts.get(id) || 0) > 0);
    if (anyScheduled && (doubles.length || blanks.length)) {
      report.push({ gw, doubleTeams: doubles, blankTeams: blanks });
    }
  }
  return report;
}
