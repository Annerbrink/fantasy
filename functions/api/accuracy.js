// GET /api/accuracy — how well the projection tracked the last completed gameweek.
//
// Projects players *for the last finished GW* (using current data) and compares to their
// actual returns that week: MAE, bias, and rank correlation, over players who featured.
// Returns { available: false } in pre-season (no finished gameweeks yet).

import { fpl } from '../../src/fpl-client.js';
import { scorePlayers } from '../../src/scoring.js';
import { evaluateProjection } from '../../src/calibration.js';

const json = (obj) =>
  new Response(JSON.stringify(obj), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'max-age=300' },
  });

export async function onRequestGet() {
  const [bootstrap, fixtures] = await Promise.all([fpl.bootstrap(), fpl.fixtures()]);
  const finished = bootstrap.events.filter((e) => e.finished && e.data_checked);
  const lastGw = finished.length ? finished[finished.length - 1].id : null;
  if (!lastGw) return json({ available: false, reason: 'No finished gameweeks yet (pre-season).' });

  const live = await fpl.eventLive(lastGw).catch(() => null);
  if (!live?.elements?.length) return json({ available: false, reason: `No live data for GW${lastGw}.` });

  // Actual points for players who featured (minutes > 0) that gameweek.
  const actualById = new Map();
  for (const el of live.elements) {
    const mins = el.stats?.minutes || 0;
    if (mins > 0) actualById.set(el.id, el.stats?.total_points || 0);
  }

  // Project *for that gameweek* using current data, then compare to actuals.
  const scored = scorePlayers(bootstrap, fixtures, lastGw);
  const result = evaluateProjection(scored, actualById, { field: 'projNext' });

  return json({
    available: true,
    gw: lastGw,
    ...result,
    note: 'Indicative ranking accuracy — projection vs actual returns for the last finished GW. Spearman near 1 = the model ranked players in the right order; MAE = average points off; positive bias = over-projecting.',
  });
}
