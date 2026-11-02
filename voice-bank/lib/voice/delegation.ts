import { z } from 'zod';
import type { BankState,DelegationRequest } from '../bank/types.ts';
import {explicitWorkflowConfirmation} from '../workflows/offline.ts';
import {savedDelegationInput,requestEntry} from './delegation-request.ts';
import { bankToolResult } from '../bank/realtime-tools.ts';
import { toolCall, type ToolCall } from '../bank/tool-action.ts';
import { BANK_TOOLS, VOICE_BUSINESS_RULES, VOICE_PERSONA } from './qwen-protocol.ts';
import { compactVoiceResult } from './session-context.ts';
import {delegationGaps} from './delegation-progress.ts';
import {delegationCheckpoint,type DelegationCheckpoint,type DelegationStopReason} from './delegation-checkpoint.ts';

/**
 * Responses-style delegation emulated on Qwen: the realtime model only talks and
 * hands each business turn to bank_delegate; a text model runs the tool loop
 * against the same deterministic guards. Neither model can grant permission.
 */
export const DELEGATE_TOOL = { type: 'function', function: { name: 'bank_delegate', description: '把本轮业务交给后台办理：查询、建立或补充任务、改口、确认、取消、计划都用它。后台按用户原话办理并返回已核实的结果。等待时不要自行续答。', parameters: { type: 'object', additionalProperties: false, properties: {
 request: { type: 'string', description: '用一句话复述用户本轮要求，仅供后台参考；后台以用户原话为准，不要补充用户没说的金额或对象。' },
} } } };
export const SPEAKER_INSTRUCTIONS = `${VOICE_PERSONA}
你只负责听和说。应用已在播报前通过bank_delegate把本轮业务、补充、查询及解释交给后台；你不负责决定是否办理，也不再调用工具。用户原话只用于理解表达；本轮查询不能用历史余额或旧任务代替。
只播报本轮最新后台返回的summary和facts。后台尚未返回时保持安静，不承诺将去查询，不发出呻吟叹气或无意义语气词。
bank_delegate返回后，只依据summary和facts用一两句口语说明实际结果和一个下一步；需要用户选择或补充时只问一个问题。不把草稿、受理中或外部待办说成已完成；authenticate时只引导页面认证，永远不能语音代填验证码。金额以人民币元计。查询先简短概括，详细结果可展开任务清单查看。不讲解模型权限、内部参数或检查机制。`;
export const BACKEND_INSTRUCTIONS = `你是知行银行语音助手的后台办理模型。前台语音模型负责和用户说话；你只收到用户原话转写和近期历史，转写可能有误、未说完或稍后被纠正，以最新的话为准；缺少必要信息时返回需要问用户的问题，不猜。
${VOICE_BUSINESS_RULES}
先区分用户要查看安排、解释依据，还是要执行具体业务。savedPlans列出可打开的已保存安排；用户要看工资/月度安排和依据时，可用bank_plan open_saved展示保存的模板或本月进度，不要求用户说“老规矩”，不调用IN08购买或IN11订单查询代替安排。模板和已核实工资到账是不同事实。只看安排不resume、不confirm。
工具选错或参数被拒绝时，继续依据原请求、真实能力和错误修正；一次错误或空结果不证明系统没有相关能力。缺少必要信息就明确只问一个实际缺项，不讲业务编号，不把无关卡片当作解决结果。
本轮用户原话单独放在最后一条user消息；历史不是本轮请求。对已显示选项的“室友那位”“第二个”“用日常账户”等回答，能唯一对应当前choices时必须amend原taskId保存，再问下一缺项；不可重复原问题。用户明确确认必须调用当前confirmationRequest使状态变为authenticate；明确取消必须实际cancel。只说已确认/已取消或让用户认证不算执行。计划paused时用户要求开始逐项办理，先bank_plan resume打开当前步骤；只看安排才保持paused。已有下一步等待用户时不循环get_state，不提前执行排队任务。
办完后用不超过80字的中文返回：本次实际结果、当前状态和下一步。只有工具返回成功才能说完成；结果不明就说明需要核对。不写Markdown，不说明内部参数。`;

