// Planned chip strategy.
//
// Lets the manager record when they intend to play each chip, suggests an optimal schedule
// from the fixture calendar, and validates chosen weeks. The plan then feeds the transfer
// planner and draft (see planner.js / the client) so advice is shaped around it — e.g. no -4
// hits the week before a planned Wildcard resets the squad for free.
//
// 2026/27 rules: chips come in two sets. The first (Wildcard, Bench Boost, Triple Captain,
// Free Hit) must be used by the GW19 deadline; the second set covers GW20-38. So there are
// eight slots — each base chip once per half. Pure and unit-testable.

const HALF1_DEADLINE = 19;
const SEASON_END = 38;

export const CHIP_TYPES = [
  { key: 'wildcard', name: 'Wildcard' },
  { key: 'bboost', name: 'Bench Boost' },
  { key: '3xc', name: 'Triple Captain' },
  { key: 'freehit', name: 'Free Hit' },
];

// The eight slots in display order: <chipKey><half>, e.g. `wildcard1`, `bboost2`.
export const CHIP_SLOTS = CHIP_TYPES.flatMap((c) => [
  { slot: `${c.key}1`, key: c.key, name: c.name, half: 1, min: 1, max: HALF1_DEADLINE },
  { slot: `${c.key}2`, key: c.key, name: c.name, half: 2, min: HALF1_DEADLINE + 1, max: SEASON_END },
]);

export function halfOf(gw) {
  return gw <= HALF1_DEADLINE ? 1 : 2;
}

// Read a GW out of a plan entry that may be a bare number or a { gw, reason } object.
function gwOf(entry) {
  if (typeof entry === 'number') return entry;
  if (entry && Number.isFinite(entry.gw)) return entry.gw;
  return null;
}

// Suggest an optimal schedule: Triple Captain on your premium's best single week, Bench Boost
// on the biggest Double, Free Hit on a Blank, Wildcards at sensible reshaping points — never
// two chips in the same gameweek (FPL allows only one chip per GW). `dgwBgw`/`attackGws`
// should span the remaining season (engine passes season-wide scans).
export function suggestChipPlan({ dgwBgw = [], attackGws = [], tripleCaptain = null, targetGw = 1 } = {}) {
  const plan = {};

  const doublesIn = (half) =>
    dgwBgw.filter((r) => r.doubleTeams.length && halfOf(r.gw) === half && r.gw >= targetGw)
      .sort((a, b) => b.doubleTeams.length - a.doubleTeams.length);
  const blanksIn = (half) =>
    dgwBgw.filter((r) => r.blankTeams.length && halfOf(r.gw) === half && r.gw >= targetGw);
  const attackIn = (half) =>
    [...attackGws].filter((g) => halfOf(g.gw) === half && g.gw >= targetGw).sort((a, b) => b.index - a.index);

  for (const half of [1, 2]) {
    const used = new Set();
    const doubles = doublesIn(half);
    const blanks = blanksIn(half);
    const attack = attackIn(half);
    const firstFree = (list) => list.find((x) => x.gw != null && !used.has(x.gw)) || null;
    const set = (slot, gw, reason) => { plan[slot] = { gw, reason }; used.add(gw); };

    // Triple Captain — the pre-computed premium pick (half 1), else biggest Double, else best week.
    if (half === 1 && tripleCaptain && Number.isFinite(tripleCaptain.gw) && halfOf(tripleCaptain.gw) === 1 && tripleCaptain.gw >= targetGw && !used.has(tripleCaptain.gw)) {
      set('3xc1', tripleCaptain.gw, `${tripleCaptain.name} v ${tripleCaptain.opponent}${tripleCaptain.promoted ? ' — a promoted side' : ''}`);
    } else {
      const d = firstFree(doubles);
      if (d) set(`3xc${half}`, d.gw, `Triple your premium across the GW${d.gw} Double`);
      else { const a = firstFree(attack); if (a) set(`3xc${half}`, a.gw, `Best attacking week (GW${a.gw})`); }
    }

    // Bench Boost — biggest remaining Double, else strongest remaining all-round week.
    {
      const d = firstFree(doubles);
      if (d) set(`bboost${half}`, d.gw, `${d.doubleTeams.length} teams play twice in GW${d.gw}`);
      else { const a = firstFree(attack); if (a) set(`bboost${half}`, a.gw, `Strongest all-round week (GW${a.gw})`); }
    }

    // Free Hit — a Blank (field a full XI), else a remaining Double (load up for one week).
    {
      const b = firstFree(blanks);
      if (b) set(`freehit${half}`, b.gw, `${b.blankTeams.length} teams blank in GW${b.gw} — field a full XI`);
      else { const d = firstFree(doubles); if (d) set(`freehit${half}`, d.gw, `Load up for the GW${d.gw} Double`); }
    }

    // Wildcard — heuristic reshaping point, nudged off any week already taken by another chip.
    const floor = half === 1 ? 1 : 20;
    const ceil = half === 1 ? HALF1_DEADLINE : SEASON_END;
    let wc = Math.min(Math.max(half === 1 ? Math.max(targetGw + 1, 8) : 21, Math.max(floor, targetGw)), ceil);
    while (used.has(wc) && wc < ceil) wc += 1;
    set(`wildcard${half}`, wc, half === 1 ? 'Reshape once the early fixtures settle' : 'Reset for the second-half run-in');
  }

  return plan;
}

