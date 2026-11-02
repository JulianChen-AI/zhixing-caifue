import test from 'node:test';import assert from 'node:assert/strict';
import { QwenConversation,voiceSettings,isExpectedRealtimeCancellation } from '../lib/voice/qwen-protocol.ts';
import { qwenConfig,parsedIntent } from '../lib/bank/qwen.ts';
import { initialState,reduceBank } from '../lib/bank/engine.ts';
import { realtimeToolDecision,realtimeToolArguments,bankToolResult,spokenAmount } from '../lib/bank/realtime-tools.ts';
import type { RealtimeToolArguments } from '../lib/bank/realtime-tools.ts';
import { stopOnPageExit } from '../lib/voice/lifecycle.ts';
import { routeRequest } from '../lib/checklists/routing.ts';
import { BankRequestError } from '../lib/bank/request-error.ts';
import type { WorkflowToolArguments } from '../lib/workflows/realtime.ts';

test('schema-valid tail selection reaches review and contradictory identities still require clarification',()=>{
 const args=realtimeToolArguments.parse({operation:'update_transfer',recipientId:'zhang-roommate',accountId:'daily',amount:500});
 const text='从尾号8021的账户给尾号6688的张三转500元';
 const s=reduceBank(initialState(),{type:'route',decision:realtimeToolDecision(args,initialState(),text)},crypto.randomUUID());
 assert.equal(s.task!.recipientId,'zhang-roommate');assert.equal(s.task!.step,'review');assert.equal(s.task!.amount,50000);
 const offline=routeRequest(text,initialState());assert.equal(offline.draft!.recipientId,'zhang-roommate');assert.ok(offline.evidence.find(e=>e.field==='recipient')!.quote);
 const bad=realtimeToolDecision(args,initialState(),'用日常账户给室友张三转500元，就是尾号2910那位');
 assert.equal(bad.outcome,'clarify');assert.ok(bad.unresolved.includes('recipient'));
 const partial=realtimeToolDecision(args,initialState(),'从日常账户给尾号688的张三转500元');assert.ok(partial.unresolved.includes('recipient'));
 const wrongName=realtimeToolDecision({...args,recipientId:'li-friend'},initialState(),'从日常账户给尾号0826的张三转500元');assert.ok(wrongName.unresolved.includes('recipient'));
 const changed=apply(ready(),{operation:'update_transfer'},'换成尾号0000那个');assert.equal(changed.task!.recipientId,null);assert.equal(changed.task!.amount,50000);
});

test('closing/navigation and backgrounding stop activity; returning does not reconnect',()=>{
 const page=new EventTarget(),visibility=Object.assign(new EventTarget(),{visibilityState:'visible'});let stops=0;
 const detach=stopOnPageExit(()=>stops++,page,visibility);
 visibility.dispatchEvent(new Event('visibilitychange'));assert.equal(stops,0);
 visibility.visibilityState='hidden';visibility.dispatchEvent(new Event('visibilitychange'));assert.equal(stops,1);
 page.dispatchEvent(new Event('pagehide'));assert.equal(stops,2);
 visibility.visibilityState='visible';visibility.dispatchEvent(new Event('visibilitychange'));assert.equal(stops,2);
 detach();page.dispatchEvent(new Event('pagehide'));assert.equal(stops,2);
});

test('refreshing committed facts after interruption does not cancel a newer response or fabricate a tool output',async()=>{
 const h=harness();h.q.userText('继续刚才的任务');const before=h.sent.length;h.q.syncFacts('{"status":"review","confirmationToken":"example"}');
 assert.equal(h.sent.length,before);await h.q.handle({type:'response.created',response:{id:'new'}});assert.equal(h.q.outputAllowed,true);await h.q.handle({type:'response.done',response:{id:'new'}});
 const added=h.sent.slice(before);assert.equal(added.length,1);assert.equal(added[0].type,'session.update');assert.ok(added[0].session.instructions.includes('不是用户授权'));assert.ok(!added.some(e=>e.type==='response.cancel'||e.type==='conversation.item.create'));
});
const apply=(s:ReturnType<typeof initialState>,args:RealtimeToolArguments,utterance:string)=>reduceBank(s,{type:'route',decision:realtimeToolDecision(args,s,utterance)},crypto.randomUUID());
const ready=()=>apply(initialState(),{operation:'update_transfer',amount:500,recipientId:'zhang-roommate',accountId:'daily'},'从日常账户给室友转500元');
test('a semantic amount correction preserves transfer selections and cannot reuse the old confirmation',()=>{
 const initial=ready(),old=initial.task!.reviewToken!;let s=apply(initial,{operation:'update_transfer',amount:300},'少转两百吧');
 assert.equal(s.task!.amount,30000);assert.equal(s.task!.recipientId,'zhang-roommate');assert.equal(s.task!.accountId,'daily');assert.notEqual(s.task!.reviewToken,old);assert.equal(s.receipts.length,0);
 assert.ok(s.routing!.evidence.some(e=>e.field==='amount'&&e.source==='model-proposal'));
 const contradictory=apply(s,{operation:'confirm_transfer',confirmationToken:s.task!.reviewToken!},'确认转500元');assert.equal(contradictory.task!.verificationId,null);
 s=apply(s,{operation:'confirm_transfer',confirmationToken:s.task!.reviewToken!},'按卡片上的办吧');assert.equal(s.task!.step,'authenticate');assert.equal(s.receipts.length,0);
});
function harness(work:()=>Promise<unknown>=async()=>({status:'ok'}),literalCommandFor?:(text:string)=>WorkflowToolArguments|undefined){
 const sent:any[]=[],transcripts:any[]=[],tools:any[]=[],busy:boolean[]=[],issues:string[]=[];let interrupts=0;
 const q=new QwenConversation((type,extra)=>sent.push({type,...extra}),{literalCommandFor,onToolIssue:message=>issues.push(message),onTranscript:(...args)=>transcripts.push(args),onInterrupt:()=>interrupts++,onBusy:b=>busy.push(b),onTool:async(name,args,context)=>{tools.push({name,args,context});return work()}});
 return{q,sent,transcripts,tools,busy,issues,interrupts:()=>interrupts};
}
const tick=()=>new Promise(r=>setTimeout(r,0));
test('a speech-only completed response returns the UI to listening without unlocking a pending tool',async()=>{
 let release!:(value:unknown)=>void;const h=harness(()=>new Promise(resolve=>release=resolve));
 await utterance(h.q);await h.q.handle({type:'response.created',response:{id:'spoken'}});await h.q.handle({type:'response.audio_transcript.done',response_id:'spoken',transcript:'请核对卡片。'});await h.q.handle({type:'response.done',response:{id:'spoken'}});assert.equal(h.busy.at(-1),false);
 await utterance(h.q,'u2','冻结日常卡');await h.q.handle({type:'response.created',response:{id:'tool'}});await h.q.handle({...call(),response_id:'tool'});await tick();assert.equal(h.busy.at(-1),true);
 await h.q.handle({type:'response.done',response:{id:'tool'}});assert.equal(h.busy.at(-1),true);release({status:'review'});await tick();assert.equal(h.busy.at(-1),false);
});
async function utterance(q:QwenConversation,id='u1',text='500。'){
 await q.handle({type:'input_audio_buffer.speech_started',item_id:id});await q.handle({type:'input_audio_buffer.speech_stopped',item_id:id});await q.handle({type:'conversation.item.input_audio_transcription.completed',item_id:id,transcript:text});
}
const call=(id='c1',args='{"operation":"update_transfer","amount":500}')=>({type:'response.function_call_arguments.done',name:'bank_request',call_id:id,arguments:args});

