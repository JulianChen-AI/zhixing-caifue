import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduceBank } from '../lib/bank/engine.ts';
import type { BankAction, BankState } from '../lib/bank/types.ts';
import { handleIm, imSignature, MAX_SKEW_MS, type ImDeps } from '../lib/im/handler.ts';
import { understandIntent } from '../lib/voice/intent-json.ts';
import { dispatchAction } from '../lib/plans/dispatch.ts';

const SECRET = 'test-secret-not-real';
const NOW = Date.parse('2026-10-25T04:00:00.000Z');
const fake = (body: object) => (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }))) as typeof fetch;

/** Sessions by owner, the real engine, and a scripted model answer per message. */
function world(answers: Record<string, object>, secret: string | undefined = SECRET) {
 const sessions = new Map<string, BankState>();
 const deps: ImDeps = {
  secret, now: () => NOW, appUrl: 'http://127.0.0.1:5173/',
  session: async owner => {
   if (!sessions.has(owner)) { const s = initialState(); s.demoClock = new Date(NOW).toISOString(); sessions.set(owner, s); }
   return { state: sessions.get(owner)!, commit: async (action: BankAction, requestId: string) => { const next = reduceBank(sessions.get(owner)!, action, requestId); sessions.set(owner, next); return next; } };
  },
  understand: (state, text) => understandIntent(state, text, [], { base: 'x', planner: 'm' }, new AbortController().signal, fake(answers[text] || { intent: 'chat', say: '好的' })),
  dispatch: (s, action, text) => dispatchAction(s, action, text),
 };
 return { deps, sessions };
}
async function post(deps: ImDeps, payload: object, opts: { secret?: string; ts?: number; signature?: string } = {}) {
 const raw = JSON.stringify(payload), ts = String(opts.ts ?? NOW);
 const signature = opts.signature ?? await imSignature(opts.secret ?? SECRET, ts, raw);
 const res = await handleIm(new Request('http://127.0.0.1/api/im', { method: 'POST', body: raw, headers: { 'x-im-timestamp': ts, 'x-im-signature': signature } }), deps);
 return { status: res.status, body: await res.json() as { reply?: string; error?: string; status?: string | null; appUrl?: string } };
}
const msg = (text: string, extra: object = {}) => ({ channel: 'wecom', userId: 'u-1', text, ...extra });

test('IM: no secret configured answers 503 and touches nothing', async () => {
 const { deps, sessions } = world({}, '');
 assert.equal((await post(deps, msg('查余额'))).status, 503);
 assert.equal(sessions.size, 0);
});

test('IM: a wrong, missing or stale signature answers 401', async () => {
 const { deps, sessions } = world({});
 assert.equal((await post(deps, msg('查余额'), { secret: 'another-secret' })).status, 401);
 assert.equal((await post(deps, msg('查余额'), { signature: 'sha256=00' })).status, 401);
 assert.equal((await post(deps, msg('查余额'), { ts: NOW - MAX_SKEW_MS - 1000 })).status, 401);
 const raw = JSON.stringify(msg('查余额')), ts = String(NOW), sig = await imSignature(SECRET, ts, raw);
 const tampered = new Request('http://127.0.0.1/api/im', { method: 'POST', body: raw.replace('查余额', '转5000'), headers: { 'x-im-timestamp': ts, 'x-im-signature': sig } });
 assert.equal((await handleIm(tampered, deps)).status, 401);
 assert.equal(sessions.size, 0);
});

test('IM: a read-only query returns its result', async () => {
 const { deps } = world({ '查一下余额': { intent: 'run', functionId: 'TR02', params: {} } });
 const r = await post(deps, msg('查一下余额'));
 assert.equal(r.status, 200);
 assert.equal(r.body.status, 'complete');
 assert.match(r.body.reply!, /^日常账户余额 ¥/);
});

test('IM: a transfer can be drafted but not confirmed or authenticated in chat; the reply points to the App card', async () => {
 const { deps, sessions } = world({
  '给室友张三转200，用日常账户': { intent: 'run', functionId: 'TR03', params: { recipientId: 'zhang-roommate', accountId: 'daily', amount: 200 } },
  '确认': { intent: 'confirm' },
 });
 const draft = await post(deps, msg('给室友张三转200，用日常账户'));
 assert.equal(draft.body.status, 'review', draft.body.reply);
 const confirmed = await post(deps, msg('确认'));
 assert.match(confirmed.body.reply!, /卡片上核对后点“确认”/);
 // A code sent in chat is refused and never reaches the engine.
 const code = await post(deps, msg('验证码123456'));
 assert.match(code.body.reply!, /不能认证/);
 const s = sessions.get('im:wecom:u-1')!;
 assert.equal(s.workflows!.tasks.find(t => t.id === s.workflows!.currentTaskId)!.status, 'review');
 assert.equal(s.receipts.length, 0);
 assert.equal(s.accounts.find(a => a.id === 'daily')!.balance, initialState().accounts.find(a => a.id === 'daily')!.balance);
});

test('IM: sessions are per IM user, and a retried message id is applied once', async () => {
 const { deps, sessions } = world({ '给室友张三转200，用日常账户': { intent: 'run', functionId: 'TR03', params: { recipientId: 'zhang-roommate', accountId: 'daily', amount: 200 } } });
 await post(deps, msg('给室友张三转200，用日常账户', { messageId: 'm-1' }));
 const revision = sessions.get('im:wecom:u-1')!.revision;
 await post(deps, msg('给室友张三转200，用日常账户', { messageId: 'm-1' }));
 assert.equal(sessions.get('im:wecom:u-1')!.revision, revision);
 await post(deps, { ...msg('给室友张三转200，用日常账户'), userId: 'u-2' });
 assert.deepEqual([...sessions.keys()].sort(), ['im:wecom:u-1', 'im:wecom:u-2']);
 assert.equal((await post(deps, { channel: 'wecom', userId: 'u 1', text: 'x' })).status, 400);
});
