import test from 'node:test';
import assert from 'node:assert/strict';
import { serveIdentity } from '../lib/bank/tailscale.ts';

const origin = 'https://example.tail123.ts.net';
function request(url = origin, login?: string) {
  return new Request(url, { headers: login ? { 'tailscale-user-login': login } : {} });
}
test('Serve identity is opt-in and requires an authenticated login and the configured host', () => {
  assert.equal(serveIdentity(request(origin, 'alice@example.com')), null);
  assert.equal(serveIdentity(request(), origin), null);
  assert.equal(serveIdentity(request('https://other.tail123.ts.net', 'alice@example.com'), origin), null);
  assert.equal(serveIdentity(request('https://example.tail123.ts.net:8443', 'alice@example.com'), origin), null);
  assert.deepEqual(serveIdentity(request(origin, 'alice@example.com'), origin), { owner: 'tailscale:alice@example.com', origin });
});
test('TLS-terminated requests use the exact external HTTPS origin and preserve distinct owners', () => {
  const alice = serveIdentity(request('http://example.tail123.ts.net/api/bank', 'alice@example.com'), origin)!;
  const bob = serveIdentity(request(origin, 'bob@example.com'), origin)!;
  assert.equal(alice.origin, origin);
  assert.notEqual(alice.owner, bob.owner);
});
test('invalid or non-origin Serve configuration cannot enable header authentication', () => {
  for (const config of ['garbage', 'http://example.tail123.ts.net', `${origin}/extra`, `${origin}?x=1`, 'https://user@example.tail123.ts.net']) {
    assert.equal(serveIdentity(request(origin, 'alice@example.com'), config), null);
  }
});
