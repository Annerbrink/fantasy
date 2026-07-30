// GET /api/recommendations?teamId=&leagueId=&rivals=
//
// Fetches the FPL data the engine needs (cached at the edge), runs the scoring/transfer/
// captain/chip/rival pipeline, and returns the structured advice as JSON. Everything is
// optional: with no teamId it returns a value watchlist + captain pointers; with a leagueId
// it adds mini-league rival analysis.

import { fpl, leagueStandingsAll } from '../../src/fpl-client.js';
import { buildAdvice } from '../../src/engine.js';
import { resolveTargetGw } from '../../src/fdr.js';
import { parseChipPlan } from '../../src/chip-plan.js';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

// Fetch a payload but never let one optional call sink the whole request.
async function safe(promise) {
  try {
    return await promise;
  } catch {
    return null;
  }
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const teamId = url.searchParams.get('teamId');
  const leagueId = url.searchParams.get('leagueId');
  const rivalLimit = Math.min(parseInt(url.searchParams.get('rivals') || '10', 10) || 10, 25);

  // Core data — required.
  const [bootstrap, fixtures] = await Promise.all([fpl.bootstrap(), fpl.fixtures()]);
  const targetGw = resolveTargetGw(bootstrap.events);

  const data = { bootstrap, fixtures, chipPlan: parseChipPlan(url.searchParams.get('chips') || '') };

  // Manager squad — optional.
  if (teamId && /^\d+$/.test(teamId)) {
    const [entry, entryHistory] = await Promise.all([
      safe(fpl.entry(teamId)),
      safe(fpl.entryHistory(teamId)),
    ]);
    data.entry = entry;
    data.entryHistory = entryHistory;
    // Picks for the target GW may not exist yet in pre-season — that's fine.
    data.picks = await safe(fpl.entryPicks(teamId, targetGw));
  }

  // Mini-league — optional.
  if (leagueId && /^\d+$/.test(leagueId)) {
    const standings = await safe(leagueStandingsAll(leagueId, 100));
    if (standings) {
      data.standings = standings;
      // Pull current-GW picks for the top rivals so we can build the league template.
      const rivals = standings.results
        .filter((r) => String(r.entry) !== String(teamId))
        .slice(0, rivalLimit);
      const rivalPicks = await Promise.all(
        rivals.map(async (r) => {
          const picks = await safe(fpl.entryPicks(r.entry, targetGw));
          return picks ? { entry: r.entry, picks } : null;
        })
      );
      data.rivalPicks = rivalPicks.filter(Boolean);
    }
  }

  const advice = buildAdvice(data);
  // Surface the league name for the UI header when we have it.
  if (data.standings?.leagueName) advice.leagueName = data.standings.leagueName;
  return json(advice);
}
