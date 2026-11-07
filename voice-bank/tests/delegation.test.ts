import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduceBank } from '../lib/bank/engine.ts';
import { contactsOf } from '../lib/bank/recipients.ts';
import type { BankState } from '../lib/bank/types.ts';
import { toolAction, type ToolCall } from '../lib/bank/tool-action.ts';
import { operationToolResult } from '../lib/bank/tool-result.ts';
import { bankToolResult } from '../lib/bank/realtime-tools.ts';
import { dispatchAction } from '../lib/plans/dispatch.ts';
import { workflowToolResult } from '../lib/workflows/realtime.ts';
import { WorkflowError } from '../lib/workflows/types.ts';
import { runDelegation, MAX_DELEGATED_CALLS, MAX_DELEGATED_NO_PROGRESS, DELEGATE_TOOL, SPEAKER_INSTRUCTIONS, BACKEND_INSTRUCTIONS, type Completion, qwenCompletion } from '../lib/voice/delegation.ts';
import { QwenConversation, voiceSettings, VOICE_INSTRUCTIONS, VOICE_BUSINESS_RULES } from '../lib/voice/qwen-protocol.ts';
import {delegationCheckpoint} from '../lib/voice/delegation-checkpoint.ts';

type Reply = Awaited<ReturnType<Completion>>;
const call = (id: string, name: string, args: unknown) => ({ id, type: 'function' as const, function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } });
function scripted(replies: Reply[]) {
 const seen: Parameters<Completion>[0][] = [];
 const complete: Completion = async messages => { seen.push(structuredClone(messages)); const next = replies.shift(); assert.ok(next, 'unexpected extra model round'); return next; };
 return { complete, seen };
}
/** The same mapping, dispatch and reducer the delegate route commits through, minus the database. */
function sandbox(start: BankState = initialState()) {
 let state = start;
 const executed: ToolCall[] = [];
 const execute = async (tool: ToolCall) => {
  executed.push(tool);
  const action = toolAction(state, tool);
  if (!action) return bankToolResult(state);
  const previous = state;
  state = reduceBank(previous, dispatchAction(previous, action, tool.utterance, tool.turnId), crypto.randomUUID());
  return operationToolResult(previous, state, tool);
 };
 const saveRequest=async(request:import('../lib/bank/types.ts').DelegationRequest)=>{state=reduceBank(state,{type:'delegation_request',request},crypto.randomUUID());};
 return { execute, executed, state: () => state,saveRequest };
}
const signal = () => new AbortController().signal;

test('delegated calls run under the user utterance, not words the backend model supplies', async () => {
 const bank = sandbox();
 const model = scripted([
  // The backend model invents a fourth member; the deterministic guard only trusts the user's words.
  { content: null, tool_calls: [call('c1', 'bank_function', { operation: 'run', functionId: 'TR05', params: { action: 'create', total: 100, participants: ['我', '室友张三', '房东张三', '王五'] } })] },
  { content: null, tool_calls: [call('c2', 'bank_function', { operation: 'run', functionId: 'TR05', params: { action: 'create', total: 100, participants: ['我', '室友张三', '房东张三'] } })] },
  { content: '已建立AA草稿，请核对成员。' },
 ]);
 const result = await runDelegation({ utterance: '三个人AA一百块钱，我、室友张三、房东张三', turnId: 't1' }, { ...bank, complete: model.complete }, signal());
 assert.equal(bank.executed[0].utterance, '三个人AA一百块钱，我、室友张三、房东张三');
 // The rejection reached the backend model as a tool result with nothing committed.
 const rejection = JSON.parse(model.seen[1].at(-1)!.content!);
 assert.deepEqual([rejection.code, rejection.effectCommitted], ['tool_request_rejected', false]);
 assert.equal(result.status, 'needs_user');assert.equal(result.stopReason,'awaiting_confirmation');
 assert.equal(result.toolCalls, 2);
 const task = workflowToolResult(bank.state())!;
 assert.deepEqual(task.params.participants, ['我', '室友张三', '房东张三']);
 assert.equal(bank.state().workflows!.records.aa.length, 0, 'a draft is never a settlement');
 assert.match(result.summary,/请确认名单和规则/);
});

test('invalid tool names or arguments are reported back without executing anything', async () => {
 const bank = sandbox();
 const model = scripted([
  { content: null, tool_calls: [call('c1', 'bank_function', '{"operation":'), call('c2', 'transfer_money', { amount: 500 })] },
  { content: '没有执行任何业务，请再说一次要办理的内容。' },
  ...Array.from({length:MAX_DELEGATED_NO_PROGRESS-1},()=>({content:'没有执行任何业务。'})),
 ]);
 const result = await runDelegation({ utterance: '看看能办什么' }, { ...bank, complete: model.complete }, signal());
 assert.equal(bank.executed.length, 0);
 const outputs = model.seen[1].filter(m => m.role === 'tool').map(m => JSON.parse(m.content!));
 assert.deepEqual(outputs.map(o => [o.code, o.effectCommitted]), [['invalid_tool_arguments', false], ['invalid_tool_arguments', false]]);
 assert.equal(bank.state().workflows!.tasks.length,0);assert.deepEqual(bank.state().accounts,initialState().accounts);assert.equal(bank.state().receipts.length,0);
 assert.equal(result.status, 'paused');assert.equal(result.stopReason,'no_progress');
});