test('explicit backend rejections retain their actual explanation and cannot masquerade as an unknown confirmation outcome',async()=>{
 const h=harness(async()=>{throw new BankRequestError('银行卡的名称和完整尾号需一致，请明确选择哪张卡。',400);});await utterance(h.q);await h.q.handle(call());await tick();
 const item=h.sent.find(e=>e.item?.type==='function_call_output'),out=JSON.parse(item.item.output);
 assert.equal(out.code,'tool_request_rejected');assert.equal(out.effectCommitted,false);assert.equal(out.retryable,false);assert.match(out.message,/银行卡/);assert.match(out.instruction,/不循环/);
});

test('one user turn cannot sustain an unbounded chain of fresh tool call IDs',async()=>{
 const h=harness();await utterance(h.q);
 for(let i=0;i<12;i++){
  await h.q.handle({type:'response.created',response:{id:'loop-'+i}});
  await h.q.handle({...call('loop-call-'+i),response_id:'loop-'+i});await tick();
  await h.q.handle({type:'response.done',response:{id:'loop-'+i}});
 }
 assert.equal(h.tools.length,6);assert.equal(h.busy.at(-1),false);assert.match(h.issues.at(-1)!,/暂停/);
 assert.equal(h.q.outputAllowed,false);assert.match(h.transcripts.at(-1)[1],/暂停/);
 const before=h.sent.filter(e=>e.type==='response.create').length;
 await h.q.handle({type:'response.done',response:{id:'loop-11'}});
 assert.equal(h.sent.filter(e=>e.type==='response.create').length,before);
 await utterance(h.q,'next-user','改成300元');await h.q.handle({type:'response.created',response:{id:'next'}});
 await h.q.handle({...call('next-call','{"operation":"update_transfer","amount":300}'),response_id:'next'});await tick();assert.equal(h.tools.length,7);
});

test('a late done event cannot finish a newer response and start a duplicate continuation',async()=>{
 const h=harness();h.q.userText('查余额');await h.q.handle({type:'response.created',response:{id:'old-response'}});
 h.q.userText('改成300元');await h.q.handle({type:'response.created',response:{id:'new-response'}});
 await h.q.handle({...call('new-tool','{"operation":"update_transfer","amount":300}'),response_id:'new-response'});await tick();
 const before=h.sent.filter(e=>e.type==='response.create').length;
 await h.q.handle({type:'response.done',response:{id:'old-response'}});
 assert.equal(h.sent.filter(e=>e.type==='response.create').length,before);
 await h.q.handle({type:'response.done',response:{id:'new-response'}});
 assert.equal(h.sent.filter(e=>e.type==='response.create').length,before+1);
});

test('invalid confirmation stays unresolved while a proposed note is reviewed before authorization',()=>{
 let s=ready();s=apply(s,{operation:'confirm_transfer',confirmationToken:crypto.randomUUID()},'确认');
 let progress=bankToolResult(s).transferProgress!;assert.equal(progress.nextAction,'ask_clarification');assert.ok(progress.unresolved.includes('intent'));
 s=apply(ready(),{operation:'update_transfer',note:'不存在的备注'},'改一下备注');
 progress=bankToolResult(s).transferProgress!;assert.equal(progress.nextAction,'review_current_summary');assert.equal(s.task!.note,'不存在的备注');assert.equal(s.receipts.length,0);
 s=reduceBank(s,{type:'edit',note:null},crypto.randomUUID());assert.deepEqual(s.routing!.unresolved,[]);
 assert.equal(reduceBank(s,{type:'confirm'},crypto.randomUUID()).task!.step,'authenticate');
});

test('original compound probes ask for evidence instead of accepting model-computed money',()=>{
 const probes:[string,RealtimeToolArguments][]=[
  ['我要转账，给尾号6688的张三，转余额比较小的账户的三分之一余额。',{operation:'update_transfer',recipientId:'zhang-roommate',accountId:'daily',amount:4288.33}],
  ['我要从日常账户先给室友张三转500元，然后再拿剩下的500，整理一下材料。',{operation:'update_transfer',recipientId:'zhang-roommate',accountId:'daily',amount:500}],
 ];
 for(const [text,args]of probes){
  const s=apply(initialState(),args,text),progress=bankToolResult(s).transferProgress!;
  assert.equal(progress.nextAction,'ask_clarification');assert.ok(progress.unresolved.includes('amount'));
  assert.equal(s.task!.amount,null);assert.equal(s.receipts.length,0);assert.equal(s.task!.verificationId,null);
 }
});

test('function item metadata supplies missing done-event name and accumulated JSON without guessing a tool',async()=>{
 const h=harness();await utterance(h.q,'u-meta','查银行卡');await h.q.handle({type:'response.created',response:{id:'r-meta'}});
 await h.q.handle({type:'response.output_item.added',response_id:'r-meta',item:{type:'function_call',id:'item-meta',call_id:'call-meta',name:'bank_function',arguments:''}});
 await h.q.handle({type:'response.function_call_arguments.delta',item_id:'item-meta',delta:'{"operation":"run",'});
 await h.q.handle({type:'response.function_call_arguments.delta',item_id:'item-meta',delta:'"functionId":"CA01","params":{}}'});
 await h.q.handle({type:'response.function_call_arguments.done',item_id:'item-meta'});await tick();
 assert.equal(h.tools.length,1);assert.equal(h.tools[0].name,'bank_function');assert.equal(h.tools[0].args.functionId,'CA01');
});
test('object-valued arguments are accepted as data and interrupted metadata cannot execute a late call',async()=>{
 const h=harness();await utterance(h.q,'u-object','查订阅');await h.q.handle({type:'response.function_call_arguments.done',name:'bank_function',call_id:'obj',arguments:{operation:'run',functionId:'SU01',params:{}}});await tick();assert.equal(h.tools[0].args.functionId,'SU01');
 const old=harness();await utterance(old.q,'u-old','查银行卡');await old.q.handle({type:'response.output_item.added',item:{type:'function_call',id:'old-item',call_id:'old-call',name:'bank_function',arguments:'{"operation":"run","functionId":"CA01"}'}});old.q.interrupt();await old.q.handle({type:'response.function_call_arguments.done',item_id:'old-item'});await tick();assert.equal(old.tools.length,0);
});

