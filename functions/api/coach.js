// POST /api/coach
//
// Turns the structured advice (produced by /api/recommendations and posted back by the
// client) into a natural-language weekly game plan via the Claude Messages API. The API key
// lives only in the Cloudflare environment as a secret. Graceful fallback: if no key is
// configured the endpoint returns { disabled: true } and the UI simply hides the AI panel —
// the algorithmic advice still works fully without it.

import { buildCoachMessages } from '../../src/coach-prompt.js';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

export async function onRequestPost({ request, env }) {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ disabled: true, reason: 'No ANTHROPIC_API_KEY configured.' });

  let advice;
  try {
    advice = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!advice || typeof advice !== 'object') return json({ error: 'Missing advice payload' }, 400);

  const { system, user } = buildCoachMessages(advice);

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: env.ANTHROPIC_MODEL || 'claude-opus-5',
      max_tokens: 1500,
      // Adaptive thinking (on by default for Opus 5); keep effort low for a fast, cheap
      // weekly summary — this is explanation, not deep reasoning.
      output_config: { effort: 'low' },
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return json({ error: 'Coach request failed', status: res.status, detail: detail.slice(0, 500) }, 502);
  }

  const payload = await res.json();
  // Claude returned a refusal rather than content — surface it cleanly.
  if (payload.stop_reason === 'refusal') {
    return json({ disabled: false, text: 'The AI coach declined to answer this request.' });
  }
  const text = (payload.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  return json({ text, model: payload.model });
}