test('a pending user choice stops the loop and is asked, not guessed', async () => {
 let executed = 0;
 const model = scripted([{ content: null, tool_calls: [call('c1', 'bank_request', { operation: 'update_transfer', amount: 500 }), call('c2', 'bank_request', { operation: 'update_transfer', amount: 500, recipientId: 'zhang-roommate' })] }]);
 const result = await runDelegation({ utterance: '给张三转五百' }, {
  state: initialState, complete: model.complete,
  execute: async () => { executed++; throw new WorkflowError('有两位张三：室友张三还是房东张三？', 400, 'recipientChoice'); },
 }, signal());
 assert.equal(executed, 1, 'the second, guessed recipient is never executed');
 assert.equal(result.status, 'needs_user');
 assert.equal(result.summary, '有两位张三：室友张三还是房东张三？');
 assert.match(result.instruction, /不要猜测/);
 assert.equal(model.seen.length, 1, 'no further backend round after a choice is pending');
});

test('an unknown write outcome stops delegation and never claims success', async () => {
 const model = scripted([{ content: null, tool_calls: [call('c1', 'bank_request', { operation: 'get_state' })] }]);
 const result = await runDelegation({ utterance: '确认转账' }, {
  state: initialState, complete: model.complete,
  execute: async () => { throw new Error('network lost'); },
 }, signal());
 assert.equal(result.status, 'unknown');
 assert.match(result.summary, /尚未确认/);
 assert.doesNotMatch(result.summary, /成功|已完成/);
});

test('delegation pauses at the tool-call budget', async () => {
 const bank = sandbox(reduceBank(initialState(),{type:'workflow',command:{source:'card',operation:'run',functionId:'TR03',params:{recipientId:'zhang-roommate',accountId:'daily',amount:500}}},crypto.randomUUID()));
 const loop = Array.from({ length: MAX_DELEGATED_CALLS + 2 }, (_, i) => ({ content: null, tool_calls: [call('c' + i, 'bank_request', { operation: 'get_state' })] }));
 const result = await runDelegation({ utterance: '我确认当前这笔转账' }, { ...bank, complete: scripted(loop).complete }, signal());
 assert.equal(result.status, 'paused');
 assert.equal(bank.executed.length, MAX_DELEGATED_CALLS);
});

test('an aborted delegation stops before the next model round', async () => {
 const controller = new AbortController();
 const model = scripted([{ content: null, tool_calls: [call('c1', 'bank_request', { operation: 'get_state' })] }]);
 await assert.rejects(runDelegation({ utterance: '看看余额' }, {
  state: initialState, complete: model.complete,
  execute: async () => { controller.abort(); return bankToolResult(initialState()); },
 }, controller.signal), { name: 'AbortError' });
 assert.equal(model.seen.length, 1);
});

test('speaker mode exposes only bank_delegate and keeps the default prompt unchanged', () => {
 const speaker = voiceSettings('Tina', '', undefined, { instructions: SPEAKER_INSTRUCTIONS, tools: [DELEGATE_TOOL] });
 assert.deepEqual(speaker.tools.map(t => t.function.name), ['bank_delegate']);
 assert.match(speaker.instructions, /bank_delegate/);
 assert.doesNotMatch(speaker.instructions, /bank_function|confirmationRequest/);
 assert.ok(BACKEND_INSTRUCTIONS.includes(VOICE_BUSINESS_RULES));
 assert.ok(VOICE_INSTRUCTIONS.includes(VOICE_BUSINESS_RULES));
 assert.ok(voiceSettings('Tina').tools.some(t => t.function.name === 'bank_function'));
});

test('later session updates keep the speaker prompt instead of restoring the full tool prompt', () => {
 const sent: Record<string, any>[] = [];
 const conversation = new QwenConversation((type, extra = {}) => sent.push({ type, ...extra }), { onTranscript() {}, onInterrupt() {}, onTool: async () => ({}) });
 conversation.instructions = SPEAKER_INSTRUCTIONS;
 conversation.contextUpdate('{"revision":3}');
 const update = sent.find(e => e.type === 'session.update');
 assert.ok(update?.session.instructions.startsWith(SPEAKER_INSTRUCTIONS));
 conversation.stop();
});


test('delegation validates recipient IDs against the current scene before mapping', () => {
 const state=reduceBank(initialState(),{type:'load_scene',sceneId:'S02-A'},crypto.randomUUID());
 const recipient=contactsOf(state)[0];
 const tool={name:'bank_request' as const,arguments:{operation:'update_transfer' as const,recipientId:recipient.id,amount:100},utterance:`给${recipient.name}转一百元`};
 assert.doesNotThrow(()=>toolAction(state,tool));
 assert.throws(()=>toolAction(state,{...tool,arguments:{...tool.arguments,recipientId:'zhang-roommate'}}));
 assert.throws(()=>toolAction(state,{...tool,arguments:{...tool.arguments,recipientId:'invented'}}));
});