// Validate each planned week against the calendar: right half, not in the past, and (for
// Bench Boost / Triple Captain / Free Hit) landing on a Double / strong / Blank week. Returns
// one review per planned slot with an `ok` flag and a human note (naming a nearer week if off).
export function validateChipPlan(plan = {}, { dgwBgw = [], attackGws = [], tripleCaptain = null, targetGw = 1 } = {}) {
  const doubleGw = new Map(dgwBgw.filter((r) => r.doubleTeams.length).map((r) => [r.gw, r.doubleTeams.length]));
  const blankGw = new Map(dgwBgw.filter((r) => r.blankTeams.length).map((r) => [r.gw, r.blankTeams.length]));
  const topAttack = new Set([...attackGws].sort((a, b) => b.index - a.index).slice(0, 5).map((g) => g.gw));
  const tcGw = tripleCaptain && Number.isFinite(tripleCaptain.gw) ? tripleCaptain.gw : null;
  const nearest = (map, gw) => [...map.keys()].sort((a, b) => Math.abs(a - gw) - Math.abs(b - gw))[0];

  const reviews = [];
  for (const s of CHIP_SLOTS) {
    const gw = gwOf(plan[s.slot]);
    if (gw == null) continue; // not planned

    let ok = true;
    let note = '';
    if (gw < targetGw) {
      ok = false;
      note = `GW${gw} has already passed — pick a new week.`;
    } else if (gw < s.min || gw > s.max) {
      ok = false;
      note = `GW${gw} is outside this chip's window (GW${s.min}–${s.max}).`;
    } else if (s.key === 'bboost') {
      if (doubleGw.has(gw)) note = `GW${gw} is a Double (${doubleGw.get(gw)} teams) — your bench doubles too.`;
      else { ok = false; const nd = nearest(doubleGw, gw); note = nd != null ? `GW${gw} has no Double; the nearest is GW${nd}.` : `No Double scheduled yet — bench points won't be doubled.`; }
    } else if (s.key === '3xc') {
      if (doubleGw.has(gw)) note = `GW${gw} is a Double — triple your premium across both games.`;
      else if (tcGw != null && gw === tcGw) note = `GW${gw} is your premium's easiest fixture${tripleCaptain.opponent ? ` (v ${tripleCaptain.opponent})` : ''} — a strong single-game triple.`;
      else if (topAttack.has(gw)) note = `GW${gw} is a strong attacking week — a good single-game triple.`;
      else { ok = false; const nd = nearest(doubleGw, gw); note = nd != null ? `GW${gw} is quiet; a Double (GW${nd}) returns more.` : `GW${gw} isn't a standout week — aim for your premium's easiest home tie.`; }
    } else if (s.key === 'freehit') {
      if (blankGw.has(gw)) note = `GW${gw} is a Blank (${blankGw.get(gw)} teams) — Free Hit fields a full XI.`;
      else if (doubleGw.has(gw)) note = `GW${gw} is a Double — a valid Free Hit target too.`;
      else { ok = false; const nb = nearest(blankGw, gw); note = nb != null ? `GW${gw} has no Blank; the Blank is GW${nb}.` : `Free Hit is usually best saved for a Blank or big Double.`; }
    } else {
      note = `Wildcard in GW${gw} — reshape freely with no hits.`;
    }
    reviews.push({ slot: s.slot, key: s.key, name: s.name, half: s.half, gw, ok, note });
  }
  return reviews;
}

// Coerce a raw plan (from storage or the wire) to a clean slot→gw map, dropping anything that
// isn't a finite GW inside its slot's half.
export function normalizeChipPlan(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const s of CHIP_SLOTS) {
    const gw = gwOf(raw[s.slot]) ?? parseInt(raw[s.slot], 10);
    if (Number.isFinite(gw) && gw >= s.min && gw <= s.max) out[s.slot] = gw;
  }
  return out;
}

// Wire format: `wildcard1:8,bboost1:26,3xc1:3` ↔ { wildcard1: 8, ... }.
export function parseChipPlan(str) {
  const raw = {};
  for (const part of String(str || '').split(',')) {
    const [slot, gw] = part.split(':');
    if (slot && gw != null) raw[slot.trim()] = parseInt(gw, 10);
  }
  return normalizeChipPlan(raw);
}

export function serializeChipPlan(map) {
  return CHIP_SLOTS
    .map((s) => { const gw = gwOf(map?.[s.slot]); return Number.isFinite(gw) ? `${s.slot}:${gw}` : null; })
    .filter(Boolean)
    .join(',');
}
