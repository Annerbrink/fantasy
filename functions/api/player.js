// GET /api/player?id=&horizon=
//
// A single player's upcoming match schedule (opponents, home/away, fixture difficulty) with the
// model's projected points per gameweek. Powers the "click a player" popup. Cheap: reuses the
// two already-cached payloads (bootstrap + fixtures) — no extra upstream call.

import { fpl } from '../../src/fpl-client.js';
import { resolveTargetGw } from '../../src/fdr.js';
import { buildPlayerSchedule } from '../../src/schedule.js';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id || !/^\d+$/.test(id)) return json({ error: 'A numeric player id is required.' }, 400);
  const horizon = Math.min(Math.max(parseInt(url.searchParams.get('horizon') || '6', 10) || 6, 1), 10);

  const [bootstrap, fixtures] = await Promise.all([fpl.bootstrap(), fpl.fixtures()]);
  const targetGw = resolveTargetGw(bootstrap.events);

  const player = buildPlayerSchedule(bootstrap, fixtures, targetGw, id, horizon);
  if (!player) return json({ error: 'Player not found.' }, 404);
  return json({ targetGw, ...player });
}
