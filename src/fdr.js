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
