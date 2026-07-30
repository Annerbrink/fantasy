// Runs for every request Pages serves. Adds a small set of security headers and turns any
// unhandled error into JSON for /api/ routes (so the client never has to parse Cloudflare's
// HTML error page), while letting static asset errors surface normally.

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function onRequest({ request, next }) {
  try {
    return withSecurityHeaders(await next());
  } catch (error) {
    console.error(error);
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) throw error;
    return withSecurityHeaders(
      new Response(JSON.stringify({ error: 'Something went wrong', detail: String(error?.message || error) }), {
        status: 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      })
    );
  }
}
