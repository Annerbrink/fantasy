// GET /api/players — a light player index for autocomplete/search (id, name, team, position,
// price). Powers the draft "lock a player" picker. Reads the cached bootstrap; cheap.

import { fpl } from '../../src/fpl-client.js';

const POS = { 1: 'GKP', 2: 'DEF', 3: 'MID', 4: 'FWD' };

export async function onRequestGet() {
  const bootstrap = await fpl.bootstrap();
  const teamById = new Map(bootstrap.teams.map((t) => [t.id, t.short_name]));
  const players = bootstrap.elements.map((p) => ({
    id: p.id,
    name: p.web_name,
    team: teamById.get(p.team) || '',
    position: POS[p.element_type],
    price: p.now_cost / 10,
  }));
  return new Response(JSON.stringify({ players }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'max-age=300' },
  });
}