test('delegated planner receives main scene-scoped tool definitions', async () => {
 const state=reduceBank(initialState(),{type:'load_scene',sceneId:'S02-A'},crypto.randomUUID());
 const tools=voiceSettings('Tina','',contactsOf(state)).tools;
 let body: {tools:typeof tools}|undefined;
 const request:typeof fetch=async (_url,init)=>{body=JSON.parse(String(init?.body));return Response.json({choices:[{message:{content:'尚未执行'}}]});};
 const complete=qwenCompletion({base:'https://example.invalid',key:'fixture',planner:'fixture'},request,tools);
 await complete([],signal());
 assert.deepEqual(body?.tools,tools);
 assert.deepEqual((body!.tools[0].function.parameters.properties as Record<string,{enum:unknown[]}>).recipientId.enum,[...contactsOf(state).map(c=>c.id),null]);
});

test('saved monthly arrangements are discoverable and open from the actual user request without payments',async()=>{
 const start=reduceBank(initialState(),{type:'load_scene',sceneId:'S08'},crypto.randomUUID()),bank=sandbox(start);
 const facts=bankToolResult(start);assert.equal(facts.savedPlans[0].openRequest.arguments.operation,'open_saved');
 const model=scripted([{tool_calls:[call('saved','bank_plan',{operation:'open_saved'})]},{content:'已展示本月保存的安排和依据，尚未执行。'}]);
 const result=await runDelegation({utterance:'工资到了，把安排和依据给我看看',turnId:'salary-view'}, {...bank,complete:model.complete},signal());
 assert.equal(bank.executed[0].utterance,'工资到了，把安排和依据给我看看');
 assert.equal(bank.state().plan!.monthly!.period,'2033-07');assert.equal(bank.state().plan!.status,'paused');
 assert.equal(bank.state().plan!.steps.length,4);assert.equal(bank.state().view,'workflow');assert.equal(bank.state().receipts.length,0);
 assert.deepEqual(bank.state().accounts,start.accounts);assert.equal(bank.state().workflows!.records.orders.length,0);
 const operation=(result.facts as any).operationResult;assert.equal(operation.operation,'open_saved');assert.equal(operation.workflow,undefined);assert.ok(operation.plan.monthly);
 const id=bank.state().plan!.id;
 await bank.execute({name:'bank_plan',arguments:{operation:'open_saved'},utterance:'再给我看看刚才的安排'});
 assert.equal(bank.state().plan!.id,id);assert.equal(bank.state().plan!.steps.length,4);
});

test('a wrong investment query and unsupported candidate answer recover the original arrangement request',async()=>{
 const start=reduceBank(initialState(),{type:'load_scene',sceneId:'S08'},crypto.randomUUID()),bank=sandbox(start);
 const model=scripted([{tool_calls:[call('wrong','bank_function',{operation:'run',functionId:'IN11',params:{}})]},{content:'没有查询工资安排的接口。'},{content:'已展示保存的月度安排，金额来自原模板，尚未付款。'}]);
 let checks=0;
 const result=await runDelegation({utterance:'工资到了，把安排和依据给我看看'}, {...bank,complete:model.complete,reviewCompletion:async messages=>{checks++;assert.match(messages.at(-2)!.content!,/没有查询/);return {tool_calls:[call('recover','bank_plan',{operation:'open_saved'})]};}},signal());
 assert.equal(checks,0,'a registered read recovery needs no second model decision');assert.deepEqual(bank.executed.map(t=>[t.name,t.arguments.operation]),[['bank_function','run'],['bank_plan','open_saved']]);
 assert.ok(bank.state().plan!.monthly);assert.equal(bank.state().plan!.status,'paused');assert.deepEqual(bank.state().accounts,start.accounts);
 assert.equal(bank.state().receipts.length,0);assert.equal(bank.state().workflows!.records.orders.length,0);
 assert.doesNotMatch(result.summary,/没有查询|IN08|IN11/);
});

test('viewing a missing saved arrangement asks a real next question without inventing a plan',async()=>{
 const bank=sandbox(),model=scripted([{tool_calls:[call('saved','bank_plan',{operation:'open_saved'})]},{content:'没有保存的安排，你想先安排房租还是储蓄？'}]);
 const result=await runDelegation({utterance:'把保存的月度安排给我看看'},{...bank,complete:model.complete},signal());
 assert.equal(bank.state().plan,undefined);assert.equal(bank.state().workflows!.tasks.length,0);assert.equal(bank.state().receipts.length,0);assert.match(result.summary,/房租.*储蓄/);assert.equal(result.stopReason,'awaiting_input');
 await assert.rejects(bank.execute({name:'bank_plan',arguments:{operation:'open_saved',params:{amount:1000}},utterance:'看安排'}),/只能从已保存数据读取/);
});

test('completion recovery is skipped for an unknown outcome and cannot exceed the tool budget',async()=>{
 let reviews=0;
 const result=await runDelegation({utterance:'查看办理结果'}, {state:initialState,execute:async()=>{throw new Error('lost response');},complete:scripted([{tool_calls:[call('c','bank_request',{operation:'get_state'})]}]).complete,reviewCompletion:async()=>{reviews++;return {content:'retry'};}},signal());
 assert.equal(result.status,'unknown');assert.equal(reviews,0);
 const bank=sandbox(reduceBank(initialState(),{type:'workflow',command:{source:'card',operation:'run',functionId:'TR03',params:{recipientId:'zhang-roommate',accountId:'daily',amount:500}}},crypto.randomUUID())),loop=Array.from({length:MAX_DELEGATED_CALLS},(_,i)=>({tool_calls:[call('c'+i,'bank_request',{operation:'get_state'})]}));
 const paused=await runDelegation({utterance:'我确认当前这笔转账'},{...bank,complete:scripted([...loop,{content:'查看完毕'}]).complete,reviewCompletion:async()=>({tool_calls:[call('extra','bank_request',{operation:'list_accounts'})]})},signal());
 assert.equal(paused.status,'paused');assert.equal(bank.executed.length,MAX_DELEGATED_CALLS);
});

