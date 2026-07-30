// GET /api/plan?teamId=&horizon=&ft=
//
// Multi-week transfer roadmap for the manager's squad: the best upgrade to make each week
// over the horizon (1 free transfer/week → no hits), plus moves worth a -4 hit now.

import { fpl } from '../../src/fpl-client.js';
import { resolveTargetGw } from '../../src/fdr.js';
import { scorePlayers } from '../../src/scoring.js';
import { planTransfers } from '../../src/planner.js';
import { parseChipPlan } from '../../src/chip-plan.js';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

async function safe(p) { try { return await p; } catch { return null; } }

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const teamId = url.searchParams.get('teamId');
  const horizon = Math.min(Math.max(parseInt(url.searchParams.get('horizon') || '5', 10) || 5, 2), 8);
  const freeTransfers = Math.min(Math.max(parseInt(url.searchParams.get('ft') || '1', 10) || 1, 1), 5);
  if (!teamId || !/^\d+$/.test(teamId)) return json({ hasSquad: false, reason: 'No Team ID set.' });

  const [bootstrap, fixtures] = await Promise.all([fpl.bootstrap(), fpl.fixtures()]);
  const targetGw = resolveTargetGw(bootstrap.events);
  const scored = scorePlayers(bootstrap, fixtures, targetGw, horizon);

  const picks = await safe(fpl.entryPicks(teamId, targetGw));
  if (!picks?.picks?.length) {
    return json({ hasSquad: false, targetGw, reason: `No saved squad for GW${targetGw} yet.` });
  }

  const squad = {
    bank: (picks.entry_history?.bank ?? 0) / 10,
    freeTransfers,
    players: picks.picks.map((p) => ({ id: p.element, sellingPrice: (p.selling_price ?? 0) / 10 || undefined })),
  };

  const chipPlan = parseChipPlan(url.searchParams.get('chips') || '');
  const plan = planTransfers(scored, squad, { horizon, weeks: Math.min(horizon, 5), chipPlan, targetGw });
  return json({ targetGw, ...plan });
}
