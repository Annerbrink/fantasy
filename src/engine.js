// Orchestrates the whole advice pipeline from already-fetched FPL payloads. Pure and
// side-effect free: the Pages Function fetches the data (with caching), then calls this to
// produce the structured advice that feeds both the UI and the Claude coach. Kept separate
// from the network layer so it can be unit-tested against captured sample payloads.

import { resolveTargetGw, indexTeams, detectDgwBgw } from './fdr.js';
import { scorePlayers } from './scoring.js';
import { suggestTransfers, watchlist } from './transfers.js';
import { pickCaptain } from './captain.js';
import { chipAdvice } from './chips.js';
import { analyseRivals, picksToPlayerIds } from './rivals.js';

// `data` bundles the raw FPL responses. `entry`, `entryHistory`, `picks`, `standings` and
// `rivalPicks` are optional — the engine degrades gracefully (pre-season, or no team set).
export function buildAdvice(data) {
  const { bootstrap, fixtures, entry, entryHistory, picks, standings, rivalPicks } = data;

  const targetGw = resolveTargetGw(bootstrap.events);
  const teamById = indexTeams(bootstrap.teams);
  const scored = scorePlayers(bootstrap, fixtures, targetGw);
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

  // --- Chips --------------------------------------------------------------------------
  const chipsUsed = new Set();
  for (const c of entryHistory?.chips || []) chipsUsed.add(c.name);
  const dgwBgw = detectDgwBgw(fixtures, bootstrap.teams, targetGw, 10);
  const chips = chipAdvice({ chipsUsed, dgwBgw, teamById, targetGw });

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
    generatedAt: new Date().toISOString(),
  };
}