test('interrupting the model response or first tool prevents later operations in the batch',async()=>{
 for(const at of ['model','tool']){
  const controller=new AbortController();let executions=0;
  await assert.rejects(runDelegation({utterance:'看看进度'},{state:initialState,complete:async()=>{if(at==='model')controller.abort();return {tool_calls:[call('a','bank_request',{operation:'get_state'}),call('b','bank_request',{operation:'get_state'})]};},execute:async()=>{executions++;controller.abort();return bankToolResult(initialState());}},controller.signal),{name:'AbortError'});
  assert.equal(executions,at==='model'?0:1);
 }
});

test('a delegated clarification reaches the foreground choice guard and blocks same-turn re-delegation',async()=>{
 const delegated=await runDelegation({utterance:'给张三转五百'}, {state:initialState,complete:scripted([{tool_calls:[call('c','bank_request',{operation:'update_transfer',amount:500})]}]).complete,execute:async()=>{throw new WorkflowError('请选择室友张三还是房东张三。',400,'recipientChoice');}},signal());
 assert.equal(delegated.rejectionCode,'needs_user_choice');let invocations=0;
 const q=new QwenConversation(()=>{},{onTranscript(){},onInterrupt(){},onTool:async()=>{invocations++;return delegated;}});
 q.userText('给张三转五百');
 for(let i=0;i<2;i++){
  await q.handle({type:'response.created',response:{id:'r'+i}});
  await q.handle({type:'response.function_call_arguments.done',response_id:'r'+i,name:'bank_delegate',call_id:'d'+i,arguments:'{}'});
  await new Promise(r=>setTimeout(r,0));await q.handle({type:'response.done',response:{id:'r'+i,status:'completed'}});
 }
 assert.equal(invocations,1);q.stop();
});

test('a short follow-up stays the final user input and is not replaced by old history',async()=>{
 const model=scripted(Array.from({length:MAX_DELEGATED_NO_PROGRESS},()=>({content:'需要选择'})));
 await runDelegation({utterance:'室友那位',history:['给张三转500元']},{state:initialState,complete:model.complete,execute:async()=>({})},signal());
 assert.equal(model.seen[0].at(-1)!.content,'室友那位');
});

test('malformed arguments never execute and do not corrupt the next provider transcript',async()=>{
 const bank=sandbox(),model=scripted([{tool_calls:[call('broken','bank_function','{"operation":"run",')]},...Array.from({length:MAX_DELEGATED_NO_PROGRESS},()=>({content:'参数未完整生成，未办理。'}))]);
 await runDelegation({utterance:'查看办理进度'},{...bank,complete:model.complete},signal());
 assert.equal(bank.executed.length,0);
 const assistant=model.seen[1].find(m=>m.role==='assistant'&&m.tool_calls);assert.deepEqual(JSON.parse(assistant!.tool_calls![0].function.arguments),{});
 assert.equal(JSON.parse(model.seen[1].at(-1)!.content!).code,'invalid_tool_arguments');
});

test('a spoken transfer confirmation is refused: the transfer stays on its card for the button',async()=>{
 const start=reduceBank(initialState(),{type:'workflow',command:{source:'card',operation:'run',functionId:'TR03',params:{recipientId:'zhang-roommate',accountId:'daily',amount:500}}},crypto.randomUUID());
 const bank=sandbox(start),model=scripted([{content:'已确认转账，去认证。'}]);
 const result=await runDelegation({utterance:'确认转账'},{...bank,complete:model.complete,reviewCompletion:async()=>({content:'已确认转账'})},signal());
 // Transfers are confirmed on the card only; speech cannot move one to authentication.
 assert.equal(result.status==='done',false);assert.equal(bank.state().workflows!.tasks[0].status,'review');assert.equal(bank.state().receipts.length,0);
});

test('a prose-only promise must continue until the requested transfer reaches a real checklist boundary',async()=>{
 const bank=sandbox(),model=scripted([
  {content:'我查一下，请稍等。'},
  {tool_calls:[call('draft','bank_request',{operation:'update_transfer',accountId:'daily',recipientId:'zhang-roommate',amount:500})]},
  {content:'转账已完成。'},
 ]);
 const result=await runDelegation({utterance:'从日常账户给室友张三转500元',turnId:'draft-boundary'},{...bank,complete:model.complete},signal());
 assert.equal(model.seen.length,1);assert.equal(bank.executed.length,1);assert.equal(bank.executed[0].arguments.operation,'create');
 assert.equal(result.status,'needs_user');assert.equal(result.stopReason,'awaiting_confirmation');
 assert.doesNotMatch(result.summary,/已完成|转账成功/);assert.equal(bank.state().receipts.length,0);
 assert.equal(result.checkpoint!.remainingTaskIds.length,1);assert.equal(result.checkpoint!.taskId,bank.state().plan!.currentTaskId);
});

