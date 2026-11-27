import { timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';

const COOKIE = 'fp_session';

function same(a: string | undefined, b: string): boolean {
  if (!a) return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Local-only access: Host must be this server (blocks DNS rebinding), a per-run token is exchanged for an
 * HttpOnly SameSite=Strict cookie, and state-changing requests must come from this origin (blocks CSRF).
 */
export function localAuth(token: string, port: number): MiddlewareHandler {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const origins = new Set([...hosts].map((h) => `http://${h}`));
  return async (c, next) => {
    if (!hosts.has(c.req.header('host') ?? '')) return c.text('Forbidden: this dashboard only answers on 127.0.0.1.', 403);
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && !origins.has(c.req.header('origin') ?? '')) {
      return c.text('Forbidden: request did not come from the dashboard page.', 403);
    }
    const t = c.req.query('t');
    if (t !== undefined) {
      if (!same(t, token)) return c.text('This dashboard link has expired. Open the dashboard again with: npm run dashboard', 401);
      setCookie(c, COOKIE, token, { httpOnly: true, sameSite: 'Strict', path: '/' });
      return c.redirect(new URL(c.req.url).pathname, 302);
    }
    if (!same(getCookie(c, COOKIE), token)) return c.text('Open the dashboard with: npm run dashboard', 401);
    c.header('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'");
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    await next();
  };
}
