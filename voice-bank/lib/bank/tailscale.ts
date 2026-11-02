// Enable only behind Tailscale Serve, with the app bound to loopback.
// Serve strips client-supplied identity headers and sets the authenticated login.
export function serveIdentity(req: Request, configuredOrigin?: string): { owner: string; origin: string } | null {
  if (!configuredOrigin) return null;
  let expected: URL;
  try { expected = new URL(configuredOrigin); } catch { return null; }
  if (expected.protocol !== 'https:' || expected.username || expected.password || expected.pathname !== '/' || expected.search || expected.hash) return null;
  const actual = new URL(req.url);
  // Serve terminates TLS; the local Worker may see http with the original host.
  if (actual.host !== expected.host || !['http:', 'https:'].includes(actual.protocol)) return null;
  const login = req.headers.get('tailscale-user-login')?.trim();
  if (!login || login.length > 254) return null;
  return { owner: `tailscale:${login}`, origin: expected.origin };
}
