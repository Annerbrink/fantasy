// Captain and vice-captain selection.
//
// Captaincy doubles a player's score, so we pick the highest single-GW projection among the
// players available to captain. When we know the manager's starting XI we choose from it;
// otherwise (pre-season / no squad) we recommend from the whole player pool as a pointer.

// `pool` is a list of scored players to choose from. Returns captain, vice, and a couple of
// differential alternatives (lower ownership) for managers chasing rank.
export function pickCaptain(pool) {
  const eligible = pool
    .filter((p) => availability(p) > 0)
    .sort((a, b) => b.projNext - a.projNext);

  if (eligible.length === 0) return null;

  const captain = eligible[0];
  const vice = eligible[1] || eligible[0];

  // A differential captain: strong projection but owned by relatively few managers.
  const differential = eligible
    .slice(0, 12)
    .filter((p) => p.id !== captain.id && p.selectedBy < 15)
    .sort((a, b) => b.projNext - a.projNext)[0];

  return {
    captain: brief(captain),
    vice: brief(vice),
    differential: differential ? brief(differential) : null,
    shortlist: eligible.slice(0, 5).map(brief),
  };
}

function availability(p) {
  if (typeof p.chanceNext === 'number') return p.chanceNext / 100;
  return p.status === 'i' || p.status === 's' || p.status === 'u' || p.status === 'n' ? 0 : 1;
}

function brief(p) {
  return {
    id: p.id,
    name: p.name,
    team: p.team,
    position: p.position,
    projNext: p.projNext,
    form: p.form,
    selectedBy: p.selectedBy,
    status: p.status,
  };
}