test('provider endpoints remain scoped and model output cannot invent authentication',()=>{
 assert.equal(qwenConfig({DASHSCOPE_API_KEY:'test',DASHSCOPE_WORKSPACE_ID:'llm-test'}).ready,true);
 assert.equal(qwenConfig({DASHSCOPE_API_KEY:'test',DASHSCOPE_WORKSPACE_ID:'evil.com/path'}).ready,false);
 assert.equal(parsedIntent.safeParse({kind:'authenticate',amount:null,recipientId:null,accountId:null,note:null}).success,false);
 assert.equal(realtimeToolArguments.safeParse({operation:'authenticate',code:'123456'}).success,false);
});
test('Omni owns natural dialogue and has a native bank tool rather than an ASR router',async()=>{
 const config=voiceSettings('Tina');assert.equal(config.tools[0].function.name,'bank_request');assert.match(config.instructions,/不是朗读器/);
 const h=harness();await utterance(h.q);assert.equal(h.tools.length,0);assert.equal(h.sent.length,0);
 await h.q.handle({type:'response.created',response:{id:'natural'}});await h.q.handle({type:'response.audio_transcript.delta',response_id:'natural',item_id:'a',delta:'好的，五百元，转给谁？'});
 assert.equal(h.q.outputAllowed,true);assert.equal(h.transcripts.at(-1)[1],'好的，五百元，转给谁？');
});
test('native complex planning has a dedicated tool and returns outer progress before continuing once',async()=>{
 assert.ok(voiceSettings('Tina').tools.some(t=>t.function.name==='bank_plan'));
 const h=harness(async()=>({plan:{layer:'double',nextAction:'ask_step_purpose'}}));h.q.userText('先转500，然后整理材料');
 await h.q.handle({type:'response.created',response:{id:'plan-response'}});
 await h.q.handle({type:'response.function_call_arguments.done',response_id:'plan-response',call_id:'plan-call',name:'bank_plan',arguments:'{"operation":"create"}'});await tick();
 assert.equal(h.tools.length,1);assert.equal(h.tools[0].name,'bank_plan');assert.ok(h.tools[0].context.turnId);assert.equal(h.tools[0].context.utterance,'先转500，然后整理材料');
 await h.q.handle({type:'response.done',response:{id:'plan-response'}});assert.equal(h.sent.filter(e=>e.type==='response.create').length,2);
});
test('tool waits without polling or response generation, then returns actual output and resumes once',async()=>{
 let finish!:(v:unknown)=>void;const h=harness(()=>new Promise(r=>finish=r));await utterance(h.q);await h.q.handle({type:'response.created',response:{id:'r1'}});await h.q.handle(call());await tick();
 assert.equal(h.q.outputAllowed,false);assert.equal(h.tools.length,1);assert.equal(h.sent.filter(e=>e.type==='response.create').length,0);await h.q.handle({type:'response.done'});await tick();assert.equal(h.sent.length,0);
 finish({amount:500,step:'details'});await tick();assert.equal(h.sent[0].item.type,'function_call_output');assert.equal(JSON.parse(h.sent[0].item.output).amount,500);assert.equal(h.sent.filter(e=>e.type==='response.create').length,1);
 await h.q.handle(call());await tick();assert.equal(h.tools.length,1);
});
test('interruption aborts old tool work without replying to a removed call and discards late results',async()=>{
 let finish!:(v:unknown)=>void;const h=harness(()=>new Promise(r=>finish=r));await utterance(h.q);await h.q.handle(call());await tick();await h.q.handle({type:'input_audio_buffer.speech_started',item_id:'u2'});
 assert.equal(h.tools[0].context.signal.aborted,true);assert.equal(h.sent.some(e=>e.item?.type==='function_call_output'),false);const count=h.sent.length;finish({status:'old success'});await tick();assert.equal(h.sent.length,count);
});
test('early interruption never cancels a requested response before response.created',async()=>{
 const h=harness();h.q.userText('500');assert.equal(h.sent.filter(e=>e.type==='response.create').length,1);await h.q.handle({type:'input_audio_buffer.speech_started',item_id:'u2'});assert.equal(h.sent.filter(e=>e.type==='response.cancel').length,0);
});
test('malformed tool JSON produces an error result without executing the backend',async()=>{
 const h=harness();await utterance(h.q);await h.q.handle(call('bad','not json'));await tick();assert.equal(h.tools.length,0);const result=JSON.parse(h.sent[0].item.output);assert.equal(result.status,'error');assert.equal(result.code,'invalid_tool_arguments');assert.equal(result.effectCommitted,false);assert.match(result.instruction,/get_state/);assert.match(h.issues[0],/尚未提交/);
});

test('a truncated done event uses actual final item JSON and never synthetically closes braces',async()=>{
 const h=harness();await utterance(h.q,'u-final','确认创建这个目标');
 await h.q.handle({type:'response.output_item.added',item:{type:'function_call',id:'final-item',call_id:'final-call',name:'bank_function',arguments:''}});
 await h.q.handle({type:'response.function_call_arguments.done',name:'bank_function',call_id:'final-call',arguments:'{"operation":"confirm"'});await tick();assert.equal(h.tools.length,0);
 await h.q.handle({type:'response.output_item.done',item:{type:'function_call',id:'final-item',call_id:'final-call',name:'bank_function',arguments:'{"operation":"confirm","taskId":"actual","token":"actual-token"}'}});await tick();assert.equal(h.tools.length,1);assert.equal(h.tools[0].args.token,'actual-token');
 const bad=harness();await utterance(bad.q);await bad.q.handle({type:'response.output_item.done',item:{type:'function_call',id:'bad-item',call_id:'bad-call',name:'bank_function',arguments:'{"operation":"confirm"'}});await bad.q.handle({type:'response.function_call_arguments.done',name:'bank_function',call_id:'bad-call',arguments:'{"operation":"confirm"'});await tick();assert.equal(bad.tools.length,0);assert.equal(JSON.parse(bad.sent[0].item.output).code,'invalid_tool_arguments');
});

