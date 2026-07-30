// Calibration metrics for the projection model.
//
// Given projected vs actual points, compute how well the model tracks reality:
//   - MAE: mean absolute error (points off per player).
//   - bias: mean (projected − actual); positive = the model over-projects.
//   - spearman: rank correlation (does the model rank players in the right order?).
//
// Pure and unit-tested. Note: a rigorous walk-forward backtest needs point-in-time data
// snapshots the FPL API doesn't expose, so these are computed by comparing the model's
// current projection against a completed gameweek's actual returns — an *indicative* signal
// of ranking quality, not a perfectly clean forecast test.

function round(n) { return n == null ? null : Math.round(n * 1000) / 1000; }

export function mae(pairs) {
  if (!pairs.length) return null;
  return round(pairs.reduce((s, p) => s + Math.abs(p.proj - p.actual), 0) / pairs.length);
}

export function meanBias(pairs) {
  if (!pairs.length) return null;
  return round(pairs.reduce((s, p) => s + (p.proj - p.actual), 0) / pairs.length);
}

// Average-rank Spearman (handles ties by averaging their ranks).
export function spearman(pairs) {
  const n = pairs.length;
  if (n < 3) return null;
  const ranks = (key) => {
    const order = pairs.map((p, i) => [i, p[key]]).sort((a, b) => a[1] - b[1]);
    const r = new Array(n);
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && order[j + 1][1] === order[i][1]) j += 1;
      const avg = (i + j) / 2;
      for (let k = i; k <= j; k += 1) r[order[k][0]] = avg;
      i = j + 1;
    }
    return r;
  };
  const rp = ranks('proj');
  const ra = ranks('actual');
  let d2 = 0;
  for (let i = 0; i < n; i += 1) { const d = rp[i] - ra[i]; d2 += d * d; }
  return round(1 - (6 * d2) / (n * (n * n - 1)));
}

// Evaluate a scored list against actual points (Map id -> actual). `field` is the projection
// field to test (default projNext). Optionally restrict to players who actually featured.
export function evaluateProjection(scored, actualById, { field = 'projNext' } = {}) {
  const pairs = [];
  for (const p of scored) {
    const actual = actualById.get(p.id);
    if (actual == null) continue;
    pairs.push({ id: p.id, proj: p[field] || 0, actual });
  }
  return { count: pairs.length, mae: mae(pairs), bias: meanBias(pairs), spearman: spearman(pairs) };
}
