// Chip-timing advice: Wildcard, Bench Boost, Triple Captain, Free Hit.
//
// Chips are won or lost on timing, and the biggest levers are Double Gameweeks (play more /
// captain more) and Blank Gameweeks (rescue a short squad). We combine the DGW/BGW scan
// from fdr.js with which chips the manager has already used, and produce plain-language
// recommendations rather than firing a chip blindly.

const ALL_CHIPS = [
  { key: 'wildcard', name: 'Wildcard' },
  { key: 'bboost', name: 'Bench Boost' },
  { key: '3xc', name: 'Triple Captain' },
  { key: 'freehit', name: 'Free Hit' },
];

// `chipsUsed` is the set of chip keys already played this half-season (from entry history).
// `dgwBgw` is the report from detectDgwBgw(). `teamById` maps team id -> short name.
export function chipAdvice({ chipsUsed = new Set(), dgwBgw = [], attackGws = [], teamById = new Map(), targetGw }) {
  const doubles = dgwBgw.filter((r) => r.doubleTeams.length > 0);
  const blanks = dgwBgw.filter((r) => r.blankTeams.length > 0);
  // The single best "good teams vs bad teams" gameweek in the window.
  const peakAttack = [...attackGws].sort((a, b) => b.index - a.index)[0] || null;

  const advice = [];

  for (const chip of ALL_CHIPS) {
    if (chipsUsed.has(chip.key)) {
      advice.push({ chip: chip.name, status: 'used', recommendation: 'Already played this half-season.' });
      continue;
    }
    advice.push(recommendFor(chip, { doubles, blanks, peakAttack, teamById, targetGw }));
  }

  return advice;
}

function topFixtureNames(gw) {
  return (gw?.fixtures || []).slice(0, 3).map((f) => `${f.team} ${f.home ? 'v' : '@'} ${f.opponent}`).join(', ');
}

function recommendFor(chip, { doubles, blanks, peakAttack, teamById, targetGw }) {
  const firstDouble = doubles[0];
  const biggestDouble = [...doubles].sort((a, b) => b.doubleTeams.length - a.doubleTeams.length)[0];
  const firstBlank = blanks[0];

  switch (chip.key) {
    case 'bboost':
      if (biggestDouble) {
        return {
          chip: chip.name,
          status: 'target',
          when: `GW${biggestDouble.gw}`,
          recommendation: `Aim for GW${biggestDouble.gw}: ${biggestDouble.doubleTeams.length} teams play twice, so your bench can score double too. Build 15 starters into that week.`,
        };
      }
      if (peakAttack) {
        return {
          chip: chip.name,
          status: 'consider',
          when: `GW${peakAttack.gw}`,
          recommendation: `No double in view — the strongest all-round fixture week is GW${peakAttack.gw} (good teams facing weak ones: ${topFixtureNames(peakAttack)}). Target it once your bench is fixture-proof.`,
        };
      }
      return holdAdvice(chip, 'Save it for a Double Gameweek so all 15 players return points.');

    case '3xc':
      if (biggestDouble) {
        return {
          chip: chip.name,
          status: 'target',
          when: `GW${biggestDouble.gw}`,
          recommendation: `Best on a premium captain with two fixtures in GW${biggestDouble.gw} (a Double Gameweek) — you triple both matches.`,
        };
      }
      if (peakAttack) {
        return {
          chip: chip.name,
          status: 'consider',
          when: `GW${peakAttack.gw}`,
          recommendation: `No double in view — GW${peakAttack.gw} has the best good-vs-bad matchups (${topFixtureNames(peakAttack)}). Triple a nailed premium from one of those sides.`,
        };
      }
      return holdAdvice(chip, 'Hold for a Double Gameweek, or a nailed premium with a standout single fixture.');

    case 'freehit':
      if (firstBlank) {
        return {
          chip: chip.name,
          status: 'target',
          when: `GW${firstBlank.gw}`,
          recommendation: `Strong option in the GW${firstBlank.gw} Blank (${firstBlank.blankTeams.length} teams don't play) to field a full XI without wrecking your squad — or on a big Double to load up for one week.`,
        };
      }
      return holdAdvice(chip, 'Save for a Blank Gameweek to field a full XI, or a large Double to maximise one week.');

    case 'wildcard':
    default:
      if (firstDouble || firstBlank) {
        const gw = firstDouble?.gw ?? firstBlank?.gw;
        return {
          chip: chip.name,
          status: 'consider',
          when: `by GW${gw}`,
          recommendation: `Consider wildcarding 1–2 GWs before GW${gw} to shape your squad around the upcoming Double/Blank swing without taking hits.`,
        };
      }
      return holdAdvice(chip, 'Play it when 4+ moves are needed at once (injuries, a fixture swing, or a price/form shift) rather than for a single transfer.');
  }
}

function holdAdvice(chip, text) {
  return { chip: chip.name, status: 'hold', recommendation: text };
}
