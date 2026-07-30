// GET /api/usage — today's AI coach usage tally (calls + tokens), for the in-app counter.
// Returns { enabled: false } when no USAGE KV namespace is bound, so the UI hides the badge.

import { readUsage } from './_usage.js';

export async function onRequestGet({ env }) {
  const usage = await readUsage(env).catch(() => ({ enabled: false }));
  return new Response(JSON.stringify(usage), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
