// POST /api/coach
//
// Turns the structured advice (produced by /api/recommendations and posted back by the
// client) into a natural-language weekly game plan. Two providers, tried in order:
//   1. Claude (if ANTHROPIC_API_KEY is set) — highest quality.
//   2. Cloudflare Workers AI (if the `AI` binding is present) — free daily allowance on
//      your Cloudflare account, no key or billing required.
// Graceful fallback: if neither is available it returns { disabled: true } and the UI
// simply hides the AI panel — the algorithmic advice still works fully without it.

import { buildCoachMessages } from '../../src/coach-prompt.js';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

export async function onRequestPost({ request, env }) {
  const hasClaude = Boolean(env.ANTHROPIC_API_KEY);
  const hasWorkersAI = Boolean(env.AI);
  if (!hasClaude && !hasWorkersAI) {
    return json({ disabled: true, reason: 'No AI provider configured (set ANTHROPIC_API_KEY or add a Workers AI binding named AI).' });
  }

  let advice;
  try {
    advice = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!advice || typeof advice !== 'object') return json({ error: 'Missing advice payload' }, 400);

  const { system, user } = buildCoachMessages(advice);

  try {
    if (hasClaude) return json(await coachWithClaude(env, system, user));
    return json(await coachWithWorkersAI(env, system, user));
  } catch (err) {
    return json({ error: 'Coach request failed', detail: String(err?.message || err).slice(0, 300) }, 502);
  }
}

// --- Cloudflare Workers AI (free tier) ------------------------------------------------
async function coachWithWorkersAI(env, system, user) {
  const model = env.WORKERS_AI_MODEL || '@cf/meta/llama-3.1-8b-instruct';
  const result = await env.AI.run(model, {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    max_tokens: 900,
  });
  const text = (result?.response || '').trim();
  return { text, model };
}

// --- Anthropic Claude (if a key is configured) ----------------------------------------
async function coachWithClaude(env, system, user) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: env.ANTHROPIC_MODEL || 'claude-opus-5',
      max_tokens: 1500,
      output_config: { effort: 'low' },
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Claude ${res.status}: ${detail.slice(0, 200)}`);
  }

  const payload = await res.json();
  if (payload.stop_reason === 'refusal') {
    return { text: 'The AI coach declined to answer this request.' };
  }
  const text = (payload.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  return { text, model: payload.model };
}
