// Distilled expert guidance fed to the AI coach so its narrative reflects current expert
// thinking (FPL Harry, 2026/27 pre-season videos). The durable *principles* here are also
// encoded directly into the algorithmic model (minutes reliability in scoring.js; penalty /
// set-piece and Defcon weighting in underlyingBonus) so they influence every prediction, not
// just the AI layer. The player/defence/chip specifics are current-season context the coach
// may reference. Full source notes: docs/fpl-harry-notes.md.

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