test('a resumed checklist must activate its queued task before yielding for confirmation',async()=>{
 let start=reduceBank(initialState(),{type:'load_scene',sceneId:'S08'},crypto.randomUUID());
 start=reduceBank(start,{type:'plan',command:{operation:'open_saved',source:'card'}},crypto.randomUUID());
 const bank=sandbox(start),model=scripted([
  {content:'房租已经准备好了，请确认。'},
  {content:'月度任务已全部完成。'},
 ]);
 const result=await runDelegation({utterance:'继续逐项办理',turnId:'resume-boundary'},{...bank,complete:model.complete},signal());
 assert.equal(result.stopReason,'awaiting_confirmation');assert.equal(bank.state().plan!.status,'running');
 assert.equal(bank.state().workflows!.tasks.find(t=>t.id===bank.state().plan!.currentTaskId)!.status,'review');
 assert.equal(result.checkpoint!.remainingTaskIds.length,4);assert.equal(bank.state().receipts.length,0);
 assert.equal(bank.executed.length,1);assert.equal(bank.executed[0].arguments.operation,'resume');
});

test('a supplied recipient must be saved before asking for the next missing field',async()=>{
 const start=reduceBank(initialState(),{type:'plan',command:{operation:'create',source:'card',functionId:'TR03',params:{amount:500}}},crypto.randomUUID());
 const bank=sandbox(start),id=start.workflows!.currentTaskId!;
 const model=scripted([{content:'已选室友张三，请告诉我金额。'},{tool_calls:[call('amend','bank_function',{operation:'amend',taskId:id,params:{recipientId:'zhang-roommate'}})]},{content:'已经转给室友了。'}]);
 const result=await runDelegation({utterance:'室友那位',turnId:'choice-boundary'},{...bank,complete:model.complete},signal());
 assert.equal(result.stopReason,'awaiting_input');assert.equal(bank.state().workflows!.tasks.find(t=>t.id===id)!.params.recipientId,'zhang-roommate');
 assert.equal(bank.state().workflows!.tasks.find(t=>t.id===id)!.params.amount,500);assert.match(result.summary,/账户/);assert.doesNotMatch(result.summary,/补充.*金额|已经转/);
 assert.equal(model.seen.length,1,'explicitly supplied fields reach the existing draft even when the model only acknowledges them');
});

test('a model-proposed transfer confirmation is refused and cannot execute or skip subsequent queued tasks',async()=>{
 const start=reduceBank(initialState(),{type:'plan',command:{operation:'create',source:'card',utterance:'先从日常账户给室友张三转500元，然后查看我的订阅'}},crypto.randomUUID());
 const bank=sandbox(start),id=start.workflows!.currentTaskId!,token=start.workflows!.tasks.find(t=>t.id===id)!.reviewToken!;
 const model=scripted([{tool_calls:[call('confirm','bank_function',{operation:'confirm',taskId:id,token})]},{content:'两项都办好了。'},{content:'请在卡片上点确认。'},{content:'请在卡片上点确认。'}]);
 const result=await runDelegation({utterance:'确认转账',turnId:'auth-boundary'},{...bank,complete:model.complete},signal());
 assert.equal(result.status==='done',false);assert.equal(bank.state().workflows!.tasks.find(t=>t.id===id)!.status,'review');
 assert.equal(bank.state().receipts.length,0);assert.equal(bank.state().plan!.steps.find(s=>s.functionId==='SU01')!.status,'pending');
});

test('old results and the completion of one business cannot satisfy the remaining request',()=>{
 const start=initialState();
 const onlyBalance=reduceBank(start,{type:'plan',command:{operation:'create',source:'card',functionId:'TR02'}},crypto.randomUUID());
 const incomplete=delegationCheckpoint(start,onlyBalance,'先查余额，然后查看我的订阅',[]);
 assert.equal(incomplete.kind,'continue');if(incomplete.kind==='continue')assert.match(incomplete.gaps.join(' '),/SU01/);
 const stale=delegationCheckpoint(onlyBalance,onlyBalance,'看看我的余额',[]);
 assert.equal(stale.kind,'continue');
});

test('an independent read can finish while a transfer awaits confirmation without confirming the transfer',async()=>{
 const start=reduceBank(initialState(),{type:'plan',command:{operation:'create',source:'card',functionId:'TR03',params:{recipientId:'zhang-roommate',accountId:'daily',amount:500}}},crypto.randomUUID());
 const bank=sandbox(start),model=scripted([{tool_calls:[call('balance','bank_request',{operation:'list_accounts'})]},{content:'余额已查到。'}]);
 const result=await runDelegation({utterance:'查一下余额',turnId:'independent-read'},{...bank,complete:model.complete},signal());
 assert.equal(result.stopReason,'completed');assert.equal(bank.state().receipts.length,0);
 assert.equal(bank.state().workflows!.tasks.find(t=>t.id===start.workflows!.currentTaskId)!.status,'review');
});

test('a wholly executable read-only checklist reaches its end before delegation reports completion',async()=>{
 const bank=sandbox(),model=scripted([{tool_calls:[call('plan','bank_plan',{operation:'create'})]},{content:'余额和订阅都已查询。'}]);
 const result=await runDelegation({utterance:'先查余额，然后查看我的订阅',turnId:'all-reads'},{...bank,complete:model.complete},signal());
 assert.equal(result.stopReason,'completed');assert.equal(bank.state().plan!.status,'complete');
 assert.ok(bank.state().plan!.steps.every(s=>s.status==='complete'));assert.deepEqual(result.checkpoint!.remainingTaskIds,[]);
});