test('interrupting while waiting for final arguments cannot execute the later complete item',async()=>{
 const h=harness();await utterance(h.q);await h.q.handle({type:'response.output_item.added',item:{type:'function_call',id:'interrupted-item',call_id:'interrupted-call',name:'bank_function',arguments:''}});await h.q.handle({type:'response.function_call_arguments.done',name:'bank_function',call_id:'interrupted-call',arguments:'{"operation":"confirm"'});await tick();h.q.interrupt();await h.q.handle({type:'response.output_item.done',item:{type:'function_call',id:'interrupted-item',call_id:'interrupted-call',name:'bank_function',arguments:'{"operation":"confirm"}'}});await tick();assert.equal(h.tools.length,0);assert.equal(h.sent.filter(e=>e.item?.type==='function_call_output').length,0);
});

test('an unreadable backend response is unknown outcome rather than claiming no effect was committed',async()=>{
 const h=harness(async()=>{throw new SyntaxError('Invalid response body')});await utterance(h.q);await h.q.handle(call('unknown'));await tick();
 assert.equal(h.tools.length,1);const output=JSON.parse(h.sent.find(e=>e.item?.type==='function_call_output').item.output);assert.equal(output.code,'tool_result_unknown');assert.equal(output.effectCommitted,undefined);assert.equal(h.issues.length,0);
});
test('card facts never reopen a cancelled provider turn; new user input continues the same conversation',async()=>{
 const h=harness();h.q.userText('五百');assert.equal(h.sent[0].item.content[0].text,'五百');assert.equal(h.tools.length,0);
 h.q.contextUpdate('{"step":"authenticate"}');const count=h.sent.filter(e=>e.type==='response.create').length;
 await h.q.handle({type:'response.created',response:{id:'r'}});await h.q.handle({type:'response.done',response:{id:'r',status:'cancelled'}});await h.q.handle({type:'session.updated'});
 assert.equal(h.sent.filter(e=>e.type==='response.create').length,count);assert.equal(h.tools.length,0);
 h.q.userText('继续冻结日常卡');assert.equal(h.sent.filter(e=>e.type==='response.create').length,count+1);assert.equal(h.sent.at(-2).item.content[0].text,'继续冻结日常卡');
});

test('page authentication suppresses old output without cancelling a tool turn or creating an empty continuation',async()=>{
 for(const ackFirst of [false,true]){
  const h=harness();h.q.userText('确认申购');await h.q.handle({type:'response.created',response:{id:'confirmation'}});
  await h.q.handle({...call('confirm','{"operation":"get_state"}'),response_id:'confirmation'});await tick();await h.q.handle({type:'response.done',response:{id:'confirmation'}});
  await h.q.handle({type:'response.created',response:{id:'tool-reply'}});
  const before=h.sent.filter(e=>e.type==='response.create').length;
  h.q.contextUpdate('{"workflow":{"status":"complete"}}');
  assert.equal(h.sent.filter(e=>e.type==='response.cancel').length,0);
  if(ackFirst)await h.q.handle({type:'session.updated'});
  await h.q.handle({type:'response.done',response:{id:'tool-reply',status:'completed'}});
  await h.q.handle({type:'session.updated'});
  assert.equal(h.sent.filter(e=>e.type==='response.create').length,before);
  assert.equal(h.q.outputAllowed,false);
  await h.q.handle({...call('late-card-tool'),response_id:'tool-reply'});await tick();assert.equal(h.tools.length,1);
  h.q.userText('现在冻结尾号8021的日常卡');await h.q.handle({type:'response.created',response:{id:'freeze'}});
  assert.equal(h.q.outputAllowed,true);assert.equal(h.sent.filter(e=>e.type==='response.create').length,before+1);
 }
});

test('a page update fences a requested old reply even when session acknowledgement arrives first',async()=>{
 const h=harness();h.q.userText('确认申购');h.q.contextUpdate('{"status":"complete"}');await h.q.handle({type:'session.updated'});
 await h.q.handle({type:'response.created',response:{id:'pending-old'}});assert.equal(h.q.outputAllowed,false);
 h.q.contextUpdate('{"status":"complete","revision":2}');assert.equal(h.sent.filter(e=>e.type==='response.cancel').length,0);
 await h.q.handle({...call('stale-tool'),response_id:'pending-old'});await tick();assert.equal(h.tools.length,0);
 await h.q.handle({type:'response.done',response:{id:'pending-old',status:'cancelled'}});await h.q.handle({type:'session.updated'});
 assert.equal(h.sent.filter(e=>e.type==='response.create').length,1);
 h.q.userText('现在冻结日常卡');assert.equal(h.sent.filter(e=>e.type==='response.create').length,2);
});

test('page facts update only between responses and the next user turn waits for their acknowledgement',async()=>{
 const h=harness();h.q.userText('确认申购');await h.q.handle({type:'response.created',response:{id:'old'}});
 const before=h.sent.length;h.q.contextUpdate('{"revision":5}');h.q.contextUpdate('{"revision":6}');
 assert.equal(h.sent.length,before);assert.equal(h.q.outputAllowed,false);
 h.q.userText('现在冻结日常卡');assert.equal(h.sent.at(-2).type,'response.cancel');assert.equal(h.sent.at(-1).item.content[0].text,'现在冻结日常卡');
 await h.q.handle({type:'response.done',response:{id:'old',status:'cancelled'}});
 assert.equal(h.sent.at(-1).type,'session.update');assert.match(h.sent.at(-1).session.instructions,/"revision":6/);
 assert.equal(h.sent.filter(e=>e.type==='response.create').length,1);
 await h.q.handle({type:'session.updated'});assert.equal(h.sent.filter(e=>e.type==='response.create').length,2);
});

test('a provider that stops returning progress times out without executing late tool arguments',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const h=harness();h.q.userText('确认申购');await h.q.handle({type:'response.created',response:{id:'stalled'}});
 await h.q.handle({type:'response.output_item.added',response_id:'stalled',item:{type:'function_call',id:'partial',call_id:'partial',name:'bank_function',arguments:''}});
 t.mock.timers.tick(30001);assert.equal(h.issues.length,1);assert.match(h.transcripts.at(-1)[1],/未及时返回完整结果/);assert.equal(h.q.outputAllowed,false);
 await h.q.handle({...call('partial','{"operation":"get_state"}'),response_id:'stalled'});h.q.userText('继续');assert.equal(h.tools.length,0);assert.equal(h.issues.length,1);
});

