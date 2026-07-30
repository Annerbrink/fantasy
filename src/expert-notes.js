// Distilled expert guidance fed to the AI coach so its narrative reflects current expert
// thinking (FPL Harry + LetsTalkFPL, 2026/27 pre-season videos). The durable *principles*
// here are also encoded directly into the algorithmic model (minutes reliability in
// scoring.js; penalty / set-piece and Defcon weighting in underlyingBonus; promoted-team
// opponent softness below) so they influence every prediction, not just the AI layer. The
// player/defence/chip specifics are current-season context the coach may reference.

export const EXPERT_NOTES = {
  source: 'FPL Harry (2026/27 pre-season videos)',
  principles: [
    'Start template/boring — a season is won on consistent decisions, not one hot early rank.',
    'Prioritise nailed 90-minute players: ~25% of goals come in the last ~17% of minutes, so subbed players miss out.',
    'Favour multiple routes to points — penalty and set-piece takers over open-play-only players.',
    'Lean into Defensive Contributions (Defcon): many top defenders and mids score via Defcon.',
    'Captain boring: only Haaland or Bruno Fernandes for now.',
    'Be patient — avoid panic transfers after one bad gameweek and chasing low-owned differentials too early.',
    'Catch price rises with early transfers (the FPL site now shows price predictions), balanced against injury/rotation risk.',
  ],
  defencesToTarget: ['Arsenal', 'Liverpool', 'Man Utd', 'Newcastle', 'Crystal Palace'],
  valuePicks: [
    'João Pedro', 'Szoboszlai', 'Thomas (Coventry)', 'Calvert-Lewin', 'Mateta', 'Foden',
    'Groß', 'Luke Shaw', 'Kinsky', 'Igor Jesus', 'Malick Thiaw', 'Rogers', 'Mitoma',
  ],
  chipPlan:
    'No obvious early Wildcard — hold it; possible Free Hit around GW4 or GW12; Triple Captain Haaland/Bruno against newly-promoted sides; early Bench Boost around GW1-2 or GW6 when promoted teams have soft home fixtures.',
};

export const EXPERT_NOTES_LTFPL = {
  source: 'LetsTalkFPL / Andy (2026/27 pre-season videos)',
  principles: [
    'Defcon defenders are undervalued early — cheap, heavy-Defcon defenders (e.g. Tarkowski) become excellent value by mid-season.',
    'Do not buy a player just because you do not own the more expensive alternative.',
    'Bench investment at 4-4.5m is mostly unnecessary — but a slightly better bench defender (Mitchell, Rodon, Coady, Shaw, Robinson, Castagne) can be a useful rotation piece.',
    'Forwards were priced down league-wide this year, making a 3-4-3 more viable.',
    'Target the promoted sides early — double Man Utd defence works well over the Hull/Ipswich/Everton opening run.',
    'Skipping Haaland is a viable differential but risky given his fast starts and 73%+ ownership — do not panic-buy him back.',
  ],
  bruno: 'Not essential, but reliable minutes Mbeumo/Cunha do not guarantee — worth it if the squad works around his £12m.',
  valuePicks: [
    'Morgan Rogers', 'Saka', 'Cole Palmer', 'Cameron (Palace)', 'Richards (Palace)',
    'Mosquera', 'Calafiori', 'Szoboszlai', 'Florian Wirtz', 'James Garner', 'Luke Shaw',
    'Elliot Anderson', 'Nico Williams', 'Mateta', 'Igor Jesus', 'McBurnie (Hull, pens)',
  ],
  cheapForwards: 'Prefer the £6m bracket (Calvert-Lewin, Igor Jesus) over £5.5m; McBurnie (Hull) best of the cheapest tier for penalties — handy for an early Bench Boost.',
  chipPlan: 'Leaning toward an early Wildcard around GW4 (Chelsea/Newcastle fixture swing) without being locked in; early Bench Boost viable with triple Coventry-vs-Hull-type soft benches.',
};

// Both expert voices, combined for the coach prompt.
export const EXPERT_SOURCES = [EXPERT_NOTES, EXPERT_NOTES_LTFPL];

// Newly-promoted sides for 2026/27, with a softness weight (0..1) derived from their
// Championship Opta xPts — Hull were by far the weakest promoted side (xPts ~53, rank 23 of
// 24), so a fixture *against* Hull is the softest target on the board. Coventry and Ipswich
// were strong in the Championship, so they are ordinary promoted sides, not pushovers.
// `token` is matched case-insensitively against the FPL team name / short name.
export const PROMOTED_TEAMS = [
  { token: 'hull', name: 'Hull City', champXpts: 53.1, xptsRank: 23, softness: 1.0 },
  { token: 'coventry', name: 'Coventry City', champXpts: 85.2, xptsRank: 2, softness: 0.4 },
  { token: 'ipswich', name: 'Ipswich Town', champXpts: 86.6, xptsRank: 1, softness: 0.4 },
];

// Extra projection boost for a player whose fixture is *against* the softest promoted side.
// Applied on top of FPL's own fixture difficulty (which often rates all promoted teams alike
// and so under-weights just how weak Hull are). Hull (softness 1.0) → +10%; others → +4%.
export const MAX_SOFT_OPPONENT_BONUS = 0.1;

// Match an FPL team (its `name` / `short_name`) to a promoted-side entry, or null.
export function promotedInfo(team) {
  if (!team) return null;
  const hay = `${team.name || ''} ${team.short_name || ''}`.toLowerCase();
  return PROMOTED_TEAMS.find((p) => hay.includes(p.token)) || null;
}

// Build a teamId → extra-projection-multiplier lookup for facing a promoted side.
export function softOpponentBonuses(teams = []) {
  const byId = new Map();
  for (const t of teams) {
    const info = promotedInfo(t);
    if (info) byId.set(t.id, info.softness * MAX_SOFT_OPPONENT_BONUS);
  }
  return byId;
}
