import { z } from 'zod';
import { checkOrigin, loadSession, sessionHeaders, commit, provider, errorResponse } from '@/lib/bank/server';
import { BankError } from '@/lib/bank/engine';
import { bankToolResult } from '@/lib/bank/realtime-tools';
import { operationToolResult } from '@/lib/bank/tool-result';
import { toolAction } from '@/lib/bank/tool-action';
import { dispatchAction } from '@/lib/plans/dispatch';
import { delegationInput, runDelegation, qwenCompletion } from '@/lib/voice/delegation';
import { assertSceneEpoch } from '@/lib/demo/control';
import { contactsOf } from '@/lib/bank/recipients';
import { voiceSettings } from '@/lib/voice/qwen-protocol';
import { compactVoiceResult } from '@/lib/voice/session-context';
import { applyIntent, echoesAssistant, understandIntent } from '@/lib/voice/intent-json';
import { checklistResults } from '@/lib/ui/presentation';
const schema = z.object({ requestId: z.string().min(8).max(100), revision: z.number().int().nonnegative(), sceneEpoch: z.string().uuid().optional(), delegation: delegationInput }).strict();
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
 try {
  checkOrigin(req); if (Number(req.headers.get('content-length')) > 24000) throw new BankError('请求过长。', 413);
  const body = schema.parse(await req.json()), session = await loadSession(req);
  assertSceneEpoch(session.state,body.sceneEpoch);
  // A retried delegation must not let the backend model choose fresh writes for the same turn.
  if (session.state.recentRequestIds.some(id => id.startsWith(body.requestId + ':'))) return Response.json({ state: session.state, delegation: { status: 'unknown', stopReason:'unknown_result', summary: '这轮办理已经提交过，请以业务卡片的最新进度为准，不要重复提交。', toolCalls: 0, facts: compactVoiceResult(bankToolResult(session.state)), instruction: '只说明需要核对卡片，不再调用工具。' } }, { headers: sessionHeaders(session, req) });
  if (session.state.revision !== body.revision) return Response.json({error:'办理内容已更新，请先刷新事实再委托。',code:'delegation_not_started'},{status:409,headers:sessionHeaders(session,req)});
  if (echoesAssistant(session.state, body.delegation.utterance)) return Response.json({ state: session.state, delegation: { status: 'done', stopReason: 'completed', summary: '刚才这句是系统自己的播报，没有当作办理请求。', toolCalls: 0, facts: compactVoiceResult(bankToolResult(session.state)), instruction: '不要办理，也不要复述播报；一句话说明没有办理新业务。' } }, { headers: sessionHeaders(session, req) });
  const p = provider(); if (!p.ready) throw new BankError('后台办理暂不可用，已保存的信息保留。', 503);
  if (p.intent === 'json') {
   const u = body.delegation, understood = await understandIntent(session.state, u.utterance, (u.history || []).slice(0, -1).map(user => ({ user, reply: '' })), p, AbortSignal.any([req.signal, AbortSignal.timeout(20000)]));
   let n = 0;
   await applyIntent(understood, async a => { session.state = await commit(session, dispatchAction(session.state, a, u.utterance, u.turnId), session.state.revision, `${body.requestId}:${n++}`, body.sceneEpoch); });
   const task = session.state.workflows?.tasks.find(t => t.id === session.state.workflows?.currentTaskId);
   const waiting = task?.status === 'collecting' ? 'awaiting_input' as const : task?.status === 'review' ? 'awaiting_confirmation' as const : task?.status === 'authenticate' ? 'awaiting_authentication' as const : undefined;
   const summary = understood.action ? checklistResults(session.state) + (task?.message || session.state.lastReply || understood.say) : understood.say;
   return Response.json({ state: session.state, delegation: { status: waiting || understood.intent?.intent === 'ask' ? 'needs_user' : 'done', stopReason: waiting || (understood.intent?.intent === 'ask' ? 'awaiting_input' : 'completed'), summary, toolCalls: understood.action ? 1 : 0, facts: compactVoiceResult(bankToolResult(session.state)),
    instruction: waiting === 'awaiting_confirmation' || waiting === 'awaiting_authentication' ? '只按summary说明进度；待确认或待认证不能说业务已执行。' : '用自己的话简短告诉用户summary；金额、对象和结果只依据facts。' } }, { headers: sessionHeaders(session, req) });
  }
  let step = 0,requestSave=0;
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(25000)]);
  const complete=qwenCompletion(p, fetch, voiceSettings(p.voice, '', contactsOf(session.state)).tools);
  const delegation = await runDelegation(body.delegation, {
   state: () => session.state,
   saveRequest:async request=>{session.state=await commit(session,{type:'delegation_request',request},session.state.revision,`${body.requestId}:request-${requestSave++}`,body.sceneEpoch);},
   complete,reviewCompletion:complete,
   execute: async tool => {
    signal.throwIfAborted();
    const action = toolAction(session.state, tool);
    if (!action) return bankToolResult(session.state);
    const previous = session.state;
    session.state = await commit(session, dispatchAction(previous, action, tool.utterance, tool.turnId), previous.revision, `${body.requestId}:${step++}`, body.sceneEpoch);
    return operationToolResult(previous, session.state, tool);
   },
  }, signal).catch(error => {
   // Once a step committed, a failure is an unknown outcome, never a plain error the client might retry.
   if (!step || req.signal.aborted) throw error;
   return { status: 'unknown' as const, stopReason:'unknown_result' as const, summary: '这次办理结果尚未确认，需要先核对业务卡片的最新进度，不要重复提交。', toolCalls: step, facts: compactVoiceResult(bankToolResult(session.state)), instruction: '只说明需要核对卡片，不再调用工具。' };
  });
  return Response.json({ state: session.state, delegation }, { headers: sessionHeaders(session, req) });
 } catch (error) { return errorResponse(error); }
}