test('a response done event cannot remove the timeout while its bank request is still pending',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let finish!:(value:unknown)=>void;const h=harness(()=>new Promise(r=>finish=r));
 await utterance(h.q,'u','确认冻结');await h.q.handle({type:'response.created',response:{id:'r'}});await h.q.handle({...call('pending'),response_id:'r'});await new Promise<void>(resolve=>setImmediate(resolve));
 assert.equal(h.tools.length,1);await h.q.handle({type:'response.done',response:{id:'r'}});t.mock.timers.tick(30001);
 assert.equal(h.tools[0].context.signal.aborted,true);assert.equal(h.busy.at(-1),false);assert.match(h.issues.at(-1)!,/结果尚未确认/);
 const count=h.sent.length;finish({status:'complete'});await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(h.sent.length,count);assert.equal(h.sent.some(e=>e.item?.type==='function_call_output'),false);
});

test('VAD splitting an acknowledgement before any model reply preserves both actual speech segments',async()=>{
 const h=harness();await h.q.handle({type:'input_audio_buffer.speech_started',item_id:'first'});await h.q.handle({type:'input_audio_buffer.speech_stopped',item_id:'first'});
 await h.q.handle({type:'input_audio_buffer.speech_started',item_id:'tail'});
 await h.q.handle({type:'conversation.item.input_audio_transcription.completed',item_id:'first',transcript:'确认申购当前这笔演示债券基金一百元。'});
 await h.q.handle({type:'input_audio_buffer.speech_stopped',item_id:'tail'});await h.q.handle({type:'conversation.item.input_audio_transcription.completed',item_id:'tail',transcript:'当前摘要继续。'});
 await h.q.handle({type:'response.created',response:{id:'r'}});await h.q.handle({...call('split'),response_id:'r'});await tick();
 assert.equal(h.tools.length,1);assert.equal(h.tools[0].context.turnId,'tail');assert.equal(h.tools[0].context.utterance,'确认申购当前这笔演示债券基金一百元。\n当前摘要继续。');
});

test('split acknowledgement never borrows confirmation across replies, page updates, negations or edits',async()=>{
 for(const boundary of ['reply','page','negation','edit']){
  const h=harness();await utterance(h.q,'first','确认冻结日常卡');
  if(boundary==='reply')await h.q.handle({type:'response.created',response:{id:'old'}});
  if(boundary==='page')h.q.contextUpdate('{"revision":9}');
  const tail=boundary==='negation'?'不要继续':boundary==='edit'?'改成储蓄卡':'当前摘要继续';
  await utterance(h.q,'tail',tail);
  if(boundary==='page')await h.q.handle({type:'session.updated'});
  await h.q.handle({type:'response.created',response:{id:'new'}});await h.q.handle({...call('boundary-'+boundary),response_id:'new'});await tick();
  assert.equal(h.tools.length,1,boundary);assert.equal(h.tools[0].context.utterance,tail,boundary);
 }
});

test('a delayed continue cannot reuse an earlier voice confirmation',async t=>{
 t.mock.timers.enable({apis:['Date']});const h=harness();await utterance(h.q,'first','确认冻结');t.mock.timers.tick(1500);await utterance(h.q,'tail','当前摘要继续');
 await h.q.handle(call('delayed'));await tick();assert.equal(h.tools[0].context.utterance,'当前摘要继续');
});

test('a continuation cancelled by new input is a control event and cannot disconnect or replay the old request',async()=>{
 const h=harness();h.q.userText('查银行卡');await h.q.handle({type:'error',error:{type:'invalid_request_error',message:'Response request cancelled by new input'}});
 const before=h.sent.filter(e=>e.type==='response.create').length;await utterance(h.q,'next','确认冻结');await h.q.handle({type:'response.created',response:{id:'next'}});await h.q.handle({...call('new-input'),response_id:'next'});await tick();
 assert.equal(h.tools.length,1);assert.equal(h.tools[0].context.utterance,'确认冻结');assert.equal(h.sent.filter(e=>e.type==='response.create').length,before);
 assert.equal(isExpectedRealtimeCancellation({type:'error',error:{type:'invalid_request_error',message:'Response request cancelled by new input'}}),true);
 for(const error of [{code:'insufficient_quota'},{type:'invalid_request_error',message:'Cannot continue a cancelled tool turn; submit new input'},{type:'authentication_error',message:'Response request cancelled by new input'},{type:'invalid_request_error',message:'Unknown provider error'}])assert.equal(isExpectedRealtimeCancellation({type:'error',error}),false);
});

const directConfirm=(text:string):WorkflowToolArguments|undefined=>text.replace(/[。\s]/g,'')==='确认冻结'?{operation:'confirm',taskId:'task',token:'current-token'}:undefined;
test('literal confirmation submits the trusted current command without waiting for a model tool call',async()=>{
 const h=harness(async()=>({reply:'请在页面认证。'}),directConfirm);h.q.userText('确认冻结');await tick();
 assert.equal(h.tools.length,1);assert.equal(h.tools[0].args.token,'current-token');assert.equal(h.tools[0].context.utterance,'确认冻结');assert.match(h.tools[0].context.requestId,/^voice-literal-/);
 assert.equal(h.sent.some(e=>e.type==='response.create'||e.item?.type==='function_call_output'),false);assert.equal(h.sent.at(-1).type,'session.update');assert.match(h.transcripts.at(-1)[1],/页面认证/);
 await h.q.handle({type:'response.created',response:{id:'late-provider'}});await h.q.handle({...call('duplicate'),response_id:'late-provider'});await tick();assert.equal(h.tools.length,1);
});

test('ASR confirmation is deduplicated and an automatic model reply cannot repeat it',async()=>{
 let finish!:(value:unknown)=>void;const h=harness(()=>new Promise(r=>finish=r),directConfirm);await utterance(h.q,'speech','确认冻结。');
 await h.q.handle({type:'conversation.item.input_audio_transcription.completed',item_id:'speech',transcript:'确认冻结。'});
 await h.q.handle({type:'response.created',response:{id:'automatic'}});await h.q.handle({...call('duplicate'),response_id:'automatic'});assert.equal(h.tools.length,1);
 finish({reply:'请在页面认证。'});await tick();await h.q.handle({type:'response.done',response:{id:'automatic'}});assert.equal(h.sent.at(-1).type,'session.update');assert.equal(h.sent.some(e=>e.item?.type==='function_call_output'),false);
});

test('interrupting direct confirmation aborts its request and cannot publish its late result',async()=>{
 let finish!:(value:unknown)=>void;const h=harness(()=>new Promise(r=>finish=r),directConfirm);h.q.userText('确认冻结');h.q.userText('等等，换一张卡');
 assert.equal(h.tools[0].context.signal.aborted,true);const before=h.transcripts.length;finish({reply:'old result'});await tick();assert.equal(h.transcripts.length,before);assert.equal(h.sent.some(e=>e.session?.instructions.includes('old result')),false);
});

