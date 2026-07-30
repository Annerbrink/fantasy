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

// 2026/27 rule: chips come in two sets. The first set (Wildcard, Bench Boost, Triple
// Captain, Free Hit) expires at the Gameweek 19 deadline; the second set covers GW20-38.
// A chip you hold past its half's deadline is lost — so advice must be expiry-aware.
const HALF1_DEADLINE = 19;
const SEASON_END = 38;

function halfDeadline(targetGw) {
  return targetGw <= HALF1_DEADLINE ? HALF1_DEADLINE : SEASON_END;
}

// `chipsUsed` is the set of chip keys already played this half-season (from entry history).
// `dgwBgw` is the report from detectDgwBgw(). `teamById` maps team id -> short name.
export function chipAdvice({ chipsUsed = new Set(), dgwBgw = [], attackGws = [], tripleCaptain = null, teamById = new Map(), targetGw }) {
  const expiryGw = halfDeadline(targetGw);
  const remaining = expiryGw - targetGw; // gameweeks left to use this half's chips

  // A chip can only be used before its half's deadline, so bound every target to it.
  const doubles = dgwBgw.filter((r) => r.doubleTeams.length > 0 && r.gw <= expiryGw);
  const blanks = dgwBgw.filter((r) => r.blankTeams.length > 0 && r.gw <= expiryGw);
  const peakAttack = [...attackGws].filter((g) => g.gw <= expiryGw).sort((a, b) => b.index - a.index)[0] || null;
  const tc = tripleCaptain && tripleCaptain.gw <= expiryGw ? tripleCaptain : null;

  const advice = [];
  for (const chip of ALL_CHIPS) {
    if (chipsUsed.has(chip.key)) {
      advice.push({ chip: chip.name, status: 'used', recommendation: 'Already played this half-season.' });
      continue;
    }
    advice.push(recommendFor(chip, { doubles, blanks, peakAttack, tc, targetGw, expiryGw, remaining }));
  }
  return advice;
}

function topFixtureNames(gw) {
  return (gw?.fixtures || []).slice(0, 3).map((f) => `${f.team} ${f.home ? 'v' : '@'} ${f.opponent}`).join(', ');
}

// True when the half is nearly over — time to use a chip rather than keep holding it.
function expiringSoon(remaining) {
  return remaining <= 4;
}

function recommendFor(chip, { doubles, blanks, peakAttack, tc, targetGw, expiryGw, remaining }) {
  const biggestDouble = [...doubles].sort((a, b) => b.doubleTeams.length - a.doubleTeams.length)[0];
  const firstDouble = doubles[0];
  const firstBlank = blanks[0];
  const expiryNote = ` (this chip expires at the GW${expiryGw} deadline)`;
  const tcVenue = tc ? (tc.home ? `at home to ${tc.opponent}` : `away at ${tc.opponent}`) : '';
  const tcWhy = tc && tc.promoted ? ` — a newly-promoted/weak side` : tc ? ` — his easiest fixture` : '';

  switch (chip.key) {
    case 'bboost':
      if (biggestDouble) {
        return target(chip, biggestDouble.gw, `Aim for GW${biggestDouble.gw}: ${biggestDouble.doubleTeams.length} teams play twice, so your bench can score double too. Build 15 starters into that week.`);
      }
      if (expiringSoon(remaining) && peakAttack) {
        return urgent(chip, peakAttack.gw, `No double before it expires — use it by GW${expiryGw}. Best remaining week is GW${peakAttack.gw} (${topFixtureNames(peakAttack)}); fill your bench with nailed starters and cash it in rather than lose it${expiryNote}.`);
      }
      if (peakAttack) {
        return consider(chip, peakAttack.gw, `No double in view — the strongest all-round week is GW${peakAttack.gw} (${topFixtureNames(peakAttack)}). Target it once your bench is fixture-proof, and don't hold past GW${expiryGw}.`);
      }
      return holdAdvice(chip, `Save it for a Double Gameweek so all 15 players return points — but use it before the GW${expiryGw} deadline; don't let it expire.`);

    case '3xc':
      if (biggestDouble) {
        const who = tc ? `${tc.name}` : 'a nailed premium';
        return target(chip, biggestDouble.gw, `Best in the GW${biggestDouble.gw} Double — triple ${who} across both fixtures.`);
      }
      // No double in the window: name the concrete best week for your premium captain.
      if (tc) {
        const status = expiringSoon(remaining) ? urgent : target;
        const tail = expiringSoon(remaining) ? ` Don't hold past GW${expiryGw}${expiryNote}.` : '';
        return status(chip, tc.gw, `Triple ${tc.name} in GW${tc.gw} ${tcVenue}${tcWhy} (proj ${tc.points ?? '—'} pts). Best single-fixture week to triple your premium.${tail}`);
      }
      if (expiringSoon(remaining) && peakAttack) {
        return urgent(chip, peakAttack.gw, `No double before it expires — triple your best nailed premium in GW${peakAttack.gw} (${topFixtureNames(peakAttack)}) rather than lose the chip at GW${expiryGw}${expiryNote}.`);
      }
      if (peakAttack) {
        return consider(chip, peakAttack.gw, `No double in view — GW${peakAttack.gw} has the best good-vs-bad matchups (${topFixtureNames(peakAttack)}). Triple a nailed premium from one of those sides; don't hold past GW${expiryGw}.`);
      }
      return holdAdvice(chip, `Hold for a Double Gameweek or a nailed premium with a standout home fixture — but use it before GW${expiryGw}.`);

    case 'freehit':
      if (firstBlank) {
        return target(chip, firstBlank.gw, `Strong in the GW${firstBlank.gw} Blank (${firstBlank.blankTeams.length} teams don't play) to field a full XI, or on a big Double to load up for one week.`);
      }
      if (expiringSoon(remaining) && peakAttack) {
        return urgent(chip, peakAttack.gw, `No blank before it expires — deploy it on the best fixture week, GW${peakAttack.gw} (${topFixtureNames(peakAttack)}), rather than waste it at GW${expiryGw}${expiryNote}.`);
      }
      return holdAdvice(chip, `Save for a Blank Gameweek to field a full XI, or a large Double — but don't let it expire at GW${expiryGw}.`);

    case 'wildcard':
    default:
      if (firstDouble || firstBlank) {
        const gw = firstDouble?.gw ?? firstBlank?.gw;
        return consider(chip, gw, `Wildcard 1–2 GWs before GW${gw} to shape your squad around the upcoming Double/Blank swing without taking hits.`);
      }
      if (expiringSoon(remaining)) {
        return urgent(chip, expiryGw, `Use it before the GW${expiryGw} deadline — bank any pending price rises and reshape around the best upcoming fixtures rather than lose the chip.`);
      }
      return holdAdvice(chip, `Play it when 4+ moves are needed at once (injuries, a fixture swing, or price/form shifts) — and before the GW${expiryGw} deadline.`);
  }
}

function target(chip, gw, recommendation) {
  return { chip: chip.name, status: 'target', when: `GW${gw}`, recommendation };
}
function consider(chip, gw, recommendation) {
  return { chip: chip.name, status: 'consider', when: `GW${gw}`, recommendation };
}
function urgent(chip, gw, recommendation) {
  return { chip: chip.name, status: 'urgent', when: `by GW${gw}`, recommendation };
}
function holdAdvice(chip, text) {
  return { chip: chip.name, status: 'hold', recommendation: text };
}
