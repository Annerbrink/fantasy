// Builds the compact prompt sent to the Claude Messages API. We hand Claude the numbers
// the algorithmic engine already computed (rankings, captain, chips, rival template) and
// ask for a concise, human weekly game plan — Claude explains and prioritises, it does not
// re-derive the data. Keeping the payload small keeps latency and cost down.

export function buildCoachMessages(advice) {
  const { targetGw, manager, transfers, captain, chips, rivals, fixtureOutlook, attackGws } = advice;

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
    bestFixtureRuns: (fixtureOutlook?.best || []).slice(0, 5).map((t) => `${t.team} (avg FDR ${t.avgDifficulty})`),
    toughestRuns: (fixtureOutlook?.tough || []).slice(0, 3).map((t) => `${t.team} (avg FDR ${t.avgDifficulty})`),
    bestAttackingGameweeks: [...(attackGws || [])]
      .sort((a, b) => b.index - a.index)
      .slice(0, 3)
      .map((g) => `GW${g.gw}: ${(g.fixtures || []).slice(0, 3).map((f) => `${f.team} ${f.home ? 'v' : '@'} ${f.opponent}`).join(', ')}`),
  };

  const system = [
    'You are an elite Fantasy Premier League (FPL) strategist helping a manager win their mini-league.',
    'You are given pre-computed data from a scoring engine: ranked transfer suggestions, captain picks, chip-timing advice, and mini-league rival analysis.',
    'Write a concise, confident weekly game plan in British English. Prioritise ruthlessly — say what to do and why, referencing the numbers you are given.',
    'Use the fixture data: favour transfers into teams with the kindest upcoming runs (good attacking sides facing weak opponents) and time chips around the best attacking gameweeks provided.',
    'Structure: (1) one-line headline verdict, (2) transfers (lean on fixture swings), (3) captain, (4) chips if relevant this window, (5) one mini-league angle to gain rank.',
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
