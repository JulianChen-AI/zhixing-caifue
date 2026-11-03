import {dispatchAction,resumeAction} from '@/lib/plans/dispatch';
import {operationToolResult} from '@/lib/bank/tool-result';
import {recoveryInput,recoverDraft} from '@/lib/workflows/recovery';
import { checkOrigin, loadSession, sessionHeaders, configured, commit, plan, errorResponse, provider } from "@/lib/bank/server";
import { BankError } from "@/lib/bank/engine";
import type { BankAction } from "@/lib/bank/types";
import { z } from "zod";
import { realtimeToolArgumentsFor } from "@/lib/bank/realtime-tools";
import { workflowCardArguments } from '@/lib/workflows/realtime';
import { offlineWorkflow, workflowTextAction } from '@/lib/workflows/offline';
import { planCardArguments } from '@/lib/plans/schema';
import { contactsOf } from '@/lib/bank/recipients';
import { assertSceneEpoch, demoControlReplay, isDemoControl } from '@/lib/demo/control';
import { isComplexRequest } from '@/lib/plans/decompose';
import { planTextAction } from '@/lib/plans/engine';
import { toolCall, toolAction } from '@/lib/bank/tool-action';
import { applyIntent, echoesAssistant, understandIntent } from '@/lib/voice/intent-json';
const actionSchema = z.discriminatedUnion("type", [
  z.object({type:z.literal('plan'),command:planCardArguments}).strict(),
  z.object({type:z.literal('workflow'),command:workflowCardArguments}).strict(),
  z.object({ type: z.literal("select_recipient"), recipientId: z.string().max(60) }),
  z.object({ type: z.literal("edit"), amount: z.number().int().positive().optional(), accountId: z.string().max(60).optional(), note: z.string().max(60).nullable().optional() }),
  z.object({ type: z.literal("confirm") }),
  z.object({ type: z.literal("authenticate"), code: z.string().regex(/^\d{6}$/), verificationId: z.string().uuid() }),
  z.object({type:z.literal('load_scene'),sceneId:z.string().min(1).max(60)}).strict(),
  z.object({type:z.literal('advance_clock'),to:z.string().min(1).max(40)}).strict(),
  z.object({ type: z.literal("cancel") }), z.object({ type: z.literal("reset") }), z.object({ type: z.literal("home") }),
]);
const requestSchema = z.object({ requestId: z.string().min(8).max(100), revision: z.number().int().nonnegative(), sceneEpoch: z.string().uuid().optional(), command: z.string().trim().min(1).max(2000).optional(), history: z.array(z.object({ user: z.string().max(2000), reply: z.string().max(2000) })).max(20).optional(), mode: z.enum(["live", "demo"]).optional(), action: actionSchema.optional(), tool:toolCall.optional(), recovery:recoveryInput.optional() }).strict();
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try { const session = await loadSession(req); return Response.json({ state: session.state, liveConfigured: configured() }, { headers: sessionHeaders(session, req) }); }
  catch (e) { return errorResponse(e); }
}
export async function POST(req: Request) {
  try {
    checkOrigin(req);
    if (Number(req.headers.get("content-length")) > 24000) throw new BankError("请求过长。", 413);
    const parsed = requestSchema.safeParse(await req.json());
    if (!parsed.success) throw new BankError("请求信息不完整或格式不正确。");
    const body = parsed.data;
    if([body.tool,body.action,body.command,body.recovery].filter(v=>v!==undefined).length!==1)throw new BankError('一次请求只允许一种业务操作。');
    if (typeof body.requestId !== "string" || body.requestId.length > 100 || !Number.isSafeInteger(body.revision)) throw new BankError("请求信息不完整。");
    const session = await loadSession(req);
    if (body.action && (body.action.type==='load_scene'||body.action.type==='advance_clock'||body.action.type==='reset') && isDemoControl(session.state,body.action) && demoControlReplay(session.state,body.action,body.requestId,body.sceneEpoch)) return Response.json({state:session.state},{headers:sessionHeaders(session,req)});
    assertSceneEpoch(session.state,body.sceneEpoch);
    if (body.tool?.name === 'bank_request' && !realtimeToolArgumentsFor(contactsOf(session.state)).safeParse(body.tool.arguments).success) throw new BankError('请求信息不完整或格式不正确。');
    if (session.state.recentRequestIds.includes(body.requestId) && body.action && (body.action.type==='load_scene'||body.action.type==='advance_clock'||body.action.type==='reset') && isDemoControl(session.state,body.action)) throw new BankError('控制请求编号已使用，请刷新后重试。',409);
    if (session.state.recentRequestIds.includes(body.requestId)) return Response.json({ state: session.state,...(body.tool?{toolResult:operationToolResult(session.state,session.state,body.tool)}:{}) }, { headers: sessionHeaders(session, req) });
    let action: BankAction;
    if(body.recovery){
      if(session.state.revision!==body.revision)throw new BankError('办理内容已更新，请核对最新卡片。',409);
      const p=provider();if(!p.ready)throw new BankError('后台复核暂不可用，已保存的信息保留。',503);
      const recovered=await recoverDraft(session.state,body.recovery,p,req.signal);
      if(!recovered)return Response.json({state:session.state,recoveryChanged:false},{headers:sessionHeaders(session,req)});
      action=recovered;
    }else if (body.tool) {
      if (body.command != null || body.action != null) throw new BankError('一次只允许一种业务操作。');
      if (session.state.revision !== body.revision) throw new BankError('办理内容已更新，请先刷新事实再调用工具。',409);
      if(echoesAssistant(session.state,body.tool.utterance))throw new BankError('刚才这句是系统自己的播报，没有当作办理请求。');
      const mapped=toolAction(session.state,body.tool);
      if(!mapped)return Response.json({state:session.state},{headers:sessionHeaders(session,req)});
      action=mapped;
    } else if (body.command != null) {
      if (typeof body.command !== "string" || !body.command.trim() || body.command.length > 2000) throw new BankError("请用简短的话描述要办理的业务。");
      if (session.state.revision !== body.revision) throw new BankError("办理内容已更新，请重试。", 409);
      const p = provider();
      if (p.ready && p.intent === 'json') {
        // Earlier turns on screen resolve "这张卡/那笔"; they inform understanding only, never authorize anything.
        const history = (body.history || []).slice(-6).map(h => ({ user: h.user.slice(0, 300), reply: h.reply.slice(0, 200) }));
        const understood = await understandIntent(session.state, body.command, history, p, req.signal);
        // Nothing to change (a question or chat): show the reply without a new revision.
        if (!understood.action) return Response.json({ state: { ...session.state, lastReply: understood.say } }, { headers: sessionHeaders(session, req) });
        let n = 0;
        await applyIntent(understood, async a => { session.state = await commit(session, dispatchAction(session.state, a, body.command), session.state.revision, n++ ? `${body.requestId}:${n}` : body.requestId, body.sceneEpoch); });
        return Response.json({ state: session.state }, { headers: sessionHeaders(session, req) });
      }
      const continued=resumeAction(session.state,body.command)||planTextAction(session.state,body.command);
      const complex=isComplexRequest(body.command,session.state);
      const workflowContinued=!continued&&!complex?workflowTextAction(session.state,body.command):null;
      const offline=body.mode==='demo'?offlineWorkflow(body.command,session.state):null;
      action=continued||(complex?{type:'plan',command:{operation:'create',source:'voice',utterance:body.command}}:workflowContinued?{type:'workflow',command:workflowContinued}:offline?{type:'workflow',command:offline}:{ type: "route", decision: await plan(body.command, session.state, body.mode === "demo" ? "demo" : "live", req.signal) });
    } else {
      const allowed = ["select_recipient", "edit", "confirm", "authenticate", "cancel", "reset", "home", "workflow", "plan", "load_scene", "advance_clock"];
      if (!body.action || !allowed.includes(body.action.type)) throw new BankError("不支持这个操作。");
      action = body.action.type==='workflow'?{type:'workflow',command:{...body.action.command,source:'card'}}:body.action.type==='plan'?{type:'plan',command:{...body.action.command,source:'card'}}:body.action;
    }
    const previous=session.state;
    const state = await commit(session, dispatchAction(previous,action,body.tool?.utterance||body.command,body.tool?.turnId), body.revision, body.requestId, body.sceneEpoch);
    return Response.json({ state, ...(body.tool?{toolResult:operationToolResult(previous,state,body.tool)}:{}),...(body.recovery?{recoveryChanged:true}:{}) }, { headers: sessionHeaders(session, req) });
  } catch (e) { return errorResponse(e); }
}