test('actual provider progress extends the deadline and completed or stopped responses clear it',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const h=harness();h.q.userText('查卡片');await h.q.handle({type:'response.created',response:{id:'streaming'}});
 t.mock.timers.tick(20000);await h.q.handle({type:'response.audio_transcript.delta',response_id:'streaming',item_id:'text',delta:'正在查询'});
 t.mock.timers.tick(20000);assert.equal(h.issues.length,0);await h.q.handle({type:'response.done',response:{id:'streaming'}});t.mock.timers.tick(30001);assert.equal(h.issues.length,0);
 h.q.userText('继续');h.q.stop();t.mock.timers.tick(30001);assert.equal(h.issues.length,0);
});
test('native tool generation and execution keep audio muted until the result response',async()=>{
 let finish!:(value:unknown)=>void;const h=harness(()=>new Promise(r=>finish=r));
 h.q.userText('继续办理');await h.q.handle({type:'response.created',response:{id:'tool-response'}});
 await h.q.handle({type:'response.output_item.added',response_id:'tool-response',item:{type:'function_call',id:'tool-item',call_id:'tool-call',name:'bank_request',arguments:''}});
 assert.equal(h.q.outputAllowed,false);
 await h.q.handle({...call('tool-call'),response_id:'tool-response'});await tick();assert.equal(h.q.outputAllowed,false);
 await h.q.handle({type:'response.done',response:{id:'tool-response'}});finish({status:'blocked',message:'需要先完成风险测评。'});await tick();
 assert.equal(h.q.outputAllowed,false);await h.q.handle({type:'response.created',response:{id:'result-response'}});assert.equal(h.q.outputAllowed,true);h.q.stop();
});
test('audio and filler traffic cannot indefinitely extend a response with no useful progress',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const h=harness();h.q.userText('继续办理');await h.q.handle({type:'response.created',response:{id:'nonverbal'}});
 for(let i=0;i<4;i++){
  t.mock.timers.tick(10000);await h.q.handle({type:'response.audio.delta',response_id:'nonverbal',delta:'AA=='});
  await h.q.handle({type:'response.audio_transcript.delta',response_id:'nonverbal',item_id:'filler',delta:'啊，嗯……'});
 }
 assert.equal(h.issues.length,1);assert.equal(h.q.outputAllowed,false);assert.equal(h.tools.length,0);h.q.stop();
});
test('late progress from an old response cannot extend the current response watchdog',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const h=harness();h.q.userText('查账户');await h.q.handle({type:'response.created',response:{id:'old'}});
 h.q.userText('先查卡片');await h.q.handle({type:'response.done',response:{id:'old'}});await h.q.handle({type:'response.created',response:{id:'current'}});
 t.mock.timers.tick(20000);await h.q.handle({type:'response.audio_transcript.delta',response_id:'old',item_id:'old-text',delta:'旧结果'});
 t.mock.timers.tick(10001);assert.equal(h.issues.length,1);h.q.stop();
});
test('stop aborts outstanding tools and ignores later events',async()=>{
 const h=harness();h.q.stop();await utterance(h.q);await h.q.handle(call());await tick();assert.equal(h.tools.length,0);assert.equal(h.q.outputAllowed,false);
});

test('closing cancels generation, aborts pending tools and cannot execute queued or late work',async()=>{
 let finish!:(v:unknown)=>void;const h=harness(()=>new Promise(r=>finish=r));
 await utterance(h.q);await h.q.handle({type:'response.created',response:{id:'exit-response'}});
 await h.q.handle(call('exit-pending'));await tick();await h.q.handle(call('exit-queued'));
 h.q.stop();assert.equal(h.tools[0].context.signal.aborted,true);
 assert.equal(h.sent.filter(e=>e.type==='response.cancel').length,1);
 const count=h.sent.length;finish({status:'complete'});await tick();
 await h.q.handle({type:'response.done'});await h.q.handle(call('exit-late'));
 h.q.stop();assert.equal(h.tools.length,1);assert.equal(h.sent.length,count);
 assert.equal(h.sent.some(e=>e.item?.type==='function_call_output'),false);assert.equal(h.q.outputAllowed,false);
});
test('all ordinary 500 replies ground to 500 yuan without a currency confirmation loop',()=>{
 for(const text of ['500','500。','五百','五百。','五百元','500元']){assert.equal(spokenAmount(text).amount,50000);let s=apply(initialState(),{operation:'update_transfer'},'我要转账');s=apply(s,{operation:'update_transfer',amount:500},text);assert.equal(s.task!.amount,50000);assert.equal(s.task!.amountNeedsConfirmation,false);s=apply(s,{operation:'update_transfer',amount:500},text);assert.equal(s.task!.amountNeedsConfirmation,false);}
});
test('tool amount cannot disagree with user evidence and a guessed contact or account is unresolved',()=>{
 let s=apply(initialState(),{operation:'update_transfer',amount:500,recipientId:'zhang-roommate',accountId:'daily'},'给张三转50元');assert.equal(s.task!.amount,null);assert.equal(s.task!.recipientId,null);assert.equal(s.task!.accountId,null);assert.throws(()=>reduceBank(s,{type:'confirm'},crypto.randomUUID()));
});
test('account listing preserves task and authorization; selecting a displayed ordinal resumes transfer',()=>{
 let s=ready();const id=s.task!.id;s=apply(s,{operation:'list_accounts'},'我有哪些账户');assert.equal(s.view,'balance');assert.equal(s.task!.id,id);s=apply(s,{operation:'update_transfer',accountId:'savings'},'用第二个');assert.equal(s.task!.accountId,'savings');assert.equal(s.task!.amount,50000);
});
test('confirm requires a current summary token, actual acknowledgement and the same checklist',()=>{
 let s=ready();const token=s.task!.reviewToken!;assert.ok(token);
 const forged=apply(s,{operation:'confirm_transfer',confirmationToken:crypto.randomUUID()},'确认转账');assert.equal(forged.task!.verificationId,null);
 s=apply(s,{operation:'confirm_transfer',confirmationToken:token},'好的，就这样转吧');assert.equal(s.task!.step,'authenticate');assert.equal(s.receipts.length,0);
 const id=s.task!.verificationId!;s=reduceBank(s,{type:'authenticate',code:'123456',verificationId:id},crypto.randomUUID());assert.equal(s.receipts.length,1);assert.equal(s.receipts[0].amount,50000);
});
test('edits revoke summary tokens, confirmation and authentication',()=>{
 let s=ready();const token=s.task!.reviewToken!;s=apply(s,{operation:'update_transfer',amount:300},'300。');assert.notEqual(s.task!.reviewToken,token);s=apply(s,{operation:'confirm_transfer',confirmationToken:token},'确认');assert.equal(s.task!.verificationId,null);
});
test('risk signals remain blocking and unimplemented workflows cannot invent results',()=>{
 let s=ready();s=apply(s,{operation:'update_transfer'},'对方说是刷单保证金');assert.equal(s.checklist!.outcome,'blocked');assert.throws(()=>reduceBank(s,{type:'confirm'},crypto.randomUUID()));
 s=apply(s,{operation:'select_workflow',workflowId:'SD-S05'},'取消会员');assert.equal(s.routing!.outcome,'unsupported');assert.equal(s.receipts.length,0);
});
test('compact tool output omits audit, transcript, verification token and codes',()=>{
 let s=ready();s=apply(s,{operation:'confirm_transfer',confirmationToken:s.task!.reviewToken},'确认转账');const out=bankToolResult(s);assert.equal('audit'in out,false);assert.equal('verificationId'in out.task!,false);assert.equal('code'in out.task!,false);
});

