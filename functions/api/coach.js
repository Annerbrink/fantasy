// POST /api/coach
//
// Turns the structured advice (produced by /api/recommendations and posted back by the
// client) into a natural-language weekly game plan. Two providers, tried in order:
//   1. Claude (if ANTHROPIC_API_KEY is set) — highest quality.
//   2. Cloudflare Workers AI (if the `AI` binding is present) — free daily allowance on
//      your Cloudflare account, no key or billing required.
// Graceful fallback: if neither is available it returns { disabled: true } and the UI
// simply hides the AI panel — the algorithmic advice still works fully without it.
//
// Token usage per call is recorded (best-effort) in the optional `USAGE` KV namespace so
// the app can show a running daily total. See functions/api/usage.js.

import { buildCoachMessages } from '../../src/coach-prompt.js';
import { recordUsage } from './_usage.js';

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
    const result = hasClaude
      ? await coachWithClaude(env, system, user)
      : await coachWithWorkersAI(env, system, user);

    // Best-effort usage accounting — never let it fail the response.
    const usage = await recordUsage(env, result.provider, result.usage).catch(() => null);

    return json({ text: result.text, model: result.model, provider: result.provider, usage });
  } catch (err) {
    return json({ error: 'Coach request failed', detail: String(err?.message || err).slice(0, 300) }, 502);
  }
}

// --- Cloudflare Workers AI (free tier) ------------------------------------------------
// Try the configured model first, then a couple of widely-available fallbacks — model
// availability varies by account/region, and an unavailable model is a common cause of a
// silent failure. The last error is surfaced so /api/coach returns a useful message.
async function coachWithWorkersAI(env, system, user) {
  const models = [
    env.WORKERS_AI_MODEL,
    '@cf/meta/llama-3.1-8b-instruct',
    '@cf/meta/llama-3-8b-instruct',
    '@cf/mistral/mistral-7b-instruct-v0.1',
  ].filter(Boolean);

  let lastErr = null;
  for (const model of models) {
    try {
      const result = await env.AI.run(model, {
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: 900,
      });
      const text = (result?.response || '').trim();
      if (!text) throw new Error('empty response');
      const u = result?.usage || {};
      return {
        text,
        model,
        provider: 'workers-ai',
        usage: {
          inputTokens: u.prompt_tokens ?? null,
          outputTokens: u.completion_tokens ?? null,
          totalTokens: u.total_tokens ?? null,
        },
      };
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`Workers AI failed (${models.join(', ')}): ${String(lastErr?.message || lastErr)}`);
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
    return { text: 'The AI coach declined to answer this request.', model: payload.model, provider: 'claude', usage: {} };
  }
  const text = (payload.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  const u = payload.usage || {};
  return {
    text,
    model: payload.model,
    provider: 'claude',
    usage: {
      inputTokens: u.input_tokens ?? null,
      outputTokens: u.output_tokens ?? null,
      totalTokens: u.input_tokens != null ? (u.input_tokens + (u.output_tokens || 0)) : null,
    },
  };
}
