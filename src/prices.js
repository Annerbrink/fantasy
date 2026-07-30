// Price-change prediction.
//
// FPL prices move daily with net transfer activity: a player transferred in by enough
// managers (relative to their ownership) rises £0.1m; heavy transfers out drop them. The
// exact daily thresholds and "flags" FPL uses aren't public, so we approximate direction
// from transfer momentum, and treat a change that has *already* happened today
// (`cost_change_event`) as a hard fact. Pure and unit-tested.

const THRESHOLD = 0.05; // net transfers as a fraction of owners that signals an imminent move

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

// Per-player price trend. `totalPlayers` is the number of registered FPL managers (bootstrap
// root `total_players`) — the denominator for turning ownership % into an owner count.
function trendFor(p, totalPlayers) {
  const owners = Math.max((num(p.selected_by_percent) / 100) * totalPlayers, 1);
  const netEvent = (p.transfers_in_event || 0) - (p.transfers_out_event || 0);
  const momentum = netEvent / owners;
  const changedToday = p.cost_change_event || 0; // +1 = rose today, -1 = fell today (tenths)

  let direction = 'stable';
  if (changedToday > 0 || momentum >= THRESHOLD) direction = 'rising';
  else if (changedToday < 0 || momentum <= -THRESHOLD) direction = 'falling';

  return {
    direction,
    momentum: Math.round(momentum * 1000) / 1000,
    netEvent,
    changedToday, // in price tenths (£0.1m units)
    changeStart: p.cost_change_start || 0, // net change since the season began, in tenths
  };
}

// Build a trend map plus ranked risers/fallers lists for the whole player universe.
export function priceTrends(bootstrap) {
  const totalPlayers = bootstrap.total_players || 1;
  const teamById = new Map(bootstrap.teams.map((t) => [t.id, t.short_name]));
  const byId = new Map();
  const rows = [];

  for (const p of bootstrap.elements) {
    const t = trendFor(p, totalPlayers);
    byId.set(p.id, t);
    rows.push({
      id: p.id,
      name: p.web_name,
      team: teamById.get(p.team) || '',
      price: p.now_cost / 10,
      ...t,
    });
  }

  const risers = rows
    .filter((r) => r.direction === 'rising')
    .sort((a, b) => b.momentum - a.momentum)
    .slice(0, 10);
  const fallers = rows
    .filter((r) => r.direction === 'falling')
    .sort((a, b) => a.momentum - b.momentum)
    .slice(0, 10);

  return { byId, risers, fallers };
}

export { THRESHOLD };