test('Omni can ask several natural questions before a tool; final fields are grounded in recent actual user turns',()=>{
 const args:RealtimeToolArguments={operation:'update_transfer',amount:500,recipientId:'zhang-roommate',accountId:'savings'};
 let d=realtimeToolDecision(args,initialState(),'用储蓄账户',['我想转账','五百。','室友那个','我有哪些账户','用储蓄账户']);let s=reduceBank(initialState(),{type:'route',decision:d},crypto.randomUUID());assert.equal(s.task!.amount,50000);assert.equal(s.task!.recipientId,'zhang-roommate');assert.equal(s.task!.accountId,'savings');
 d=realtimeToolDecision(args,initialState(),'用储蓄账户',['五百。','改成三百元','给室友转账','用储蓄账户']);assert.ok(d.unresolved.includes('amount'));
});

test('numeric string tool arguments are normalized without accepting malformed or ambiguous money',()=>{
 assert.equal(realtimeToolArguments.parse({operation:'update_transfer',amount:'500'}).amount,500);
 for(const amount of ['500元','500 or 300','1e3','1.234'])assert.equal(realtimeToolArguments.safeParse({operation:'update_transfer',amount}).success,false);
});
test('a cancelled response cannot execute truncated late function arguments or emit unknown call results',async()=>{
 const h=harness();await utterance(h.q);await h.q.handle({type:'response.created',response:{id:'old'}});await h.q.handle({type:'input_audio_buffer.speech_started',item_id:'u2'});await h.q.handle({...call('late','{"operation":'),response_id:'old'});await tick();assert.equal(h.tools.length,0);assert.equal(h.sent.some(e=>e.item?.type==='function_call_output'),false);
});

test('a new automatic response after a completed user interruption is not mistaken for an old queued continuation',async()=>{
 const h=harness();h.q.userText('我有哪些账户');await h.q.handle({type:'input_audio_buffer.speech_started',item_id:'u2'});await h.q.handle({type:'input_audio_buffer.speech_stopped',item_id:'u2'});await h.q.handle({type:'conversation.item.input_audio_transcription.completed',item_id:'u2',transcript:'用储蓄账户'});const before=h.sent.filter(e=>e.type==='response.cancel').length;await h.q.handle({type:'response.created',response:{id:'new-user-response'}});assert.equal(h.q.outputAllowed,true);assert.equal(h.sent.filter(e=>e.type==='response.cancel').length,before);
});
test('all monetary facts returned to Omni use explicit yuan units',()=>{
 let s=ready();s=apply(s,{operation:'list_accounts'},'我有哪些账户');const out=bankToolResult(s);assert.equal(out.amountUnit,'yuan');assert.equal(out.accounts![1].balance,30000);assert.equal(out.task!.amount,500);
 s=apply(s,{operation:'update_transfer',accountId:'daily'},'用日常账户');s=apply(s,{operation:'confirm_transfer',confirmationToken:s.task!.reviewToken},'确认转账');s=reduceBank(s,{type:'authenticate',code:'123456',verificationId:s.task!.verificationId!},crypto.randomUUID());assert.equal(bankToolResult(s).receipt!.amount,500);
});

test('changing 500 to 300 preserves recipient and account chosen on cards despite stale ambiguous history',()=>{
 let s=apply(initialState(),{operation:'update_transfer'},'我要给张三转账');
 s=reduceBank(s,{type:'select_recipient',recipientId:'zhang-roommate'},crypto.randomUUID());
 s=reduceBank(s,{type:'edit',accountId:'daily'},crypto.randomUUID());
 const history=['我要给张三转账','我先看看日常和储蓄账户'];
 for(const amount of [500,300]){
  const d=realtimeToolDecision({operation:'update_transfer',amount,recipientId:'zhang-roommate',accountId:'daily'},s,String(amount),history);
  s=reduceBank(s,{type:'route',decision:d},crypto.randomUUID());
  assert.equal(s.task!.recipientId,'zhang-roommate');assert.equal(s.task!.accountId,'daily');
  assert.equal(s.task!.amount,amount*100);assert.deepEqual(d.unresolved,[]);
 }
});

test('untouched collected fields cannot be replaced by older speech or model restatements',()=>{
 const s=ready();
 for(const args of [{operation:'update_transfer',amount:300},{operation:'update_transfer',amount:300,recipientId:'zhang-landlord',accountId:'savings'}]as RealtimeToolArguments[]){
  const d=realtimeToolDecision(args,s,'改成300元',['给房东转500元，用储蓄账户']);
  const next=reduceBank(s,{type:'route',decision:d},crypto.randomUUID());
  assert.equal(next.task!.recipientId,'zhang-roommate');assert.equal(next.task!.accountId,'daily');assert.equal(next.task!.amount,30000);
 }
 const d=realtimeToolDecision({operation:'update_transfer',recipientId:'zhang-landlord'},s,'收款人改成房东',['转800元，用储蓄账户']);
 const next=reduceBank(s,{type:'route',decision:d},crypto.randomUUID());
 assert.equal(next.task!.recipientId,'zhang-landlord');assert.equal(next.task!.amount,50000);assert.equal(next.task!.accountId,'daily');
 const same=apply(s,{operation:'update_transfer',amount:300},'收款人和付款账户不变，只把金额改成300元');
 assert.equal(same.task!.recipientId,'zhang-roommate');assert.equal(same.task!.accountId,'daily');assert.equal(same.task!.amount,30000);
});