test('starting a monthly arrangement requests review without treating the initial request as confirmation',async()=>{
 const start=reduceBank(initialState(),{type:'load_scene',sceneId:'S08'},crypto.randomUUID()),bank=sandbox(start);
 const model=scripted([{tool_calls:[call('open','bank_plan',{operation:'open_saved'})]},{content:'已经开始办理。'},{content:'已经全部办理。'}]);
 const result=await runDelegation({utterance:'工资到了，按保存的月度安排逐项办理',turnId:'monthly-start'},{...bank,complete:model.complete},signal());
 assert.equal(result.stopReason,'awaiting_confirmation');assert.equal(bank.state().receipts.length,0);
 assert.deepEqual(bank.executed.map(t=>t.arguments.operation),['open_saved','resume']);
 assert.equal(bank.state().workflows!.tasks.find(t=>t.id===bank.state().plan!.currentTaskId)!.status,'review');
});

test('choosing the correct business with omitted parameters preserves explicit user fields in its checklist',async()=>{
 const bank=sandbox(),model=scripted([{tool_calls:[call('draft','bank_function',{operation:'run',functionId:'TR03',params:{}})]},{content:'请重新告诉我金额和收款人。'}]);
 const result=await runDelegation({utterance:'从日常账户给室友张三转500元，先给我看卡片',turnId:'preserve-fields'},{...bank,complete:model.complete},signal());
 assert.equal(result.stopReason,'awaiting_confirmation');assert.match(result.summary,/500/);assert.doesNotMatch(result.summary,/重新告诉/);
 assert.deepEqual(bank.state().workflows!.tasks.find(t=>t.functionId==='TR03')!.params,{accountId:'daily',recipientId:'zhang-roommate',amount:500});
 assert.equal(bank.state().receipts.length,0);
});

test('a persisted choice stops later calls in the same model batch',async()=>{
 const bank=sandbox(),model=scripted([{tool_calls:[call('draft','bank_function',{operation:'run',functionId:'TR03',params:{amount:500}}),call('guess','bank_function',{operation:'amend',params:{recipientId:'zhang-roommate'}})]}]);
 const result=await runDelegation({utterance:'给张三转500元',turnId:'persisted-choice'},{...bank,complete:model.complete},signal());
 assert.equal(bank.executed.length,1);assert.equal(result.stopReason,'awaiting_input');assert.equal(result.rejectionCode,'needs_user_choice');
 assert.match(result.summary,/室友|房东/);assert.equal(bank.state().receipts.length,0);
});

test('an already saved monthly plan still needs a fresh open operation when asked to display it',()=>{
 let state=reduceBank(initialState(),{type:'load_scene',sceneId:'S08'},crypto.randomUUID());
 state=reduceBank(state,{type:'plan',command:{operation:'open_saved',source:'card'}},crypto.randomUUID());
 const checkpoint=delegationCheckpoint(state,state,'把保存的月度安排给我看看',[]);
 assert.equal(checkpoint.kind,'continue');if(checkpoint.kind==='continue')assert.match(checkpoint.gaps.join(' '),/尚未读取/);
});

test('a catalog description with the requested functionId cannot satisfy a business request',()=>{
 const start=initialState(),catalog=reduceBank(start,{type:'workflow',command:{operation:'describe',source:'card',functionId:'TR03'}},crypto.randomUUID());
 const checkpoint=delegationCheckpoint(start,catalog,'从日常账户给室友张三转500元',[{name:'bank_function',arguments:{operation:'describe',functionId:'TR03'},utterance:'从日常账户给室友张三转500元'}]);
 assert.equal(checkpoint.kind,'continue');if(checkpoint.kind==='continue')assert.match(checkpoint.gaps.join(' '),/TR03/);
});

test('explaining a business does not require creating or executing that business',async()=>{
 const bank=sandbox(),model=scripted([{content:'转账先核对对象和金额，再确认并在页面认证。'}]);
 const result=await runDelegation({utterance:'解释转账需要哪些步骤'},{...bank,complete:model.complete},signal());
 assert.equal(result.stopReason,'completed');assert.equal(bank.executed.length,0);assert.equal(bank.state().workflows!.tasks.length,0);
});

test('backend speaker dispatches a fresh query before allowing Omni to generate any answer',async()=>{
 const sent:any[]=[],calls:any[]=[];let resolve!:(value:unknown)=>void;
 const q=new QwenConversation((type,extra={})=>sent.push({type,...extra}),{onTranscript(){},onInterrupt(){},onTool:async(name,args,context)=>{calls.push({name,args,context});return new Promise(r=>resolve=r);}});
 q.backendSpeaker=true;q.instructions=SPEAKER_INSTRUCTIONS;q.userText('看看我的余额');
 assert.equal(calls.length,1);assert.equal(calls[0].name,'bank_delegate');assert.equal(calls[0].context.utterance,'看看我的余额');
 assert.ok(!sent.some(e=>e.type==='response.create'||e.type==='conversation.item.create'));
 resolve({status:'done',summary:'日常账户余额12565元。',facts:{balance:12565}});await new Promise(r=>setTimeout(r,0));
 assert.equal(sent.at(-1).type,'session.update');assert.match(sent.at(-1).session.instructions,/12565/);
 assert.ok(!sent.some(e=>e.type==='response.create'));
 await q.handle({type:'session.updated'});
 assert.deepEqual(sent.slice(-2).map(e=>e.type),['conversation.item.create','response.create']);
 assert.match(sent.at(-2).item.content[0].text,/逐字播报[\s\S]*\n日常账户余额12565元。/);assert.ok(!sent.at(-2).item.content[0].text.includes('看看我的余额'));
 await q.handle({type:'response.created',response:{id:'spoken'}});
 await q.handle({type:'response.function_call_arguments.done',response_id:'spoken',name:'bank_delegate',call_id:'duplicate',arguments:'{}'});
 assert.equal(calls.length,1,'readback cannot choose to delegate again');q.stop();
});

