// GET /api/draft?budget=&horizon=
//
// Builds an optimal-value 15-man FPL squad for the upcoming gameweek within budget and the
// standard squad rules, projected over `horizon` gameweeks. No manager data needed — this is
// a from-scratch team suggestion (great for GW1 or a Wildcard/Free Hit reset).

import { fpl } from '../../src/fpl-client.js';
import { resolveTargetGw } from '../../src/fdr.js';
import { scorePlayers } from '../../src/scoring.js';
import { buildDraft } from '../../src/draft.js';

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const budget = Math.min(Math.max(parseFloat(url.searchParams.get('budget') || '100') || 100, 80), 110);
  const horizon = Math.min(Math.max(parseInt(url.searchParams.get('horizon') || '5', 10) || 5, 1), 10);

  const [bootstrap, fixtures] = await Promise.all([fpl.bootstrap(), fpl.fixtures()]);
  const targetGw = resolveTargetGw(bootstrap.events);
  const scored = scorePlayers(bootstrap, fixtures, targetGw, horizon);
  const draft = buildDraft(scored, { budget });

  return new Response(JSON.stringify({ targetGw, horizon, ...draft }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
