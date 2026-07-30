// GET /api/health — quick diagnostic for provider/binding wiring. Does not call any model;
// just reports which bindings/secrets the Function can see. Use it to confirm the Workers AI
// `AI` binding actually reached the deployment.

export async function onRequestGet({ env }) {
  const body = {
    ok: true,
    providers: {
      workersAI: Boolean(env.AI), // true only if the `AI` binding is attached to this deploy
      claude: Boolean(env.ANTHROPIC_API_KEY),
    },
    usageKv: Boolean(env.USAGE),
    workersAiModel: env.WORKERS_AI_MODEL || '@cf/meta/llama-3.1-8b-instruct',
    time: new Date().toISOString(),
  };
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