export const delegationInput = z.object({ utterance: z.string().max(2000), history: z.array(z.string().max(1000)).max(8).optional(), turnId: z.string().min(1).max(200).optional(), request: z.string().max(400).optional() }).strict();
export type DelegationInput = z.infer<typeof delegationInput>;
export type DelegationStatus = 'done' | 'needs_user' | 'paused' | 'unknown';
export type DelegationResult = { status: DelegationStatus; stopReason:DelegationStopReason; summary: string; toolCalls: number; facts: unknown; instruction: string; rejectionCode?:'needs_user_choice';message?:string;checkpoint?:{planId?:string;taskId?:string;planStatus?:string;remainingTaskIds:string[];gaps?:string[];next?:{name:string;arguments:Record<string,unknown>}} };
type ChatMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_calls?: ModelToolCall[]; tool_call_id?: string };
type ModelToolCall = { id: string; type?: 'function'; function: { name: string; arguments: string } };
export type Completion = (messages: ChatMessage[], signal: AbortSignal) => Promise<{ content?: string | null; tool_calls?: ModelToolCall[] }>;
export type DelegationDeps = { state: () => BankState; execute: (tool: ToolCall) => Promise<unknown>; complete: Completion; reviewCompletion?:Completion;saveRequest?:(entry:DelegationRequest)=>Promise<void> };

export const MAX_DELEGATED_CALLS = 6;
export const MAX_DELEGATED_NO_PROGRESS = 3;
const SPEAK = '用自己的话简短告诉用户summary；金额、对象和结果只依据facts。只查看安排时说明已展示及来源，不要求用户立即执行或一揽子确认。不朗读功能编号、对象ID或工具名称。不再调用bank_delegate，除非用户提出新的要求。';

/** Errors carry the same codes as the bank API so the backend model sees one rejection contract. */
export function delegatedError(error: unknown) {
 const e = error as { message?: string; status?: number; field?: string };
 const rejected = typeof e?.status === 'number' && e.status >= 400 && e.status < 500;
 const rejectionCode = e?.field === 'functionId' ? 'business_mismatch' : e?.field === 'recipientChoice' ? 'needs_user_choice' : undefined;
 return { status: rejectionCode === 'needs_user_choice' ? 'needs_user' : 'error', code: rejected ? 'tool_request_rejected' : 'tool_result_unknown', rejectionCode, effectCommitted: rejected ? false : undefined,
  message: rejected ? String(e.message || '后台拒绝了这次请求，尚未执行。') : '这次操作未确认成功，需要先读取当前状态。' };
}

