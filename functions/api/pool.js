// GET /api/pool?position=GKP|DEF|MID|FWD&horizon=
//
// All players in one position with the model's per-gameweek projected points and price, so the
// Draft tab's "replace" picker can rank candidates by any gameweek and judge affordability.
// Cheap: reuses the two already-cached payloads and the same scoring engine as the draft.

import { fpl } from '../../src/fpl-client.js';
import { resolveTargetGw } from '../../src/fdr.js';
import { scorePlayers } from '../../src/scoring.js';

const POSITIONS = new Set(['GKP', 'DEF', 'MID', 'FWD']);

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const position = (url.searchParams.get('position') || '').toUpperCase();
  if (!POSITIONS.has(position)) return json({ error: 'position must be one of GKP, DEF, MID, FWD' }, 400);
  const horizon = Math.min(Math.max(parseInt(url.searchParams.get('horizon') || '5', 10) || 5, 1), 10);

  const [bootstrap, fixtures] = await Promise.all([fpl.bootstrap(), fpl.fixtures()]);
  const targetGw = resolveTargetGw(bootstrap.events);
  const scored = scorePlayers(bootstrap, fixtures, targetGw, horizon);

  const players = scored
    .filter((p) => p.position === position)
    .map((p) => ({
      id: p.id,
      name: p.name,
      team: p.team,
      teamId: p.teamId,
      price: p.price,
      projHorizon: p.projHorizon,
      pointsByGw: p.pointsByGw,
    }))
    .sort((a, b) => b.projHorizon - a.projHorizon);

  return json({ targetGw, position, horizon, players });
}
