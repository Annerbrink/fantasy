// GET /api/stats?metric=&limit=
//
// Leaderboards of advanced metrics. Two sources, both free:
//  - Opta-derived numbers that ship in the FPL bootstrap (xG/xA/xGI + per-90s, ICT, Defcon).
//  - Our own model's expected points (xPts) over the next 1 and next 6 gameweeks, which fold
//    in fixtures, minutes reliability and the promoted-opponent softness (Hull etc.).
// Cheap: reads the cached bootstrap + fixtures and runs the same scoring engine as the app.

import { fpl } from '../../src/fpl-client.js';
import { resolveTargetGw } from '../../src/fdr.js';
import { scorePlayers } from '../../src/scoring.js';

const POS = { 1: 'GKP', 2: 'DEF', 3: 'MID', 4: 'FWD' };

const num = (v) => parseFloat(v) || 0;

// metric key -> { label, pick(row), min minutes to qualify }. `row` carries the bootstrap
// element (`el`) plus our model's projections (`xpts1`, `xpts6`).
const METRICS = {
  xpts6: { label: 'xPts (next 6 GWs)', pick: (r) => r.xpts6, minMinutes: 0 },
  xpts1: { label: 'xPts (next GW)', pick: (r) => r.xpts1, minMinutes: 0 },
  xgi90: { label: 'xGI per 90', pick: (r) => num(r.el.expected_goal_involvements_per_90), minMinutes: 450 },
  xg90: { label: 'xG per 90', pick: (r) => num(r.el.expected_goals_per_90), minMinutes: 450 },
  xa90: { label: 'xA per 90', pick: (r) => num(r.el.expected_assists_per_90), minMinutes: 450 },
  xgi: { label: 'xGI (season)', pick: (r) => num(r.el.expected_goal_involvements), minMinutes: 0 },
  ict: { label: 'ICT index', pick: (r) => num(r.el.ict_index), minMinutes: 0 },
  threat: { label: 'Threat', pick: (r) => num(r.el.threat), minMinutes: 0 },
  creativity: { label: 'Creativity', pick: (r) => num(r.el.creativity), minMinutes: 0 },
  defcon90: { label: 'Defensive contribution per 90', pick: (r) => num(r.el.defensive_contribution_per_90), minMinutes: 450 },
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const key = url.searchParams.get('metric') || 'xpts6';
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '15', 10) || 15, 5), 40);
  const metric = METRICS[key];
  if (!metric) return json({ error: 'Unknown metric', metrics: Object.keys(METRICS) }, 400);

  const [bootstrap, fixtures] = await Promise.all([fpl.bootstrap(), fpl.fixtures()]);
  const targetGw = resolveTargetGw(bootstrap.events);
  const teamById = new Map(bootstrap.teams.map((t) => [t.id, t.short_name]));

  // Model projections, keyed by player id, so xPts metrics reuse the app's scoring engine.
  const scored = scorePlayers(bootstrap, fixtures, targetGw, 6);
  const scoredById = new Map(scored.map((s) => [s.id, s]));

  const rows = bootstrap.elements.map((el) => {
    const s = scoredById.get(el.id);
    return { el, xpts1: s?.projNext ?? 0, xpts6: s?.projHorizon ?? 0 };
  });

  const leaders = rows
    .filter((r) => (r.el.minutes || 0) >= metric.minMinutes && metric.pick(r) > 0)
    .map((r) => ({
      id: r.el.id,
      name: r.el.web_name,
      team: teamById.get(r.el.team) || '',
      position: POS[r.el.element_type],
      price: r.el.now_cost / 10,
      value: Math.round(metric.pick(r) * 100) / 100,
      minutes: r.el.minutes || 0,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);

  return json({
    metric: key,
    label: metric.label,
    targetGw,
    metrics: Object.entries(METRICS).map(([k, m]) => ({ key: k, label: m.label })),
    leaders,
  });
}
