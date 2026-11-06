// Local demo only: the /im page sends plain text here; this route signs it on the server, so the secret never reaches
// the browser, and binds it to the browser's own App session, so "去 App 认证" opens the same draft. Refused off localhost.
import { checkOrigin, loadSession, sessionHeaders } from '@/lib/bank/server';
import { handleIm, imSignature } from '@/lib/im/handler';
import { imDeps, imSession } from '@/lib/im/deps';

export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
 try {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(req.url).hostname)) return Response.json({ error: '模拟 IM 只在本机演示可用。' }, { status: 403 });
  checkOrigin(req);
  const { text, messageId } = await req.json() as { text?: unknown; messageId?: unknown };
  const app = await loadSession(req), deps = imDeps(req, async () => imSession(app));
  if (!deps.secret) return Response.json({ error: 'IM 渠道未配置（缺少 IM_WEBHOOK_SECRET）。' }, { status: 503 });
  const raw = JSON.stringify({ channel: 'simulator', userId: 'local-demo', text, ...(typeof messageId === 'string' ? { messageId } : {}) }), ts = String(Date.now());
  const signed = new Request(new URL('/api/im', req.url), { method: 'POST', body: raw, headers: { 'content-type': 'application/json', 'x-im-timestamp': ts, 'x-im-signature': await imSignature(deps.secret, ts, raw) } });
  // Keep the browser on the same App session, so the App page shows the draft IM left at authentication.
  const res = await handleIm(signed, deps), headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(sessionHeaders(app, req))) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
 } catch (e) { return Response.json({ error: e instanceof Error ? e.message : 'IM 处理失败。' }, { status: 500 }); }
}
