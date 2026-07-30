// Builds the compact prompt sent to the Claude Messages API. We hand Claude the numbers
// the algorithmic engine already computed (rankings, captain, chips, rival template) and
// ask for a concise, human weekly game plan — Claude explains and prioritises, it does not
// re-derive the data. Keeping the payload small keeps latency and cost down.

import { EXPERT_NOTES } from './expert-notes.js';

const money = (n) => (n == null ? '—' : `£${Number(n).toFixed(1)}m`);

export function buildCoachMessages(advice) {
  const { targetGw, manager, transfers, captain, chips, rivals, fixtureOutlook, attackGws, keyPlayers, priceWatch } = advice;

  // A closed list of current players (per position) so the model has real names to work with
  // even when no squad/league is set — and can be told not to name anyone outside the data.
  const kp = keyPlayers || {};
  const currentPlayers = {
    GKP: (kp.GKP || []).slice(0, 5).map((p) => `${p.name} (${p.team}, ${money(p.price)})`),
    DEF: (kp.DEF || []).slice(0, 8).map((p) => `${p.name} (${p.team}, ${money(p.price)})`),
    MID: (kp.MID || []).slice(0, 8).map((p) => `${p.name} (${p.team}, ${money(p.price)})`),
    FWD: (kp.FWD || []).slice(0, 6).map((p) => `${p.name} (${p.team}, ${money(p.price)})`),
  };

  // Trim the structured advice to the fields worth reasoning over.
  const summary = {
    gameweek: targetGw,
    manager: manager
      ? { name: manager.name, teamName: manager.teamName, rank: manager.rank, bank: manager.bank, freeTransfers: manager.freeTransfers }
      : null,
    topTransfers: (transfers?.single || []).slice(0, 4).map((t) => ({
      out: `${t.out.name} (${t.out.team})`,
      in: `${t.in.name} (${t.in.team})`,
      netGain: t.netGain,
      reason: t.reason,
    })),
    holdRecommended: transfers?.hold ?? false,
    captain: captain ? { pick: captain.captain?.name, vice: captain.vice?.name, differential: captain.differential?.name || null } : null,
    chips: (chips || []).filter((c) => c.status !== 'used').map((c) => ({ chip: c.chip, when: c.when || null, advice: c.recommendation })),
    rivalTemplate: (rivals?.template || []).slice(0, 6).map((p) => `${p.name}${p.owned ? ' (owned)' : ''}`),
    yourDifferentials: (rivals?.differentials || []).slice(0, 5).map((p) => p.name),
    rivalThreats: (rivals?.threats || []).slice(0, 5).map((p) => p.name),
    rankGainTargets: (rivals?.rankGainTargets || []).slice(0, 5).map((p) => `${p.name} (${p.team}, ${p.leagueOwnership}% owned, rank-gain ${p.rankGain})`),
    bestFixtureRuns: (fixtureOutlook?.best || []).slice(0, 5).map((t) => `${t.team} (avg FDR ${t.avgDifficulty})`),
    toughestRuns: (fixtureOutlook?.tough || []).slice(0, 3).map((t) => `${t.team} (avg FDR ${t.avgDifficulty})`),
    bestAttackingGameweeks: [...(attackGws || [])]
      .sort((a, b) => b.index - a.index)
      .slice(0, 3)
      .map((g) => `GW${g.gw}: ${(g.fixtures || []).slice(0, 3).map((f) => `${f.team} ${f.home ? 'v' : '@'} ${f.opponent}`).join(', ')}`),
    currentPlayers,
    priceRisers: (priceWatch?.risers || []).slice(0, 6).map((p) => `${p.name} (${p.team})`),
    priceFallers: (priceWatch?.fallers || []).slice(0, 6).map((p) => `${p.name} (${p.team})`),
    expertGuidance: EXPERT_NOTES,
  };

  const system = [
    'You are an elite Fantasy Premier League (FPL) strategist helping a manager win their mini-league.',
    'You are given pre-computed data from a scoring engine: ranked transfer suggestions, captain picks, chip-timing advice, mini-league rival analysis, fixture swings, and price-change watch.',
    'CRITICAL: Only reference players that appear in the DATA below (transfer picks, captain, currentPlayers, priceRisers/Fallers, rival lists). That list is the complete set of players available this season. NEVER name any player who is not in the data — players from previous seasons may have transferred away or retired. If a section has no data, say so briefly rather than inventing names.',
    'Write a concise, confident weekly game plan in British English. Prioritise ruthlessly — say what to do and why, referencing the numbers you are given.',
    'Use the fixture data: favour transfers into teams with the kindest upcoming runs (good attacking sides facing weak opponents) and time chips around the best attacking gameweeks provided.',
    'Factor in price changes: prefer buying priceRisers before they rise, and consider selling priceFallers before they drop.',
    'Weight the expertGuidance (FPL Harry): favour nailed 90-minute players, penalty/set-piece takers and Defcon options; captain boring (Haaland or Bruno); be patient and avoid panic transfers; target the listed defences for clean sheets. The expert value picks and defences-to-target are current players/teams you may reference.',
    'For the mini-league angle, use rankGainTargets — to climb the league, prefer strong players your rivals do NOT own (differentials), and note any high-owned template you are missing that could cost you rank.',
    'Structure: (1) one-line headline verdict, (2) transfers (lean on fixture swings and price timing), (3) captain, (4) chips if relevant this window, (5) one mini-league angle to gain rank (use rankGainTargets).',
    'Be specific and brief. Do not invent players, prices, or fixtures beyond the data provided. Do not include any internal or system XML tags in your response.',
  ].join(' ');

  const user = [
    `Here is the computed FPL data for Gameweek ${targetGw}:`,
    '```json',
    JSON.stringify(summary, null, 2),
    '```',
    'Give me my game plan to climb the mini-league.',
  ].join('\n');

  return { system, user };
}
