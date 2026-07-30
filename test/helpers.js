// Small synthetic FPL payloads for offline, deterministic engine tests. Field names mirror
// the real bootstrap-static / fixtures API so the tests exercise the same code paths.

export function makeElement(over = {}) {
  return {
    id: 1,
    web_name: 'Player',
    team: 1,
    element_type: 3, // MID
    now_cost: 70,
    status: 'a',
    news: '',
    chance_of_playing_next_round: null,
    ep_next: '4.0',
    form: '0.0',
    points_per_game: '4.0',
    total_points: 100,
    selected_by_percent: '10.0',
    expected_goal_involvements_per_90: '0.4',
    penalties_order: null,
    corners_and_indirect_freekicks_order: null,
    direct_freekicks_order: null,
    ...over,
  };
}

export function makeBootstrap(elements) {
  return {
    events: [
      { id: 1, finished: false, is_current: false, is_next: true },
      { id: 2, finished: false, is_current: false, is_next: false },
      { id: 3, finished: false, is_current: false, is_next: false },
    ],
    teams: [
      { id: 1, short_name: 'ARS' },
      { id: 2, short_name: 'BHA' },
      { id: 3, short_name: 'CHE' },
    ],
    element_types: [
      { id: 1, singular_name_short: 'GKP' },
      { id: 2, singular_name_short: 'DEF' },
      { id: 3, singular_name_short: 'MID' },
      { id: 4, singular_name_short: 'FWD' },
    ],
    elements,
  };
}

// One fixture per team per GW by default; helpers below add doubles/blanks.
export function makeFixtures() {
  return [
    { event: 1, team_h: 1, team_a: 2, team_h_difficulty: 2, team_a_difficulty: 4 },
    { event: 1, team_h: 3, team_a: 1, team_h_difficulty: 3, team_a_difficulty: 3 }, // ARS also plays GW1 -> DGW for team 1
    { event: 2, team_h: 2, team_a: 3, team_h_difficulty: 3, team_a_difficulty: 3 },
    // GW2: team 1 blanks (no fixture)
    { event: 3, team_h: 1, team_a: 3, team_h_difficulty: 2, team_a_difficulty: 4 },
    { event: 3, team_h: 2, team_a: 1, team_h_difficulty: 5, team_a_difficulty: 2 },
  ];
}