test('interrupting backend speaker work discards its late result and preserves the newer input',async()=>{
 const sent:any[]=[],calls:any[]=[];
 const q=new QwenConversation((type,extra={})=>sent.push({type,...extra}),{onTranscript(){},onInterrupt(){},onTool:async(name,args,context)=>new Promise(resolve=>calls.push({context,resolve}))});
 q.backendSpeaker=true;q.userText('从日常账户给室友张三转500元');q.userText('不转了，取消这笔');
 assert.equal(calls.length,2);assert.equal(calls[0].context.signal.aborted,true);
 calls[0].resolve({summary:'旧草稿500元'});await new Promise(r=>setTimeout(r,0));assert.ok(!sent.some(e=>e.type==='session.update'));
 calls[1].resolve({summary:'当前草稿已取消'});await new Promise(r=>setTimeout(r,0));
 assert.match(sent.at(-1).session.instructions,/当前草稿已取消/);assert.doesNotMatch(sent.at(-1).session.instructions,/旧草稿500元/);q.stop();
});

test('audio transcription dispatches backend work while unsolicited early speech remains muted',async()=>{
 const sent:any[]=[],spoken:string[]=[],calls:any[]=[];let resolve!:(value:unknown)=>void;
 const q=new QwenConversation((type,extra={})=>sent.push({type,...extra}),{onTranscript:(speaker,text)=>{if(speaker==='assistant')spoken.push(text);},onInterrupt(){},onTool:async(name,args,context)=>{calls.push({name,context});return new Promise(r=>resolve=r);}});
 q.backendSpeaker=true;
 await q.handle({type:'input_audio_buffer.speech_started',item_id:'audio-turn'});
 await q.handle({type:'input_audio_buffer.speech_stopped',item_id:'audio-turn'});
 await q.handle({type:'response.created',response:{id:'early'}});
 assert.equal(q.outputAllowed,false);
 await q.handle({type:'response.audio_transcript.delta',response_id:'early',item_id:'early-message',delta:'旧余额12865元'});
 await q.handle({type:'conversation.item.input_audio_transcription.completed',item_id:'audio-turn',transcript:'查一下我的余额'});
 assert.equal(calls.length,1);assert.equal(calls[0].context.utterance,'查一下我的余额');assert.deepEqual(spoken,[]);
 resolve({status:'done',summary:'日常账户余额12565元。'});await new Promise(r=>setTimeout(r,0));
 await q.handle({type:'response.done',response:{id:'early',status:'cancelled',output:[]}});
 await q.handle({type:'session.updated'});
 assert.ok(sent.some(e=>e.type==='conversation.item.create'&&e.item.content?.[0].text.includes('日常账户余额12565元。')));
 await q.handle({type:'response.created',response:{id:'fresh'}});assert.equal(q.outputAllowed,true);q.stop();
});

test('backend speaker failure cannot fall back to an unchecked answer or retry the business',async()=>{
 const sent:any[]=[],issues:string[]=[];let calls=0,recoveries=0;
 const q=new QwenConversation((type,extra={})=>sent.push({type,...extra}),{onTranscript(){},onInterrupt(){},onTool:async()=>{calls++;throw new Error('backend unavailable');},onToolIssue:message=>issues.push(message),onHaltedRecovery:()=>{recoveries++;}});
 q.backendSpeaker=true;q.userText('查看我的订阅');await new Promise(r=>setTimeout(r,0));
 assert.equal(calls,1);assert.equal(recoveries,1);assert.deepEqual(issues,['backend unavailable']);assert.ok(!sent.some(e=>e.type==='response.create'));q.stop();
});

test('reading an old balance task status cannot satisfy a new balance query after funds changed',async()=>{
 const old=reduceBank(initialState(),{type:'plan',command:{operation:'create',source:'card',functionId:'TR02'}},crypto.randomUUID());
 const oldId=old.workflows!.currentTaskId!,start={...old,accounts:old.accounts.map((a,i)=>i===0?{...a,balance:a.balance-30000}:a)};
 const bank=sandbox(start),model=scripted([
  {tool_calls:[call('stale','bank_function',{operation:'status',taskId:oldId})]},
  {content:'余额仍是12865元。'},
  {tool_calls:[call('fresh','bank_request',{operation:'list_accounts'})]},
  {content:'日常账户余额12565元。'},
 ]);
 const result=await runDelegation({utterance:'看看我的余额',turnId:'fresh-balance'},{...bank,complete:model.complete},signal());
 assert.equal(result.stopReason,'completed');assert.match(result.summary,/12,565/);
 assert.notEqual(bank.state().workflows!.currentTaskId,oldId);assert.equal(bank.executed.length,2);
 assert.equal(model.seen.length,1,'the fresh read and verified summary do not require another model response');
});

