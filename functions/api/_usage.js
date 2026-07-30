// Shared usage accounting for the AI coach. Underscore-prefixed, so Pages does not route
// it as an endpoint. Stores a per-day tally in the optional `USAGE` KV namespace, keyed by
// UTC date to line up with Cloudflare's daily Workers AI free-tier reset (00:00 UTC).
// Everything degrades gracefully when the KV binding is absent.

const FREE_NEURONS_PER_DAY = 10000; // Cloudflare Workers AI free daily allowance

function utcDate(d = new Date()) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function keyFor(date) {
  return `usage:${date}`;
}

// Add one call's token usage to today's tally. Returns the updated snapshot, or null when
// no KV namespace is bound. Best-effort: the caller wraps this in .catch().
export async function recordUsage(env, provider, usage) {
  if (!env.USAGE) return null;
  const date = utcDate();
  const key = keyFor(date);

  const current = (await env.USAGE.get(key, { type: 'json' })) || {
    date,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    byProvider: {},
  };

  current.calls += 1;
  current.inputTokens += usage?.inputTokens || 0;
  current.outputTokens += usage?.outputTokens || 0;
  current.byProvider[provider] = (current.byProvider[provider] || 0) + 1;

  // Keep tallies for a few days so history is inspectable, then let them expire.
  await env.USAGE.put(key, JSON.stringify(current), { expirationTtl: 60 * 60 * 24 * 7 });

  return snapshot(current, env);
}

// Read today's tally without mutating it.
export async function readUsage(env) {
  if (!env.USAGE) return { enabled: false, freeNeuronsPerDay: FREE_NEURONS_PER_DAY };
  const date = utcDate();
  const current = (await env.USAGE.get(keyFor(date), { type: 'json' })) || {
    date,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    byProvider: {},
  };
  return snapshot(current, env);
}

function snapshot(current, env) {
  const totalTokens = (current.inputTokens || 0) + (current.outputTokens || 0);
  // Optional rough Neuron estimate: only shown if you configure NEURONS_PER_1K_TOKENS,
  // since the exact token→Neuron rate varies by model. The Cloudflare dashboard remains the
  // source of truth for billed Neurons.
  const perK = parseFloat(env.NEURONS_PER_1K_TOKENS || '');
  const neuronsEstimate = Number.isFinite(perK) ? Math.round((totalTokens / 1000) * perK) : null;

  return {
    enabled: true,
    date: current.date,
    calls: current.calls,
    inputTokens: current.inputTokens,
    outputTokens: current.outputTokens,
    totalTokens,
    byProvider: current.byProvider,
    freeNeuronsPerDay: FREE_NEURONS_PER_DAY,
    neuronsEstimate, // null unless NEURONS_PER_1K_TOKENS is set
    resetsAt: '00:00 UTC',
  };
}