test('checklist progress only asks missing fields and amount corrections revoke only the old authorization',()=>{
 let s=apply(initialState(),{operation:'update_transfer',recipientId:'li-friend'},'给同学李四转账');
 let progress=bankToolResult(s).transferProgress!;
 assert.equal(progress.collected.recipient,'同学李四');assert.deepEqual(progress.missingFields,['amount','account']);
 s=apply(s,{operation:'update_transfer',amount:500,accountId:'daily'},'用日常账户转500元');
 const old=s.task!.reviewToken!;s=apply(s,{operation:'confirm_transfer',confirmationToken:old},'确认转账');const oldAuth=s.task!.verificationId!;
 s=apply(s,{operation:'update_transfer',amount:300},'不对，300');progress=bankToolResult(s).transferProgress!;
 assert.equal(s.task!.recipientId,'li-friend');assert.equal(s.task!.accountId,'daily');assert.equal(s.task!.amount,30000);
 assert.deepEqual(progress.missingFields,[]);assert.equal(progress.nextAction,'review_current_summary');
 assert.deepEqual(new Set(progress.preservedFields),new Set(['recipient','account']));
 assert.notEqual(s.task!.reviewToken,old);assert.equal(s.task!.verificationId,null);
 assert.equal(s.checklist!.checks.find(c=>c.id==='TF-T01.recipient.unique')!.status,'passed');
 assert.throws(()=>reduceBank(s,{type:'authenticate',code:'123456',verificationId:oldAuth},crypto.randomUUID()));
 const stale=apply(s,{operation:'confirm_transfer',confirmationToken:old},'确认');assert.equal(stale.task!.verificationId,null);
});

test('explicit recipient/account edits and unclear new amounts still require their own evidence',()=>{
 const s=ready();
 const ambiguous=apply(s,{operation:'update_transfer'},'收款人改成张三');assert.equal(ambiguous.task!.recipientId,null);assert.equal(ambiguous.task!.amount,50000);assert.equal(ambiguous.task!.accountId,'daily');
 const other=apply(s,{operation:'update_transfer',accountId:'savings'},'改用储蓄账户');assert.equal(other.task!.recipientId,'zhang-roommate');assert.equal(other.task!.amount,50000);assert.equal(other.task!.accountId,'savings');
 const relative=apply(s,{operation:'update_transfer'},'改成一半余额');assert.equal(relative.task!.amount,null);assert.equal(relative.task!.recipientId,'zhang-roommate');
 const unsupported=apply(s,{operation:'update_transfer',amount:300},'转给室友300美元');assert.equal(unsupported.task!.amount,null);
 for(const text of ['不对，300','改口三百','应该是300元'])assert.equal(spokenAmount(text).amount,30000);
});

test('repeated unchanged fields or confirmation do not restart a completed confirmation step',()=>{
 let s=ready();const token=s.task!.reviewToken!;
 s=apply(s,{operation:'update_transfer',amount:500,accountId:'daily',recipientId:'zhang-roommate'},'还是从日常账户给室友转500元');
 assert.equal(s.task!.reviewToken,token);
 s=apply(s,{operation:'confirm_transfer',confirmationToken:token},'确认');const auth=s.task!.verificationId!;
 s=apply(s,{operation:'update_transfer',amount:500},'500');
 assert.equal(s.task!.step,'authenticate');assert.equal(s.task!.verificationId,auth);
 s=apply(s,{operation:'confirm_transfer',confirmationToken:token},'确认');
 assert.equal(s.task!.step,'authenticate');assert.equal(s.task!.verificationId,auth);assert.match(s.lastReply,/已经确认/);
 s=apply(s,{operation:'update_transfer',amount:300},'改成300元');
 assert.equal(s.task!.step,'review');assert.equal(s.task!.verificationId,null);assert.notEqual(s.task!.reviewToken,token);
 let card=ready();card=apply(card,{operation:'confirm_transfer',confirmationToken:card.task!.reviewToken},'确认');
 card=reduceBank(card,{type:'edit',amount:card.task!.amount!},crypto.randomUUID());
 assert.equal(card.task!.step,'review');assert.equal(card.task!.verificationId,null); // Explicit card back/edit still returns to review.
});

test('retaining collected fields cannot retain authorization when current balance no longer permits the transfer',()=>{
 let s=ready();s=apply(s,{operation:'confirm_transfer',confirmationToken:s.task!.reviewToken},'确认');const auth=s.task!.verificationId!;
 s.accounts[0].balance=10000; // Another completed operation consumed the balance.
 s=apply(s,{operation:'update_transfer',amount:500},'500');
 assert.equal(s.task!.recipientId,'zhang-roommate');assert.equal(s.task!.accountId,'daily');
 assert.equal(s.task!.verificationId,null);assert.equal(s.task!.reviewToken,null);
 assert.equal(bankToolResult(s).transferProgress!.nextAction,'explain_block');
 assert.throws(()=>reduceBank(s,{type:'authenticate',code:'123456',verificationId:auth},crypto.randomUUID()));
 assert.equal(s.receipts.length,0);
});


test('tool chain limit invokes bounded draft recovery once and does not reopen automatic calls',async()=>{
 const sent:any[]=[],seen:any[]=[];let tools=0;
 const q=new QwenConversation((type,extra)=>sent.push({type,...extra}),{onTranscript:()=>{},onInterrupt:()=>{},onTool:async()=>{tools++;throw new BankRequestError('所选业务与原话不一致',400);},onTurnComplete:async c=>{seen.push(c);return {status:'recovered'};}});
 await utterance(q,'loop','查询账单');
 for(let i=0;i<9;i++){await q.handle({type:'response.created',response:{id:'cap-'+i}});await q.handle({...call('cap-call-'+i),response_id:'cap-'+i});await tick();await q.handle({type:'response.done',response:{id:'cap-'+i}});}
 assert.equal(tools,6);assert.equal(seen.length,1);assert.equal(seen[0].attempts.length,6);assert.match(seen[0].error,/所选业务/);assert.equal(q.outputAllowed,false);
 const count=sent.filter(e=>e.type==='response.create').length;await q.handle({type:'session.updated'});await tick();assert.equal(sent.filter(e=>e.type==='response.create').length,count);q.stop();
});

test('the JSON intent path with qwen-plus is the default; QWEN_INTENT=tools restores the tool loop', () => {
  const env = { DASHSCOPE_API_KEY: 'k', DASHSCOPE_WORKSPACE_ID: 'llm-test' };
  assert.equal(qwenConfig(env).intent, 'json'); assert.equal(qwenConfig(env).planner, 'qwen-plus');
  assert.equal(qwenConfig({ ...env, QWEN_INTENT: 'tools' }).intent, 'tools');
});
