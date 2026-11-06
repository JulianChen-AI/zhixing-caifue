// IM channel: a signed webhook that understands one message with the same intent layer and engine as the App. It can
// query and draft; it can never authenticate. When a business reaches page authentication, the reply only points to
// the App card. No real WeChat / WeCom connection exists; channels are names in the signed payload.
import { z } from 'zod';
import type { BankAction, BankState } from '../bank/types.ts';
import type { IntentResult } from '../voice/intent-json.ts';
import { applyIntent } from '../voice/intent-json.ts';

export const MAX_SKEW_MS = 5 * 60 * 1000;
const body = z.object({
 channel: z.string().regex(/^[a-z0-9_-]{1,20}$/), userId: z.string().regex(/^[\w.@:-]{1,64}$/),
 text: z.string().trim().min(1).max(500), messageId: z.string().regex(/^[\w.:-]{1,100}$/).optional(),
}).strict();
export type ImMessage = z.infer<typeof body>;

export type ImSession = { state: BankState; commit(action: BankAction, requestId: string): Promise<BankState> };
export type ImDeps = {
 secret: string | undefined; now(): number; appUrl: string;
 session(owner: string): Promise<ImSession>;
 understand(state: BankState, text: string): Promise<IntentResult>;
 /** The App's own routing of a plan or workflow action (dispatchAction); identity in tests. */
 dispatch(state: BankState, action: BankAction, text: string): BankAction;
};

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
/** sha256=<hex of HMAC-SHA256(secret, "<timestamp>.<raw body>")>. */
export async function imSignature(secret: string, timestamp: string, raw: string) {
 const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
 return 'sha256=' + hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${raw}`)));
}
function sameText(a: string, b: string) {
 if (a.length !== b.length) return false;
 let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
 return diff === 0;
}
export async function verified(secret: string, req: { timestamp: string | null; signature: string | null; raw: string }, now: number) {
 if (!req.timestamp || !req.signature || !/^\d{10,13}$/.test(req.timestamp)) return false;
 const at = req.timestamp.length === 13 ? Number(req.timestamp) : Number(req.timestamp) * 1000;
 if (Math.abs(now - at) > MAX_SKEW_MS) return false;
 return sameText(await imSignature(secret, req.timestamp, req.raw), req.signature);
}

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
/** Authentication belongs to the App card; nothing from IM may carry it. */
const authenticates = (a: BankAction) => a.type === 'authenticate' || (a.type === 'workflow' || a.type === 'plan') && a.command.operation === 'authenticate';
/** A code typed into chat is never used; the user is told not to send it. */
const CODE = /(?:验证码|认证码|密码|动态码).{0,6}\d{4,8}|^\s*\d{6}\s*$/;

/** What the user should do next, read from the state the engine left. */
export function waitingForApp(s: BankState) {
 const task = s.workflows?.tasks.find(t => t.id === s.workflows?.currentTaskId);
 return task?.status === 'authenticate' || s.view === 'transfer' && s.task?.step === 'authenticate' ? (task?.title || '这笔转账') : null;
}

export async function handleIm(req: Request, deps: ImDeps): Promise<Response> {
 if (!deps.secret) return json({ error: 'IM 渠道未配置（缺少 IM_WEBHOOK_SECRET）。' }, 503);
 if (Number(req.headers.get('content-length')) > 8000) return json({ error: '消息过长。' }, 413);
 const raw = await req.text();
 if (raw.length > 8000) return json({ error: '消息过长。' }, 413);
 if (!await verified(deps.secret, { timestamp: req.headers.get('x-im-timestamp'), signature: req.headers.get('x-im-signature'), raw }, deps.now())) return json({ error: '签名无效或已过期。' }, 401);
 let message: ImMessage;
 try { message = body.parse(JSON.parse(raw)); } catch { return json({ error: '消息格式不正确。' }, 400); }
 const session = await deps.session(`im:${message.channel}:${message.userId}`);
 let state = session.state;
 const appLink = `请打开 App 在卡片上完成：${deps.appUrl}`;
 if (CODE.test(message.text)) return json({ reply: `IM 里不能认证，也请不要在聊天里发送验证码或密码。${appLink}`, status: waitingForApp(state) ? 'authenticate' : null });
 const understood = await deps.understand(state, message.text);
 if (understood.before && authenticates(understood.before) || understood.action && authenticates(understood.action)) return json({ reply: `IM 里不能认证。${appLink}` }, 403);
 if (!understood.action) return json({ reply: understood.say, status: null });
 // IM platforms retry deliveries; the message id makes a retried message a no-op in the engine.
 const base = message.messageId ? `im:${message.channel}:${message.messageId}` : `im:${crypto.randomUUID()}`;
 let n = 0;
 try {
  // Each IM message is one user turn: a confirmation counts only in a turn after the summary was shown.
  const turnId = `turn-${base}`;
  const turn = (a: BankAction): BankAction => a.type === 'workflow' || a.type === 'plan' ? { ...a, command: { ...a.command, turnId: a.command.turnId || turnId } } as BankAction : a;
  await applyIntent(understood, async a => { state = await session.commit(deps.dispatch(state, turn(a), message.text), n++ ? `${base}:${n}` : base); });
 } catch (error) {
  return json({ reply: error instanceof Error ? error.message : '没有办成，状态未改变。', status: 'error' });
 }
 const task = state.workflows?.tasks.find(t => t.id === state.workflows?.currentTaskId), waiting = waitingForApp(state);
 if (waiting) return json({ reply: `“${waiting}”已确认，下一步是认证。IM 里不能认证，${appLink}。认证前不会扣款。`, status: 'authenticate', appUrl: deps.appUrl });
 // The task's own message carries the result (a balance, a question); the plan wrapper only says a list finished.
 return json({ reply: task?.message || state.lastReply || understood.say, status: task?.status ?? null });
}
