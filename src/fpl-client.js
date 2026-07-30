// Thin, cached client for the official Fantasy Premier League API.
//
// The FPL API sends no CORS headers, so browsers can't call it directly — every request
// goes through our Pages Functions, which is also where we cache. We use the Cloudflare
// Cache API (`caches.default`), so no KV namespace or binding is required. Cached entries
// carry a short TTL because FPL data only changes around gameweek deadlines and live play.

const BASE = 'https://fantasy.premierleague.com/api';

// Reasonable per-endpoint freshness. Static-ish data (players, fixtures) can live longer;
// entry/league data is polled a little fresher because it changes as managers make moves.
const TTL = {
  bootstrap: 600, // 10 min — players, teams, gameweeks
  fixtures: 600, // 10 min — all fixtures
  entry: 300, // 5 min — manager summary
  history: 300, // 5 min — manager history + chips used
  picks: 300, // 5 min — squad for a gameweek
  league: 300, // 5 min — classic league standings
  element: 600, // 10 min — per-player detail
};

// Fetch a FPL URL with edge caching. `caches` is only present in the Workers runtime; in
// Node (unit tests) callers inject data directly and never reach this function.
async function cachedGet(url, ttl) {
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const req = new Request(url, {
    headers: {
      // FPL occasionally rejects requests without a browser-like UA.
      'User-Agent': 'Mozilla/5.0 (compatible; FPL-Assistant/1.0)',
      Accept: 'application/json',
    },
  });

  if (cache) {
    const hit = await cache.match(req);
    if (hit) return hit.json();
  }

  const res = await fetch(req);
  if (!res.ok) {
    const err = new Error(`FPL API ${res.status} for ${url}`);
    err.status = res.status;
    throw err;
  }

  // Re-wrap so we can attach our own Cache-Control before storing.
  const body = await res.text();
  const stored = new Response(body, {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${ttl}` },
  });
  if (cache) await cache.put(req, stored.clone());
  return JSON.parse(body);
}

export const fpl = {
  bootstrap: () => cachedGet(`${BASE}/bootstrap-static/`, TTL.bootstrap),
  fixtures: () => cachedGet(`${BASE}/fixtures/`, TTL.fixtures),
  entry: (tid) => cachedGet(`${BASE}/entry/${tid}/`, TTL.entry),
  entryHistory: (tid) => cachedGet(`${BASE}/entry/${tid}/history/`, TTL.history),
  entryPicks: (tid, gw) => cachedGet(`${BASE}/entry/${tid}/event/${gw}/picks/`, TTL.picks),
  element: (eid) => cachedGet(`${BASE}/element-summary/${eid}/`, TTL.element),
  eventLive: (gw) => cachedGet(`${BASE}/event/${gw}/live/`, TTL.entry),
  leagueStandings: (lid, page = 1) =>
    cachedGet(`${BASE}/leagues-classic/${lid}/standings/?page_standings=${page}`, TTL.league),
};

// Fetch classic-league standings across pages (FPL returns 50 rows per page).
export async function leagueStandingsAll(lid, maxEntries = 100) {
  const out = [];
  let page = 1;
  let leagueName = '';
  // Cap the pagination so a huge public league can't spin forever.
  while (out.length < maxEntries && page <= 20) {
    const data = await fpl.leagueStandings(lid, page);
    leagueName = data.league?.name || leagueName;
    const results = data.standings?.results || [];
    out.push(...results);
    if (!data.standings?.has_next || results.length === 0) break;
    page += 1;
  }
  return { leagueName, results: out.slice(0, maxEntries) };
}
