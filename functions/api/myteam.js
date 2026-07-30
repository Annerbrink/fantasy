// GET /api/myteam?teamId= — the manager's current 15-man squad for the upcoming gameweek,
// as {id, name, team, position, price}. Powers the draft "load my current team" button so
// you can start from your real squad and let the optimiser suggest changes.
// Returns { found: false } gracefully when no squad exists yet (e.g. pre-season before a
// GW1 team is saved).

import { fpl } from '../../src/fpl-client.js';
import { resolveTargetGw } from '../../src/fdr.js';

const POS = { 1: 'GKP', 2: 'DEF', 3: 'MID', 4: 'FWD' };
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const teamId = url.searchParams.get('teamId');
  if (!teamId || !/^\d+$/.test(teamId)) return json({ found: false, reason: 'No Team ID set.' }, 400);

  const bootstrap = await fpl.bootstrap();
  const targetGw = resolveTargetGw(bootstrap.events);
  const elementById = new Map(bootstrap.elements.map((e) => [e.id, e]));
  const teamById = new Map(bootstrap.teams.map((t) => [t.id, t.short_name]));

  let picks = null;
  try {
    picks = await fpl.entryPicks(teamId, targetGw);
  } catch {
    picks = null;
  }
  if (!picks?.picks?.length) {
    return json({ found: false, reason: `No saved squad for GW${targetGw} yet — set your team on the FPL site first.` });
  }

  const players = picks.picks
    .map((pk) => elementById.get(pk.element))
    .filter(Boolean)
    .map((e) => ({
      id: e.id,
      name: e.web_name,
      team: teamById.get(e.team) || '',
      position: POS[e.element_type],
      price: e.now_cost / 10,
    }));

  return json({ found: true, gw: targetGw, players });
}
