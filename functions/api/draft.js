// GET /api/draft?budget=&horizon=&randomize=&seed=&jitter=
//
// Builds an optimal-value 15-man FPL squad for the upcoming gameweek within budget and the
// standard squad rules, projected over `horizon` gameweeks. No manager data needed — this is
// a from-scratch team suggestion (great for GW1 or a Wildcard/Free Hit reset).
//
// Every response carries a team rating out of 100, scored against the optimal squad's
// projection. `randomize=1` returns an *alternative* draft (a seeded perturbation) so you
// can explore different-but-still-strong teams and see how much projection you trade away.

import { fpl } from '../../src/fpl-client.js';
import { resolveTargetGw } from '../../src/fdr.js';
import { scorePlayers } from '../../src/scoring.js';
import { buildDraft, buildBestDraft, mulberry32 } from '../../src/draft.js';

function gradeFor(rating) {
  if (rating >= 99) return 'Elite';
  if (rating >= 95) return 'Strong';
  if (rating >= 90) return 'Balanced';
  if (rating >= 84) return 'Punchy';
  return 'Risky';
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const budget = Math.min(Math.max(parseFloat(url.searchParams.get('budget') || '100') || 100, 80), 110);
  const horizon = Math.min(Math.max(parseInt(url.searchParams.get('horizon') || '5', 10) || 5, 1), 10);
  const randomize = url.searchParams.get('randomize') === '1';
  const jitter = Math.min(Math.max(parseFloat(url.searchParams.get('jitter') || '0.28') || 0.28, 0.05), 0.6);
  const seed = parseInt(url.searchParams.get('seed') || '', 10);
  // Must-have players to lock into the squad (the optimiser builds the rest around them).
  const lockedIds = (url.searchParams.get('lock') || '')
    .split(',')
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isFinite(n))
    .slice(0, 15);

  const [bootstrap, fixtures] = await Promise.all([fpl.bootstrap(), fpl.fixtures()]);
  const targetGw = resolveTargetGw(bootstrap.events);
  const scored = scorePlayers(bootstrap, fixtures, targetGw, horizon);

  // The multi-start best squad (no locks) is the rating benchmark (100).
  const optimal = buildBestDraft(scored, { budget });
  const optProj = optimal.squadProjection || 1;

  let draft = optimal;
  let usedSeed = 0;
  let isAlternative = false;
  if (randomize) {
    usedSeed = Number.isFinite(seed) ? seed : (Math.floor(Math.random() * 1e9) | 0);
    draft = buildDraft(scored, { budget, jitter, rng: mulberry32(usedSeed), lockedIds });
    isAlternative = true;
  } else if (lockedIds.length) {
    draft = buildBestDraft(scored, { budget, lockedIds });
  }

  const rating = Math.max(0, Math.min(100, Math.round((draft.squadProjection / optProj) * 100)));

  return new Response(
    JSON.stringify({
      targetGw,
      horizon,
      isAlternative,
      seed: usedSeed,
      rating,
      grade: gradeFor(rating),
      ratingBreakdown: {
        squadProjection: draft.squadProjection,
        avgFixtureDifficulty: draft.avgFixtureDifficulty,
        value: draft.value,
        optimalProjection: Math.round(optProj * 100) / 100,
      },
      ...draft,
    }),
    { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }
  );
}
