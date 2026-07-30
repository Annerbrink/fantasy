// GET /api/stats?metric=&limit=
//
// Leaderboards of Opta-derived advanced metrics that ship free in the FPL bootstrap
// (expected goals/assists/involvements + per-90s, ICT and its components, defensive
// contribution). No official Opta contract needed. Cheap: reads the cached bootstrap.

import { fpl } from '../../src/fpl-client.js';

const POS = { 1: 'GKP', 2: 'DEF', 3: 'MID', 4: 'FWD' };

// metric key -> { label, field on the element, min minutes to qualify }
const METRICS = {
  xgi90: { label: 'xGI per 90', field: 'expected_goal_involvements_per_90', minMinutes: 450 },
  xg90: { label: 'xG per 90', field: 'expected_goals_per_90', minMinutes: 450 },
  xa90: { label: 'xA per 90', field: 'expected_assists_per_90', minMinutes: 450 },
  xgi: { label: 'xGI (season)', field: 'expected_goal_involvements', minMinutes: 0 },
  ict: { label: 'ICT index', field: 'ict_index', minMinutes: 0 },
  threat: { label: 'Threat', field: 'threat', minMinutes: 0 },
  creativity: { label: 'Creativity', field: 'creativity', minMinutes: 0 },
  defcon90: { label: 'Defensive contribution per 90', field: 'defensive_contribution_per_90', minMinutes: 450 },
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const key = url.searchParams.get('metric') || 'xgi90';
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '15', 10) || 15, 5), 40);
  const metric = METRICS[key];
  if (!metric) return json({ error: 'Unknown metric', metrics: Object.keys(METRICS) }, 400);

  const bootstrap = await fpl.bootstrap();
  const teamById = new Map(bootstrap.teams.map((t) => [t.id, t.short_name]));

  const leaders = bootstrap.elements
    .filter((p) => (p.minutes || 0) >= metric.minMinutes && parseFloat(p[metric.field]) > 0)
    .map((p) => ({
      id: p.id,
      name: p.web_name,
      team: teamById.get(p.team) || '',
      position: POS[p.element_type],
      price: p.now_cost / 10,
      value: parseFloat(p[metric.field]) || 0,
      minutes: p.minutes || 0,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);

  return json({
    metric: key,
    label: metric.label,
    metrics: Object.entries(METRICS).map(([k, m]) => ({ key: k, label: m.label })),
    leaders,
  });
}