test('an explicit balance query is read and summarized from fresh facts even if the model only promises to check',async()=>{
 const bank=sandbox(),model=scripted([{content:'我查一下，请稍等。'}]);
 const result=await runDelegation({utterance:'看看我的余额',turnId:'read-before-finish'},{...bank,complete:model.complete},signal());
 assert.equal(result.stopReason,'completed');assert.equal(bank.executed.length,1);assert.equal(bank.executed[0].arguments.operation,'list_accounts');
 assert.match(result.summary,/12,865/);assert.doesNotMatch(result.summary,/稍等/);
});

test('six read-only proposals cannot exhaust the budget before registering the requested transfer',async()=>{
 const bank=sandbox(),model=scripted([{tool_calls:Array.from({length:6},(_,i)=>call('spin'+i,'bank_request',{operation:'get_state'}))}]);
 const result=await runDelegation({utterance:'从日常账户给室友张三转500元',turnId:'spin-request'},{...bank,complete:model.complete},signal());
 assert.equal(result.stopReason,'awaiting_confirmation');assert.equal(result.toolCalls,2);assert.equal(bank.executed.length,2);
 assert.equal(bank.state().workflows!.tasks.find(t=>t.functionId==='TR03')!.status,'review');
 assert.equal(bank.state().delegationRequests!.at(-1)!.taskIds.length,1);assert.equal(bank.state().receipts.length,0);
});

test('a request saved before provider failure resumes without restating fields or borrowing history',async()=>{
 const bank=sandbox(),text='从日常账户给室友张三转500元';
 await assert.rejects(runDelegation({utterance:text,turnId:'persist-before-model'},{...bank,complete:async()=>{assert.equal(bank.state().delegationRequests!.at(-1)!.utterance,text);throw new Error('provider down');}},signal()),/provider down/);
 const model=scripted([{content:'我先看看。'}]);
 const result=await runDelegation({utterance:'继续刚才的转账',turnId:'resume-saved'},{...bank,complete:model.complete},signal());
 assert.equal(result.stopReason,'awaiting_confirmation');assert.equal(bank.state().receipts.length,0);
 assert.deepEqual(bank.state().workflows!.tasks.find(t=>t.functionId==='TR03')!.params,{accountId:'daily',recipientId:'zhang-roommate',amount:500});
 assert.equal(bank.state().delegationRequests!.find(r=>r.id==='persist-before-model')!.taskIds.length,1);
});

test('an interrupted created task remains bound to its request and cannot be recreated after cancellation',async()=>{
 const bank=sandbox(),controller=new AbortController();
 await assert.rejects(runDelegation({utterance:'从日常账户给室友张三转500元',turnId:'bind-before-interrupt'},{...bank,complete:scripted([{tool_calls:[call('draft','bank_plan',{operation:'create'})]}]).complete,execute:async tool=>{const output=await bank.execute(tool);controller.abort();return output;}},controller.signal),{name:'AbortError'});
 const entry=bank.state().delegationRequests!.at(-1)!;assert.equal(entry.taskIds.length,1);
 const task=bank.state().workflows!.tasks.find(t=>t.id===entry.taskIds[0])!;
 await bank.execute({name:'bank_function',arguments:{operation:'cancel',taskId:task.id},utterance:'取消这笔转账',turnId:'cancel-new'});
 const count=bank.state().workflows!.tasks.length;
 const result=await runDelegation({utterance:'继续刚才的转账',turnId:'no-recreate'},{...bank,complete:async()=>({content:'没有未完成任务。'})},signal());
 assert.equal(bank.state().workflows!.tasks.length,count);assert.notEqual(result.stopReason,'awaiting_confirmation');assert.equal(bank.state().receipts.length,0);
});

test('multiple unstarted requests require a choice and authentication data is not saved',async()=>{
 const bank=sandbox();
 for(const [turnId,utterance]of [['pending-a','给室友张三转500元'],['pending-b','查看订阅']])await assert.rejects(runDelegation({turnId,utterance},{...bank,complete:async()=>{throw new Error('offline');}},signal()));
 let calls=0;const result=await runDelegation({utterance:'继续'},{...bank,complete:async()=>{calls++;return{};}},signal());
 assert.equal(result.stopReason,'awaiting_input');assert.equal(calls,0);
 const count=bank.state().delegationRequests!.length;
 await runDelegation({utterance:'验证码123456'},{...bank,complete:async()=>{throw new Error('must not call');}},signal());
 assert.equal(bank.state().delegationRequests!.length,count);
});

test('confirmation with an edit or a question cannot use the backend literal confirmation path',async()=>{
 for(const text of ['确认转账吗？','确认转账，改成300元','不要确认转账']){
  const bank=sandbox(reduceBank(initialState(),{type:'workflow',command:{source:'card',operation:'run',functionId:'TR03',params:{recipientId:'zhang-roommate',accountId:'daily',amount:500}}},crypto.randomUUID()));
  await runDelegation({utterance:text},{...bank,complete:async()=>({content:'请核对信息。'})},signal());
  assert.ok(bank.executed.every(t=>t.arguments.operation!=='confirm'));assert.equal(bank.state().receipts.length,0);
 }
});
