// Orchestrates the whole advice pipeline from already-fetched FPL payloads. Pure and
// side-effect free: the Pages Function fetches the data (with caching), then calls this to
// produce the structured advice that feeds both the UI and the Claude coach. Kept separate
// from the network layer so it can be unit-tested against captured sample payloads.

import { resolveTargetGw, indexTeams, detectDgwBgw, gameweekAttackIndex, teamFixtureOutlook, teamFixturesFrom } from './fdr.js';
import { scorePlayers, sumPointsByGw } from './scoring.js';
import { suggestTransfers, watchlist } from './transfers.js';
import { pickCaptain } from './captain.js';
import { chipAdvice } from './chips.js';
import { analyseRivals, picksToPlayerIds } from './rivals.js';
import { priceTrends } from './prices.js';

// `data` bundles the raw FPL responses. `entry`, `entryHistory`, `picks`, `standings` and
// `rivalPicks` are optional — the engine degrades gracefully (pre-season, or no team set).
export function buildAdvice(data) {
  const { bootstrap, fixtures, entry, entryHistory, picks, standings, rivalPicks } = data;

  const targetGw = resolveTargetGw(bootstrap.events);
  const teamById = indexTeams(bootstrap.teams);
  const scored = scorePlayers(bootstrap, fixtures, targetGw);

  // Price-change trends — enrich each scored row so transfer reasons and views can use them.
  const trends = priceTrends(bootstrap);
  for (const p of scored) p.priceTrend = trends.byId.get(p.id) || null;

  const scoredById = new Map(scored.map((p) => [p.id, p]));
  const playerNameById = new Map(bootstrap.elements.map((p) => [p.id, p.web_name]));

  // --- Manager squad (optional) -------------------------------------------------------
  let squad = null;
  let manager = null;
  if (entry) {
    manager = {
      name: `${entry.player_first_name || ''} ${entry.player_last_name || ''}`.trim(),
      teamName: entry.name || '',
      rank: entry.summary_overall_rank || null,
      totalPoints: entry.summary_overall_points || null,
      bank: null,
      freeTransfers: null,
    };
  }
  if (picks?.picks?.length) {
    const bank = (picks.entry_history?.bank ?? 0) / 10;
    // FPL exposes free transfers on the picks payload for the upcoming GW when available.
    const freeTransfers = picks.entry_history?.event_transfers != null ? undefined : 1;
    squad = {
      bank,
      freeTransfers: freeTransfers ?? 1,
      players: picks.picks.map((p) => ({ id: p.element, sellingPrice: (p.selling_price ?? 0) / 10 || undefined })),
      startingIds: picks.picks.filter((p) => p.position <= 11).map((p) => p.element),
    };
    if (manager) {
      manager.bank = bank;
      manager.freeTransfers = squad.freeTransfers;
    }
  }

  // --- Transfers ----------------------------------------------------------------------
  const transfers = squad
    ? suggestTransfers(scored, squad)
    : { watchlistOnly: true, watchlist: watchlist(scored) };

  // --- Captain ------------------------------------------------------------------------
  // Prefer the manager's starting XI; otherwise recommend from the full pool as a pointer.
  const captainPool = squad
    ? squad.startingIds.map((id) => scoredById.get(id)).filter(Boolean)
    : scored;
  const captain = pickCaptain(captainPool.length ? captainPool : scored);

  // Per-gameweek projection for the manager's starting XI (the Dashboard points graph).
  const projectionByGw = squad && captainPool.length ? sumPointsByGw(captainPool) : null;

  // --- Chips --------------------------------------------------------------------------
  const chipsUsed = new Set();
  for (const c of entryHistory?.chips || []) chipsUsed.add(c.name);
  const dgwBgw = detectDgwBgw(fixtures, bootstrap.teams, targetGw, 10);
  // "Good teams facing bad ones": rank upcoming GWs by attacking opportunity, and rank
  // teams by the kindness of their upcoming run — feeds chip timing and transfer targets.
  const attackGws = gameweekAttackIndex(fixtures, bootstrap.teams, targetGw, 10);
  const fixtureOutlook = teamFixtureOutlook(fixtures, bootstrap.teams, targetGw, 5);

  // Weakest teams by overall strength — a proxy for newly-promoted / soft opponents to
  // target with the captaincy and Triple Captain.
  const teamStrength = (t) => (t.strength_overall_home || 0) + (t.strength_overall_away || 0);
  const weakTeamIds = new Set(
    [...bootstrap.teams].sort((a, b) => teamStrength(a) - teamStrength(b)).slice(0, 4).map((t) => t.id)
  );

  // Triple Captain target: the best premium's easiest fixture in the window, preferring a
  // newly-promoted/weak opponent and home advantage. Triple Captain is almost always used on
  // a premium forward (e.g. Haaland), so pick the top available forward, or the captain pick
  // if it out-projects them.
  const isAvail = (p) => (typeof p.chanceNext === 'number' ? p.chanceNext > 0 : !['i', 's', 'u', 'n'].includes(p.status));
  const bestFwd = scored.filter((p) => p.elementType === 4 && isAvail(p)).sort((a, b) => b.projNext - a.projNext)[0];
  const capPick = captain?.captain ? scoredById.get(captain.captain.id) : null;
  let tripleCaptain = null;
  {
    // Prefer the top forward (the standard Triple Captain choice); fall back to the captain pick.
    const capRow = bestFwd || capPick;
    const fx = capRow ? teamFixturesFrom(fixtures, capRow.teamId, targetGw, 6) : [];
    if (fx.length) {
      const bestFx = [...fx].sort(
        (a, b) =>
          a.difficulty - b.difficulty ||
          (weakTeamIds.has(b.opponent) ? 1 : 0) - (weakTeamIds.has(a.opponent) ? 1 : 0) ||
          (b.home ? 1 : 0) - (a.home ? 1 : 0)
      )[0];
      const pts = capRow.pointsByGw?.find((g) => g.gw === bestFx.gw)?.points ?? null;
      tripleCaptain = {
        id: capRow.id,
        name: capRow.name,
        team: capRow.team,
        gw: bestFx.gw,
        opponent: teamById.get(bestFx.opponent)?.short_name || '',
        home: bestFx.home,
        difficulty: bestFx.difficulty,
        promoted: weakTeamIds.has(bestFx.opponent),
        points: pts,
      };
    }
  }

  const chips = chipAdvice({ chipsUsed, dgwBgw, attackGws, tripleCaptain, teamById, targetGw });

  // --- Rivals -------------------------------------------------------------------------
  let rivals = null;
  if (standings) {
    const myPlayers = squad ? squad.players.map((p) => p.id) : [];
    rivals = analyseRivals({
      standings: (standings.results || []).map((r) => ({
        rank: r.rank,
        entry: r.entry,
        manager: r.player_name,
        teamName: r.entry_name,
        total: r.total,
      })),
      myPlayers,
      rivalPicks: (rivalPicks || []).map((rp) => ({
        entry: rp.entry,
        players: picksToPlayerIds(rp.picks),
      })),
      playerNameById,
      scoredById,
    });
  }

  return {
    targetGw,
    manager,
    transfers,
    captain,
    chips,
    rivals,
    dgwBgw,
    attackGws,
    fixtureOutlook,
    tripleCaptain,
    // Closed list of current players so the AI coach never invents departed ones.
    keyPlayers: watchlist(scored),
    priceWatch: { risers: trends.risers, fallers: trends.fallers },
    projectionByGw,
    generatedAt: new Date().toISOString(),
  };
}
