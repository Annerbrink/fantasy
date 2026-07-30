// Backtest / calibration harness — run with: npm run backtest
//
// For every completed gameweek this season, projects players *for that GW* (using current
// data) and compares to their actual returns: MAE, bias, and rank correlation, overall and
// per position. Use it to see how well the model tracks reality and to guide weight tuning.
//
// Caveat: a perfectly clean walk-forward test needs point-in-time data snapshots the FPL API
// doesn't expose, so this uses current season aggregates as a proxy — an indicative signal of
// ranking quality, not a pure forecast test. In pre-season (no finished GWs) it says so.

import { fpl } from '../src/fpl-client.js';
import { scorePlayers } from '../src/scoring.js';
import { evaluateProjection } from '../src/calibration.js';

const POS = { 1: 'GKP', 2: 'DEF', 3: 'MID', 4: 'FWD' };

async function main() {
  const [bootstrap, fixtures] = await Promise.all([fpl.bootstrap(), fpl.fixtures()]);
  const finished = bootstrap.events.filter((e) => e.finished && e.data_checked).map((e) => e.id);

  if (!finished.length) {
    console.log('No finished gameweeks yet (pre-season). Re-run once the season is underway.');
    return;
  }

  const elementType = new Map(bootstrap.elements.map((e) => [e.id, e.element_type]));
  const overall = [];
  console.log(`Backtesting ${finished.length} finished gameweek(s)…\n`);
  console.log('GW   n    MAE    bias   Spearman');

  for (const gw of finished) {
    const live = await fpl.eventLive(gw).catch(() => null);
    if (!live?.elements?.length) continue;
    const actualById = new Map();
    for (const el of live.elements) {
      if ((el.stats?.minutes || 0) > 0) actualById.set(el.id, el.stats?.total_points || 0);
    }
    const scored = scorePlayers(bootstrap, fixtures, gw);
    const r = evaluateProjection(scored, actualById, { field: 'projNext' });
    overall.push(r);
    console.log(
      `${String(gw).padEnd(4)} ${String(r.count).padEnd(4)} ${fmt(r.mae)} ${fmt(r.bias)}  ${fmt(r.spearman)}`
    );

    // Per-position breakdown for the most recent GW.
    if (gw === finished[finished.length - 1]) {
      console.log('\nLast GW per position:');
      for (const et of [1, 2, 3, 4]) {
        const posScored = scored.filter((p) => elementType.get(p.id) === et);
        const pr = evaluateProjection(posScored, actualById, { field: 'projNext' });
        if (pr.count) console.log(`  ${POS[et]}  n=${pr.count}  MAE=${fmt(pr.mae)}  bias=${fmt(pr.bias)}  Spearman=${fmt(pr.spearman)}`);
      }
    }
  }

  const avg = (k) => {
    const vals = overall.map((r) => r[k]).filter((v) => v != null);
    return vals.length ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 1000) / 1000 : null;
  };
  console.log(`\nAverages — MAE ${fmt(avg('mae'))}, bias ${fmt(avg('bias'))}, Spearman ${fmt(avg('spearman'))}`);
  console.log('Aim: Spearman as high as possible; bias near 0; lower MAE is better.');
}

function fmt(n) {
  return n == null ? '  n/a ' : String(n).padStart(5);
}

main().catch((e) => { console.error(e); process.exit(1); });
