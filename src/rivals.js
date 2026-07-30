// Mini-league rival analysis.
//
// To climb a classic league you need to know what your rivals own: the "template" (players
// nearly everyone has, where you can't afford to be short), your differentials (players you
// own that they don't — your route to gaining rank), and their threats (popular picks you're
// missing). We compute effective ownership *within the league*, which matters far more than
// global ownership when the target is beating these specific managers.
//
// `rivalPicks` is an array of { entry, name, teamName, rank, total, players:[elementId...] }.
// Passing squads is optional — in pre-season picks may not exist yet, so the module also
// works with standings alone.

export function analyseRivals({ standings, myPlayers = [], rivalPicks = [], playerNameById = new Map() }) {
  const rivalCount = rivalPicks.length;
  const mine = new Set(myPlayers);

  // Count how many rivals own each player.
  const ownership = new Map();
  for (const r of rivalPicks) {
    for (const pid of r.players) ownership.set(pid, (ownership.get(pid) || 0) + 1);
  }

  const pct = (n) => (rivalCount ? Math.round((n / rivalCount) * 1000) / 10 : 0);
  const named = (pid) => playerNameById.get(pid) || `#${pid}`;

  // Template: owned by at least half the league.
  const template = [...ownership.entries()]
    .filter(([, n]) => rivalCount && n / rivalCount >= 0.5)
    .sort((a, b) => b[1] - a[1])
    .map(([pid, n]) => ({ id: pid, name: named(pid), leagueOwnership: pct(n), owned: mine.has(pid) }));

  // Your differentials: you own them, few rivals do (< 30% of the league).
  const differentials = [...mine]
    .map((pid) => ({ id: pid, name: named(pid), owners: ownership.get(pid) || 0 }))
    .filter((d) => rivalCount === 0 || d.owners / rivalCount < 0.3)
    .map((d) => ({ id: d.id, name: d.name, leagueOwnership: pct(d.owners) }))
    .sort((a, b) => a.leagueOwnership - b.leagueOwnership);

  // Threats: popular among rivals (>= 40%) but you don't own them.
  const threats = [...ownership.entries()]
    .filter(([pid, n]) => !mine.has(pid) && rivalCount && n / rivalCount >= 0.4)
    .sort((a, b) => b[1] - a[1])
    .map(([pid, n]) => ({ id: pid, name: named(pid), leagueOwnership: pct(n) }));

  return {
    rivalCount,
    standings: standings.slice(0, 20),
    template,
    differentials,
    threats,
    hasSquadData: rivalCount > 0,
  };
}

// Normalise a raw FPL picks payload into the element-id list this module expects.
export function picksToPlayerIds(picksPayload) {
  return (picksPayload?.picks || []).map((p) => p.element);
}