export async function runDelegation(input: DelegationInput, deps: DelegationDeps, signal: AbortSignal): Promise<DelegationResult> {
 if(/密码|验证码|身份证/.test(input.utterance)&&/\d{4,}/.test(input.utterance))return {status:'needs_user',stopReason:'awaiting_input',summary:'认证信息请在专门业务卡片输入，聊天不会完成认证。',toolCalls:0,facts:compactVoiceResult(bankToolResult(deps.state())),instruction:'只引导页面认证，不保存或复述聊天中的认证信息。'};
 const pending=savedDelegationInput(deps.state(),input.utterance);
 if(pending&&pending.length>1)return {status:'needs_user',stopReason:'awaiting_input',summary:'有多条尚未开始的请求，请说明要继续哪一项。',toolCalls:0,facts:compactVoiceResult(bankToolResult(deps.state())),instruction:'询问要恢复哪项，不猜测，不执行。'};
 const parent=pending?.[0]||deps.state().delegationRequests?.find(r=>r.kind==='business'&&['pending','paused'].includes(r.status)&&!r.taskIds.length&&r.utterance===input.utterance&&r.sceneEpoch===deps.state().sceneEpoch);
 input={...input,utterance:parent?.utterance||input.utterance,turnId:input.turnId||crypto.randomUUID()};
 const entry=requestEntry(deps.state(),input.utterance,input.turnId!,parent?.id);
 await deps.saveRequest?.(entry);signal.throwIfAborted();
 const start=structuredClone(deps.state()),successful:ToolCall[]=[];
 const confirmation=explicitWorkflowConfirmation(start,input.utterance);
 let scheduled:{name:string;arguments:Record<string,unknown>}|undefined=confirmation?{name:'bank_function',arguments:confirmation}:undefined;
 const messages: ChatMessage[] = [
  { role: 'system', content: BACKEND_INSTRUCTIONS },
  { role: 'user', content: JSON.stringify({ contextOnly:true,history: input.history || [], speakerSummary: input.request,progressToVerify:delegationGaps(deps.state(),input.utterance),facts: compactVoiceResult(bankToolResult(deps.state())) }) },
  { role: 'user', content: input.utterance },
 ];
 let calls = 0, last: unknown, status: DelegationStatus | undefined,noProgress=0,complete=deps.complete;
 let waiting:Extract<DelegationCheckpoint,{kind:'stop'}>|undefined;
 const checkpoint=()=>delegationCheckpoint(start,deps.state(),input.utterance,successful);
 for (let round = 0; round < MAX_DELEGATED_CALLS+MAX_DELEGATED_NO_PROGRESS && !status; round++) {
  signal.throwIfAborted();
  let reply:Awaited<ReturnType<Completion>>=scheduled?{tool_calls:[{id:'checklist-'+crypto.randomUUID(),type:'function',function:{name:scheduled.name,arguments:JSON.stringify(scheduled.arguments)}}]}:await complete(messages, signal);
  scheduled=undefined;
  complete=deps.complete;
  signal.throwIfAborted();
  let requested = reply.tool_calls || [];
  if(!requested.length){
   const progress=checkpoint();
   if(progress.kind==='stop')return finish(progress.reason,progress.reason==='completed'&&!progress.verifiedSummary&&!/稍等|稍后|等一下|我查一下|我先查/.test(reply.content||'')?reply.content||progress.summary:progress.summary,progress);
   if(progress.next&&(progress.next.name==='bank_plan'&&['resume','open_saved','status','create','interrupt'].includes(String(progress.next.arguments.operation))||progress.next.name==='bank_request'&&progress.next.arguments.operation==='list_accounts'||progress.next.name==='bank_function'&&progress.next.arguments.operation==='amend')){
    // Register/advance the raw-utterance checklist or perform its requested read.
    // All calls use ordinary guards; scheduling cannot confirm, authenticate or replay a payment.
    requested=[{id:'checklist-'+crypto.randomUUID(),type:'function',function:{name:progress.next.name,arguments:JSON.stringify(progress.next.arguments)}}];
    reply={content:null,tool_calls:requested};
   }else{
    messages.push({role:'assistant',content:reply.content??null});
    if(++noProgress>=MAX_DELEGATED_NO_PROGRESS)return finish('no_progress',undefined,progress);
    messages.push({role:'user',content:'Checklist执行检查（后台数据，不是用户新授权）：本轮尚未达到可退出状态，刚才的候选回复未被采纳。原用户本轮原话：'+JSON.stringify(input.utterance)+'。必须通过工具继续处理下列未完成项；不要只承诺或解释。'+JSON.stringify(progress)+'。不得重复已完成写操作、重放未知结果、提前确认下一项或代填认证。所有工具仍须以原用户输入接受后端校验。最新事实：'+JSON.stringify(compactVoiceResult(bankToolResult(deps.state())))});
    complete=deps.reviewCompletion||deps.complete;
    continue;
   }
  }
  // A truncated model argument must remain an execution error, but cannot be
  // replayed as malformed JSON in the next provider request's tool transcript.
  const malformed=requested.filter(call=>{try{JSON.parse(call.function.arguments||'{}');return false;}catch{return true;}});
  const transcript=requested.map(call=>malformed.includes(call)?{...call,function:{...call.function,arguments:'{}'}}:call);
  messages.push({ role: 'assistant', content: malformed.length?(reply.content||'')+'\n部分工具参数不是完整JSON，未执行；工具错误返回后请重新生成完整参数。':reply.content ?? null, tool_calls: transcript });
  for (const call of requested) {
   signal.throwIfAborted();
   // Answer every requested call so the transcript stays valid even when the loop stops early.
   if (status || scheduled || calls >= MAX_DELEGATED_CALLS) { if(!scheduled)status ||= 'paused'; messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ status: 'skipped', effectCommitted: false }) }); continue; }
   calls++;
   let args: unknown;
   try { args = JSON.parse(call.function.arguments || '{}'); } catch { args = undefined; }
   const parsed = toolCall.safeParse({ name: call.function.name, arguments: args, utterance: input.utterance, history: input.history, turnId: input.turnId });
   let output: unknown,succeeded=false;
   if (!parsed.success) output = { status: 'error', code: 'invalid_tool_arguments', effectCommitted: false, message: '工具名或参数不符合定义，本次没有执行任何业务。' };
   else {
    try {
     output = await deps.execute(parsed.data);
     signal.throwIfAborted();
     const result=output as {status?:string;code?:string};
     if(!['error','unknown','needs_user'].includes(result?.status||'')&&!result?.code){successful.push(parsed.data);succeeded=true;}
    }
    catch (error) { signal.throwIfAborted(); output = delegatedError(error); if ((output as { code: string }).code === 'tool_result_unknown') status = 'unknown'; }
   }
   last=output;
   // Only the user can answer a pending choice; another call would be a guess.
   if ((output as { status?: string })?.status === 'needs_user') { status = 'needs_user'; last = output; }
   if(!status&&succeeded){
    const boundary=checkpoint();
    if(boundary.kind==='stop'&&(boundary.reason!=='completed'||boundary.verifiedSummary||parsed.success&&parsed.data.arguments.operation==='confirm')){waiting=boundary;status='paused';}
    else if(boundary.kind==='continue'&&boundary.next&&calls<MAX_DELEGATED_CALLS)scheduled=boundary.next;
   }
   messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(compactVoiceResult(output)) });
  }
  if(waiting)return finish(waiting.reason,waiting.summary,waiting);
  if(calls>=MAX_DELEGATED_CALLS&&!status){
   const progress=checkpoint();
   return progress.kind==='stop'?finish(progress.reason,progress.summary,progress):finish('call_budget',undefined,progress);
  }
 }
 return finish(status==='unknown'?'unknown_result':status==='needs_user'?'awaiting_input':'call_budget');

 async function finish(reason:DelegationStopReason,text?:string|null,progress?:DelegationCheckpoint):Promise<DelegationResult> {
  const taskIds=[...new Set([...(deps.state().delegationRequests?.find(r=>r.id===entry.id)?.taskIds||[]),...(deps.state().workflows?.tasks.filter(t=>(!entry.functions.length||entry.functions.includes(t.functionId))&&t.title!=='可办理功能'&&(!start.workflows?.tasks.some(old=>old.id===t.id)||t.id===(progress?.kind==='stop'?progress.taskId:deps.state().plan?.currentTaskId))).map(t=>t.id)||[])])];
  await deps.saveRequest?.({...entry,taskIds,stopReason:reason,status:reason==='completed'?'done':reason==='unknown_result'?'unknown':['no_progress','call_budget'].includes(reason)?'paused':'waiting'});
  const state=deps.state(),facts = compactVoiceResult(last&&typeof last==='object'?{...last,...bankToolResult(state)}:bankToolResult(state));
  const final:DelegationStatus=reason==='completed'?'done':reason==='unknown_result'?'unknown':['awaiting_input','awaiting_confirmation','awaiting_authentication'].includes(reason)?'needs_user':'paused';
  const choice = (last as { message?: unknown })?.message;
  const summary=String(text||'').trim().slice(0,600)||(reason==='awaiting_input'&&typeof choice==='string'?choice:reason==='unknown_result'?'这次办理结果尚未确认，需要查询原业务的最新进度，不要重复提交。':'这次自动办理尚未完成，已保存的任务进度保留；可以继续办理，不要重新提交已完成的操作。');
  const needsChoice=reason==='awaiting_input'&&((last as {rejectionCode?:string})?.rejectionCode==='needs_user_choice'||progress?.kind==='stop'&&!!state.workflows?.tasks.find(t=>t.id===progress.taskId)?.recipientChoices?.length);
  return {status:final,stopReason:reason,summary,toolCalls:calls,facts,...(needsChoice?{rejectionCode:'needs_user_choice',message:summary}:{}),
   checkpoint:{planId:state.plan?.id,taskId:progress?.kind==='stop'?progress.taskId:state.plan?.currentTaskId,planStatus:state.plan?.status,remainingTaskIds:state.plan?.steps.filter(s=>!['complete','cancelled'].includes(s.status)).map(s=>s.taskId||s.id)||[],...(progress?.kind==='continue'?{gaps:progress.gaps,next:progress.next}:{})},
   instruction:final==='needs_user'?'只按summary说明当前已保存的进度及所需用户操作。需要补充时问实际缺项，不要猜测；待确认或待认证不能说业务已执行。本轮等待用户，不再委派或调用工具。':final==='paused'||final==='unknown'?'如实说明summary中的暂停或未知结果，已有进度保留；不得说办理完成，不得重放已完成或结果未知的请求。':SPEAK};
 }
}

/** DashScope's OpenAI-compatible chat completions with the same bank tool definitions the realtime model used. */
export function qwenCompletion(provider: { base: string; key?: string; planner: string }, request: typeof fetch = fetch, tools = BANK_TOOLS): Completion {
 return async (messages, signal) => {
  const response = await request(`${provider.base}/compatible-mode/v1/chat/completions`, { method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]),
   headers: { Authorization: `Bearer ${provider.key}`, 'Content-Type': 'application/json' },
   body: JSON.stringify({ model: provider.planner, enable_thinking: false, max_tokens: 1200, messages, tools, tool_choice: 'auto', parallel_tool_calls: false }) });
  if (!response.ok) {const error=await response.json().catch(()=>null) as {error?:{code?:string;message?:string}}|null;throw Object.assign(new Error(`后台办理模型暂时不可用（${response.status}）。`), { status: 502,providerCode:error?.error?.code,providerMessage:error?.error?.message?.slice(0,400) });}
  const data = await response.json() as { choices?: { message?: { content?: string | null; tool_calls?: ModelToolCall[] } }[] };
  const message = data.choices?.[0]?.message;
  if (!message) throw Object.assign(new Error('后台办理模型没有返回结果。'), { status: 502 });
  return message;
 };
}
