import test from 'node:test';
import assert from 'node:assert/strict';
import {BackgroundSupervisor} from '../lib/voice/background-supervisor.ts';
import {QwenConversation,type ConversationCallbacks,type ObserverVerdict,type SpeechVerdict} from '../lib/voice/qwen-protocol.ts';
import {initialState,reduceBank} from '../lib/bank/engine.ts';
import {superviseReply,type SupervisionInput} from '../lib/voice/supervision.ts';
import {currentWorkflow} from '../lib/workflows/engine.ts';
import {SupervisionTracker} from '../lib/voice/supervision-tracker.ts';
import {reviewReply} from '../lib/voice/reply-review.ts';
import {BankRequestError} from '../lib/bank/request-error.ts';
import {correctedReadback} from '../lib/voice/corrected-readback.ts';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>resolve=done);return {promise,resolve};}
function harness(callbacks:Partial<ConversationCallbacks>={}){
 const sent:any[]=[],heard:string[]=[],busy:boolean[]=[];
 const q=new QwenConversation((type,extra)=>sent.push({type,...extra}),{onTranscript:(speaker,text)=>{if(speaker==='assistant')heard.push(text)},onInterrupt:()=>{},onTool:async()=>({}),onBusy:value=>busy.push(value),...callbacks});
 return {q,sent,heard,busy};
}
const sentence='日常账户的余额是两千六百元，储蓄账户的余额是一万两千元，这些是刚刚查询得到的结果。';
async function speaking(h:ReturnType<typeof harness>,id='r1'){
 await h.q.handle({type:'response.created',response:{id}});
 await h.q.handle({type:'response.audio_transcript.delta',response_id:id,item_id:id+'-m',delta:sentence});
}
async function done(h:ReturnType<typeof harness>,id='r1'){
 await h.q.handle({type:'response.done',response:{id,status:'completed',output:[{type:'message',content:[{type:'audio',transcript:sentence}]}]}});
}

test('a correction replaces the old readback prompt with a backend-rendered draft summary',async()=>{
 const state=reduceBank(initialState(),{type:'workflow',command:{source:'card',operation:'run',functionId:'TR03',params:{recipientId:'zhang-roommate',accountId:'daily',amount:500}}},crypto.randomUUID());
 const text=correctedReadback(state);assert.match(text,/尚未执行/);assert.match(text,/500/);assert.doesNotMatch(text,/已经成功|已转出/);
 const observation=deferred<ObserverVerdict>();
 const h=harness({onSuperviseReply:async()=>observation.promise,onReconcileReply:async()=>({decision:'repair',repairScope:'content',facts:{revision:state.revision},readback:text})});
 h.q.userText('给室友转500元');await speaking(h);observation.resolve({decision:'pause',message:'wrong success',evidence:'no receipt'});await tick();await tick();
 await h.q.handle({type:'response.done',response:{id:'r1',status:'cancelled'}});await h.q.handle({type:'session.updated'});
 const script=h.sent.findLast(e=>e.type==='conversation.item.create'&&e.item.role==='user')!.item.content[0].text;
 assert.match(script,/新的后台更正稿/);assert.ok(script.includes(text));assert.ok(!script.includes(sentence));h.q.stop();
});

test('normal speech streams before a slow observer returns, with no waiting message or approval gate',async()=>{
 const wait=deferred<ObserverVerdict>();let observed=0;
 const h=harness({onSuperviseReply:async()=>{observed++;return wait.promise}});
 h.q.userText('查询我的账户余额');await speaking(h);
 assert.equal(h.q.outputAllowed,true);assert.equal(h.heard.at(-1),sentence);assert.equal(observed,1);
 assert.ok(!h.heard.some(text=>text.includes('我先核对一下')));
 await done(h);assert.equal(h.busy.at(-1),false);assert.equal(h.q.outputAllowed,true);
 wait.resolve({decision:'continue'});await tick();h.q.stop();
});

test('a concrete issue pauses speech once and resumes from fresh facts without fabricating user input',async()=>{
 const observation=deferred<ObserverVerdict>(),reconciliation=deferred<SpeechVerdict>();let pauses=0,reconciles=0;
 const h=harness({onSuperviseReply:async()=>reconciles?{decision:'continue'}:observation.promise,onSupervisionPause:async()=>{pauses++;},onReconcileReply:async()=>{reconciles++;return reconciliation.promise}});
 h.q.userText('查询账户余额');await speaking(h);const inputItems=h.sent.filter(e=>e.item?.role==='user').length;
 observation.resolve({decision:'pause',message:'余额与后台不符',evidence:'actual.accounts'});await tick();
 assert.equal(h.q.outputAllowed,true);assert.equal(h.sent.filter(e=>e.type==='response.cancel').length,0);assert.equal(pauses,0);assert.equal(reconciles,1);
 await h.q.handle({type:'response.done',response:{id:'r1',status:'cancelled'}});
 reconciliation.resolve({decision:'repair',repairScope:'query',facts:{revision:3,accounts:[{balance:1286500}]},message:'按最新余额更正'});await tick();
 assert.equal(h.q.outputAllowed,false);assert.equal(pauses,1);
 const update=h.sent.findLast(e=>e.type==='session.update');assert.ok(update.session.instructions.includes('已经说错')||update.session.instructions.includes('若先前说错'));
 assert.ok(update.session.instructions.includes('禁止任何业务操作'));
 await h.q.handle({type:'session.updated'});await speaking(h,'corrected');await done(h,'corrected');
 assert.equal(h.q.outputAllowed,true);assert.equal(pauses,1);assert.equal(h.sent.filter(e=>e.item?.role==='user').length,inputItems);h.q.stop();
});

test('a newer user turn discards a late pause verdict even when the provider ignores cancellation',async()=>{
 const wait=deferred<ObserverVerdict>();let pauses=0;
 const h=harness({onSuperviseReply:async()=>wait.promise,onSupervisionPause:async()=>{pauses++;}});
 h.q.userText('查询余额');await speaking(h);h.q.userText('先解释什么是货币基金');await h.q.handle({type:'response.created',response:{id:'new'}});
 wait.resolve({decision:'pause',message:'old',evidence:'old'});await tick();assert.equal(pauses,0);assert.equal(h.q.outputAllowed,true);h.q.stop();
});

test('a pause from an earlier response in the same turn revalidates the newest response',async()=>{
 const wait=deferred<ObserverVerdict>(),seen:any[]=[];
 const h=harness({onSuperviseReply:async()=>wait.promise,onReconcileReply:async context=>{seen.push(context);return {decision:'accept',facts:{revision:9}};}});
 h.q.userText('不转了');await speaking(h,'old');await done(h,'old');
 await speaking(h,'new');
 wait.resolve({decision:'pause',message:'仍是review',evidence:'old observation'});await tick();
 assert.equal(seen.length,1);assert.equal(seen[0].responseId,'new');assert.equal(seen[0].utterance,'不转了');
 assert.equal(seen[0].concern.evidence,'old observation');h.q.stop();
});

test('a pending pause waits for a tool result and then revalidates without aborting the tool',async()=>{
 const wait=deferred<ObserverVerdict>(),tool=deferred<unknown>(),seen:any[]=[];let signal:AbortSignal|undefined;
 const h=harness({onSuperviseReply:async()=>wait.promise,onTool:async(_name,_args,context)=>{signal=context.signal;return tool.promise;},onReconcileReply:async context=>{seen.push(context);return {decision:'accept',facts:{status:'cancelled'}};}});
 h.q.userText('不转了');await speaking(h);
 await h.q.handle({type:'response.function_call_arguments.done',response_id:'r1',name:'bank_request',call_id:'c1',arguments:'{"operation":"get_state"}'});await tick();
 wait.resolve({decision:'pause',message:'仍未取消',evidence:'review'});await tick();assert.equal(seen.length,0);assert.equal(signal!.aborted,false);
 tool.resolve({status:'cancelled'});await tick();assert.equal(seen.length,1);assert.equal(signal!.aborted,false);
 assert.ok(seen[0].tracking.events.some((event:any)=>event.kind==='tool_result'&&event.text.includes('cancelled')));h.q.stop();
});

test('a new user turn clears a pause deferred behind an in-flight tool',async()=>{
 const wait=deferred<ObserverVerdict>(),tool=deferred<unknown>();let reconciles=0;
 const h=harness({onSuperviseReply:async()=>wait.promise,onTool:async()=>tool.promise,onReconcileReply:async()=>{reconciles++;return {decision:'accept',facts:{}};}});
 h.q.userText('不转了');await speaking(h);
 await h.q.handle({type:'response.function_call_arguments.done',response_id:'r1',name:'bank_request',call_id:'c1',arguments:'{"operation":"get_state"}'});await tick();
 wait.resolve({decision:'pause',message:'仍未取消',evidence:'review'});await tick();
 h.q.userText('继续保留这份转账草稿');tool.resolve({status:'review'});await tick();
 await h.q.handle({type:'response.created',response:{id:'new-turn'}});assert.equal(reconciles,0);h.q.stop();
});

test('a tool starting invalidates older observations and its in-flight request is not aborted by a late verdict',async()=>{
 const wait=deferred<ObserverVerdict>(),tool=deferred<unknown>();let toolSignal:AbortSignal|undefined,pauses=0;
 const h=harness({onSuperviseReply:async()=>wait.promise,onSupervisionPause:async()=>{pauses++;},onTool:async(_name,_args,context)=>{toolSignal=context.signal;return tool.promise;}});
 h.q.userText('从日常账户给室友转500元');await speaking(h);
 await h.q.handle({type:'response.function_call_arguments.done',response_id:'r1',name:'bank_request',call_id:'c1',arguments:'{"operation":"update_transfer","amount":500}'});await tick();
 wait.resolve({decision:'pause',message:'missing',evidence:'old state'});await tick();assert.equal(pauses,0);assert.equal(toolSignal?.aborted,false);
 tool.resolve({status:'review'});await tick();assert.equal(h.sent.filter(e=>e.item?.type==='function_call_output').length,1);h.q.stop();
});

test('observer failures leave speech running and never invoke reconciliation',async()=>{
 let reconciles=0;const h=harness({onSuperviseReply:async()=>{throw new Error('offline')},onReconcileReply:async()=>{reconciles++;return {decision:'reject'}}});
 h.q.userText('解释一下储蓄账户');await speaking(h);await tick();assert.equal(h.q.outputAllowed,true);assert.equal(reconciles,0);assert.equal(h.sent.filter(e=>e.type==='response.cancel').length,0);h.q.stop();
});

test('a newer response keeps streaming and invalidates an earlier pending content review',async()=>{
 const reconcile=deferred<SpeechVerdict>();
 const h=harness({onSuperviseReply:async()=>({decision:'pause',message:'wrong',evidence:'facts'}),onReconcileReply:async()=>reconcile.promise});
 h.q.userText('查余额');await speaking(h);await tick();assert.equal(h.q.outputAllowed,true);
 await h.q.handle({type:'response.created',response:{id:'newer'}});assert.equal(h.q.outputAllowed,true);
 reconcile.resolve({decision:'repair',facts:{revision:1},repairScope:'content'});await tick();
 assert.equal(h.q.outputAllowed,true);assert.equal(h.sent.filter(e=>e.type==='response.cancel').length,0);h.q.stop();
});

test('unresolved reconciliation stops once and a new real user turn can continue',async()=>{
 let pauses=0,recoveries=0;const h=harness({onSuperviseReply:async()=>({decision:'pause',message:'wrong result',evidence:'state'}),onSupervisionPause:async()=>{pauses++;},onReconcileReply:async()=>({decision:'reject',message:'尚未核实',facts:{revision:2}}),onHaltedRecovery:facts=>{recoveries++;assert.deepEqual(facts,{revision:2});}});
 h.q.userText('查余额');await speaking(h);await tick();assert.equal(pauses,0);assert.equal(h.q.outputAllowed,false);assert.equal(recoveries,1);assert.ok(!h.heard.some(text=>/信息无法核实|以业务卡片为准/.test(text)));
 h.q.userText('我自己看卡片，解释一下利息');await h.q.handle({type:'response.created',response:{id:'new'}});assert.equal(h.q.outputAllowed,true);h.q.stop();
});

test('background checks coalesce snapshots, never queue every fragment, and discard invalidated work',async()=>{
 const waits=[deferred<ObserverVerdict>(),deferred<ObserverVerdict>()],seen:number[]=[],paused:number[]=[];
 const observer=new BackgroundSupervisor<number>(async input=>{seen.push(input);return waits[seen.length-1].promise;},input=>paused.push(input));
 observer.check(1);observer.check(2);observer.check(3);assert.deepEqual(seen,[1]);
 waits[0].resolve({decision:'continue'});await tick();assert.deepEqual(seen,[1,3]);observer.reset();waits[1].resolve({decision:'pause'});await tick();assert.deepEqual(paused,[]);
});

test('new queued words cannot silently discard a concrete pause; reconciliation must revalidate it',async()=>{
 const first=deferred<ObserverVerdict>(),seen:number[]=[],paused:number[]=[];
 const observer=new BackgroundSupervisor<number>(async input=>{seen.push(input);return input===1?first.promise:{decision:'continue'};},input=>paused.push(input));
 observer.check(1);observer.check(2);first.resolve({decision:'pause',message:'wrong amount',evidence:'stored amount=200'});await tick();assert.deepEqual(seen,[1]);assert.deepEqual(paused,[1]);observer.reset();
});

test('pending snapshots are materialized at submission and cannot mutate an in-flight request',async()=>{
 const first=deferred<ObserverVerdict>(),seen:{value:number}[]=[];let latest=1;
 const observer=new BackgroundSupervisor<{value:number}>(async input=>{seen.push(input);return seen.length===1?first.promise:{decision:'continue'};},()=>{});
 observer.checkLatest(()=>({value:latest}));latest=2;observer.checkLatest(()=>({value:latest}));latest=3;
 assert.deepEqual(seen,[{value:1}]);first.resolve({decision:'continue'});await tick();assert.deepEqual(seen,[{value:1},{value:3}]);observer.reset();
});

test('unavailable and stale results keep the examination watermark and all unexamined events',()=>{
 const tracker=new SupervisionTracker();tracker.record('user','t','改成300');tracker.record('assistant','t','已改成300','r');
 const snapshot=tracker.snapshot();tracker.settle(snapshot,'t','r',{decision:'continue',unavailable:true});assert.equal(tracker.status().checkedThrough,0);
 tracker.settle(snapshot,'t','r',{decision:'pause',message:'金额未保存',evidence:'实际200',stale:true});assert.equal(tracker.status().checkedThrough,0);assert.equal(tracker.status().openIssues,1);assert.equal(tracker.snapshot().events.length,2);
 tracker.settle(snapshot,'t','r',{decision:'continue'});assert.equal(tracker.status().checkedThrough,2);assert.equal(tracker.status().openIssues,1);
});

test('a concern requires a quoted later authoritative event, never another assistant claim or a bare continue',()=>{
 const tracker=new SupervisionTracker();tracker.record('user','t','改成300');tracker.record('assistant','t','已改成300','r');
 tracker.settle(tracker.snapshot(),'t','r',{decision:'pause',message:'金额未保存',evidence:'实际200'});
 tracker.record('assistant','t','已经改好了','r2');let snapshot=tracker.snapshot();
 tracker.settle(snapshot,'t','r2',{decision:'continue',resolutions:[{issueId:1,eventId:3,quote:'已经改好了'}]});assert.equal(tracker.status().openIssues,1);
 tracker.record('tool_result','t','保存成功：amount=300');snapshot=tracker.snapshot();
 tracker.settle(snapshot,'t','r2',{decision:'continue',resolutions:[{issueId:1,eventId:4,quote:'amount=999'}]});assert.equal(tracker.status().openIssues,1);
 tracker.record('state','t','已保存 amount=300');snapshot=tracker.snapshot();
 tracker.settle(snapshot,'t','r2',{decision:'continue',resolutions:[{issueId:1,eventId:5,quote:'amount=300'}]});assert.equal(tracker.status().openIssues,0);
});

test('an explicit later withdrawal can resolve an open concern without manufacturing a tool result',()=>{
 const tracker=new SupervisionTracker();tracker.record('user','t1','查咖啡支出');tracker.record('assistant','t1','320元');tracker.settle(tracker.snapshot(),'t1','r1',{decision:'pause',message:'没有查询依据',evidence:'no_call'});
 tracker.record('user','t2','不用查咖啡了，先解释利息');tracker.settle(tracker.snapshot(),'t2','r2',{decision:'continue',resolutions:[{issueId:1,eventId:3,quote:'不用查咖啡了'}]});assert.equal(tracker.status().openIssues,0);
});

test('a request can remain pending across valid continue verdicts without being a premature pause',()=>{
 const tracker=new SupervisionTracker();tracker.record('user','t1','这个月咖啡花了多少钱');
 tracker.settle(tracker.snapshot(),'t1','r1',{decision:'continue',pendingChecks:[{eventId:1,message:'等待本月咖啡查询实际结果',quote:'这个月咖啡花了多少钱'}]});
 assert.equal(tracker.status().checkedThrough,1);assert.equal(tracker.snapshot().openIssues[0].kind,'pending');
 tracker.record('assistant','t1','我正在查。');tracker.settle(tracker.snapshot(),'t1','r1',{decision:'continue',pendingChecks:[{eventId:2,message:'伪造用户要求',quote:'我正在查'}]});
 assert.equal(tracker.status().openIssues,1);assert.equal(tracker.snapshot().openIssues[0].message,'等待本月咖啡查询实际结果');
});

test('several requirements in the same user event keep separate pending checks',()=>{
 const tracker=new SupervisionTracker();tracker.record('user','t','先查余额，再准备转账');tracker.settle(tracker.snapshot(),'t','r',{decision:'continue',pendingChecks:[{eventId:1,message:'等待余额结果',quote:'查余额'},{eventId:1,message:'等待转账草稿',quote:'准备转账'}]});
 assert.equal(tracker.status().openIssues,2);
});

test('bounded batches preserve all critical events and cannot acknowledge events outside the submitted batch',()=>{
 const tracker=new SupervisionTracker();for(let i=0;i<30;i++)tracker.record('user','t','修改金额'+i);
 const first=tracker.snapshot();assert.equal(first.events.length,20);assert.equal(first.latest,30);tracker.record('user','t','取消');tracker.settle(first,'t','r',{decision:'continue'});
 assert.equal(tracker.status().checkedThrough,20);assert.deepEqual(tracker.snapshot().events.map(event=>event.id),Array.from({length:11},(_,i)=>i+21));
 tracker.settle(first,'t','r',{decision:'continue'});assert.equal(tracker.status().checkedThrough,20);
});

test('checked query/state evidence remains available for the final answer without becoming unchecked again',()=>{
 const tracker=new SupervisionTracker();tracker.record('user','t','查余额');tracker.record('tool_result','t','list_accounts成功，余额12865和30000');tracker.settle(tracker.snapshot('t'),'t','r',{decision:'continue'});
 tracker.record('assistant','t','余额12865和30000');const next=tracker.snapshot('t');
 assert.equal(next.checkedThrough,2);assert.equal(next.events.length,1);assert.ok(next.contextEvents?.some(event=>event.kind==='tool_result'));assert.equal(tracker.status().pendingEvents,1);
 assert.equal(tracker.snapshot('unrelated').contextEvents?.length,0);
 tracker.settle(next,'t','r',{decision:'pause',message:'更正措辞',evidence:'wrong wording'});tracker.record('state','t','重新读取余额12865和30000');tracker.settle(tracker.snapshot('t'),'t','r',{decision:'continue'});
 tracker.record('assistant','t','更正为余额12865和30000');const final=tracker.snapshot('t');tracker.settle(final,'t','r',{decision:'continue',resolutions:[{issueId:1,eventId:4,quote:'重新读取余额'}]});assert.equal(tracker.status().openIssues,0);
});

test('tracking capacity does not silently evict old unchecked user changes',()=>{
 const tracker=new SupervisionTracker();for(let i=0;i<128;i++)assert.equal(tracker.record('user','t','改金额'+i),true);
 assert.equal(tracker.record('user','t','取消'),false);assert.equal(tracker.status().overflow,true);assert.equal(tracker.snapshot().events[0].text,'改金额0');assert.equal(tracker.status().checkedThrough,0);
});

const microtasks=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
for(const delay of [500,2000,5000])test(`continuous snapshots keep one active check and preserve changes during ${delay}ms Flash latency`,async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});
 const seen:any[]=[],gates=[deferred<ObserverVerdict>(),deferred<ObserverVerdict>()];let concurrent=0,peak=0;
 const h=harness({onSuperviseReply:async input=>{const index=seen.length;seen.push(input);peak=Math.max(peak,++concurrent);try{return index<2?await gates[index].promise:{decision:'continue'};}finally{concurrent--;}}});
 h.q.userText('不对，改成300');await speaking(h);
 await h.q.handle({type:'response.audio_transcript.delta',response_id:'r1',item_id:'r1-m',delta:'我把金额改成了三百元'});
 t.mock.timers.tick(delay);await microtasks();assert.equal(seen.length,1);assert.equal(peak,1);
 // New words after the pending timer's snapshot must still reach the next request.
 await h.q.handle({type:'response.audio_transcript.delta',response_id:'r1',item_id:'r1-m',delta:'，收款人和账户保持原样。'});
 gates[0].resolve({decision:'continue'});await microtasks();assert.equal(seen.length,2);assert.ok(seen[1].reply.endsWith('收款人和账户保持原样。'));
 assert.ok(seen[1].tracking.events.some((event:any)=>event.text.includes('三百元')));assert.equal(peak,1);
 gates[1].resolve({decision:'continue'});await microtasks();h.q.stop();
});

test('short saved/cancelled claims get a check without waiting for 32 characters',async()=>{
 const seen:any[]=[];const h=harness({onSuperviseReply:async input=>{seen.push(input);return {decision:'continue'};}});
 h.q.userText('不转了');await h.q.handle({type:'response.created',response:{id:'r'}});await h.q.handle({type:'response.audio_transcript.delta',response_id:'r',item_id:'m',delta:'已取消。'});await tick();
 assert.equal(seen.length,1);assert.ok(seen[0].tracking.events.some((event:any)=>event.kind==='assistant'&&event.text==='已取消。'));h.q.stop();
});

test('an interrupted turn retains its unchecked events and open issues across a voice reconnect',async()=>{
 const tracker=new SupervisionTracker(),first=deferred<ObserverVerdict>();const h=harness({supervisionTracker:tracker,onSuperviseReply:async()=>first.promise});
 h.q.userText('改成300');await speaking(h);h.q.stop();assert.ok(tracker.status().pendingEvents>0);
 const seen:any[]=[];const next=harness({supervisionTracker:tracker,onSuperviseReply:async input=>{seen.push(input);return {decision:'continue'};}});
 next.q.userText('不转了');await speaking(next,'next');await tick();assert.ok(seen[0].tracking.events.some((event:any)=>event.text==='改成300'));assert.ok(seen[0].tracking.events.some((event:any)=>event.text==='不转了'));
 first.resolve({decision:'pause',message:'迟到意见',evidence:'old'});await tick();assert.equal(next.q.outputAllowed,true);next.q.stop();
});

test('failed observations retry at most once while idle, keep their watermark, and stop all timers on close',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});let calls=0;
 const h=harness({onSuperviseReply:async()=>{calls++;return {decision:'continue',unavailable:true};}});
 h.q.userText('解释利息');await speaking(h);await microtasks();t.mock.timers.tick(1000);await microtasks();t.mock.timers.tick(10000);await microtasks();assert.equal(calls,2);
 const diagnostic=h.q.diagnostic('test');assert.equal(diagnostic.supervision.checkedThrough,0);assert.equal(diagnostic.supervision.pendingEvents,2);
 const serialized=JSON.stringify(diagnostic);assert.ok(!serialized.includes(sentence));assert.ok(diagnostic.events.some(event=>event.type==='supervision_result'&&event.status==='unavailable'));
 h.q.stop();t.mock.timers.tick(20000);await microtasks();assert.equal(calls,2);
});

test('a confirmed second issue reads back actual progress without a second cue or tool replay',async()=>{
 let pauses=0,reconciles=0,checks=0,recoveries=0;
 const h=harness({onSuperviseReply:async()=>{checks++;return {decision:'pause',message:'wrong',evidence:'state'};},onSupervisionPause:async()=>{pauses++;},onReconcileReply:async()=>{reconciles++;return {decision:'repair',facts:{revision:1},repairScope:'query'};},onHaltedRecovery:facts=>{recoveries++;assert.deepEqual(facts,{revision:1});}});
 h.q.userText('查余额');await speaking(h);await tick();await h.q.handle({type:'response.done',response:{id:'r1',status:'cancelled'}});await h.q.handle({type:'session.updated'});
 await speaking(h,'r2');await done(h,'r2');await tick();assert.ok(checks>=2);assert.equal(pauses,1);assert.equal(reconciles,2);assert.equal(h.q.outputAllowed,false);assert.equal(recoveries,1);assert.ok(!h.heard.some(text=>/更正仍有信息无法核实/.test(text)));h.q.stop();
});

const provider={base:'https://example.invalid',key:'test-key',planner:'qwen-flash'};
const review:SupervisionInput={utterance:'解释一下储蓄账户',turnId:'test-turn',reason:'no_call',reply:'储蓄账户可以用来存钱。',startRevision:0,repairAttempt:0,checkpoint:'speaking'};
test('server observation is read-only even when Flash requests a pause',async()=>{
 const state=initialState(),before=JSON.stringify(state);let submitted:any;
 const request=async(_url:any,init:any)=>{submitted=JSON.parse(init.body);return Response.json({choices:[{message:{content:JSON.stringify({decision:'pause',claimQuote:review.reply,message:'实际余额不符',evidence:'actual.accounts'})}}]});};
 const result=await superviseReply(state,review,provider,undefined,request as typeof fetch);
 assert.equal(result.decision,'pause');assert.equal(JSON.stringify(state),before);assert.match(submitted.messages[0].content,/checkpoint=speaking时不能/);assert.equal(submitted.messages[1].role,'user');
});

test('unavailable, malformed, or evidence-free observers do not pause the foreground',async()=>{
 for(const content of ['not json',JSON.stringify({decision:'pause',message:'感觉不对',evidence:''}),JSON.stringify({decision:'pause',message:'提交',evidence:'models agree',action:{operation:'confirm'}})]){
  const result=await superviseReply(initialState(),review,provider,undefined,(async()=>Response.json({choices:[{message:{content}}]})) as typeof fetch);assert.equal(result.decision,'continue');
 }
 const result=await superviseReply(initialState(),review,provider,undefined,(async()=>{throw new Error('network')}) as typeof fetch);assert.equal(result.decision,'continue');assert.equal(result.unavailable,true);
});

test('Flash must review each open item and cite a later non-assistant event before resolving it',async()=>{
 const tracker=new SupervisionTracker();tracker.record('user','t','改成300');tracker.settle(tracker.snapshot(),'t','r',{decision:'pause',message:'未保存',evidence:'amount=200'});tracker.record('assistant','t','改好了');tracker.record('tool_result','t','保存成功 amount=300');
 const input={...review,tracking:tracker.snapshot()},assessment={request:'改成300',claim:'改好了',actual:'amount=300'};
 const run=(extra:object)=>superviseReply(initialState(),input,provider,undefined,(async()=>Response.json({choices:[{message:{content:JSON.stringify({assessment,decision:'continue',message:'核对完成',evidence:'state',pendingChecks:[],...extra})}}]})) as typeof fetch);
 for(const extra of [{issueReviews:[]},{issueReviews:[{issueId:1,status:'resolved',reason:'助手说改好',eventId:2,quote:'改好了'}]},{issueReviews:[{issueId:1,status:'resolved',reason:'保存成功',eventId:999,quote:'amount=999'}]},{issueReviews:[{issueId:1,status:'open',reason:'未解决'},{issueId:1,status:'open',reason:'重复'}]}])assert.equal((await run(extra)).unavailable,true);
 const result=await run({issueReviews:[{issueId:1,status:'resolved',reason:'已保存',eventId:3,quote:'模型抄写错误 amount=999'}]});assert.equal(result.unavailable,undefined);assert.equal(result.resolutions?.[0].quote,'保存成功 amount=300');tracker.settle(input.tracking,'t','r',result);assert.equal(tracker.status().openIssues,0);
});

test('a blank continue is not a completed examination for the continuous tracker',async()=>{
 const tracker=new SupervisionTracker();tracker.record('user','t','改成300');
 const result=await superviseReply(initialState(),{...review,tracking:tracker.snapshot()},provider,undefined,(async()=>Response.json({choices:[{message:{content:'{"decision":"continue","message":"","evidence":""}'}}]})) as typeof fetch);
 assert.equal(result.unavailable,true);tracker.settle(tracker.snapshot(),'t','r',result);assert.equal(tracker.status().checkedThrough,0);
});

test('invalid closure proofs cannot discard a concrete pause, close old issues or mark events examined',async()=>{
 for(const extra of [
  {issueReviews:[]},
  {issueReviews:[{issueId:1,status:'resolved',reason:'助手说取消了',eventId:2}]},
  {issueReviews:[{issueId:1,status:'open',reason:'尚未解决'}],resolutions:[{issueId:1,eventId:999,quote:'不存在的证据'}]},
  {issueReviews:[{issueId:1,status:'open',reason:'尚未解决'}],pendingChecks:[{eventId:2,message:'伪造用户要求',quote:'已取消'}]},
 ]){
  const tracker=new SupervisionTracker();tracker.record('user','t','不转了');tracker.settle(tracker.snapshot(),'t','old',{decision:'pause',message:'仍未取消',evidence:'review'});tracker.record('assistant','t','已取消');
  const snapshot=tracker.snapshot(),checked=tracker.status().checkedThrough;
  const result=await superviseReply(initialState(),{...review,reply:'已取消',tracking:snapshot},provider,undefined,(async()=>Response.json({choices:[{message:{content:JSON.stringify({assessment:{request:'取消',claim:'已取消',actual:'仍是review'},decision:'pause',claimQuote:'已取消',message:'取消没有执行',evidence:'workflow.status=review',...extra})}}]})) as typeof fetch);
  assert.equal(result.decision,'pause');assert.equal(result.unavailable,undefined);assert.equal(result.examinationIncomplete,true);assert.equal(result.resolutions,undefined);
  tracker.settle(snapshot,'t','new',result);assert.equal(tracker.status().checkedThrough,checked);assert.equal(tracker.status().pendingEvents,1);assert.ok(tracker.snapshot().openIssues.some(issue=>issue.id===1));
  let paused=false;const observer=new BackgroundSupervisor(async()=>result,()=>{paused=true;});observer.check(1);await tick();assert.equal(paused,true);observer.reset();
 }
});

test('structured factual rationale cannot discard a valid pause about an unsaved amount',async()=>{
 const tracker=new SupervisionTracker();tracker.record('user','t','改成300');
 const result=await superviseReply(initialState(),{...review,reply:'已改好',tracking:tracker.snapshot()},provider,undefined,(async()=>Response.json({choices:[{message:{content:JSON.stringify({assessment:{request:'改成300',claim:'已改好',actual:{task:{amount:200}}},decision:'pause',claimQuote:'已改好',message:'金额未保存',evidence:'actual.task.amount=200',pendingChecks:[],issueReviews:[]})}}]})) as typeof fetch);
 assert.equal(result.decision,'pause');assert.equal(result.unavailable,undefined);assert.equal(result.assessment?.actual,'{"task":{"amount":200}}');
});

test('large state events provide bounded exact proof excerpts instead of inviting whole JSON quotations',async()=>{
 const tracker=new SupervisionTracker();tracker.record('user','t','改成300');tracker.settle(tracker.snapshot(),'t','r',{decision:'pause',message:'未保存',evidence:'amount=200'});
 const stateEvent=JSON.stringify({reconciled:true,facts:{amount:300,description:'后台实际状态'.repeat(100)}});tracker.record('state','t',stateEvent);
 let submitted:any;
 const result=await superviseReply(initialState(),{...review,tracking:tracker.snapshot()},provider,undefined,(async(_url,init)=>{
  submitted=JSON.parse(String(init?.body));const payload=JSON.parse(submitted.messages[1].content),proof=payload.continuity.resolutionProofs.find((entry:any)=>entry.eventId===2);
  assert.equal(proof.quote.length,80);assert.ok(stateEvent.includes(proof.quote));
  return Response.json({choices:[{message:{content:JSON.stringify({assessment:{request:'改成300',claim:'已保存',actual:'amount=300'},decision:'continue',message:'与后台一致',evidence:'actual',issueReviews:[{issueId:1,status:'resolved',reason:'已保存',eventId:2,quote:proof.quote}]})}}]});
 }) as typeof fetch);assert.equal(result.unavailable,undefined);tracker.settle(tracker.snapshot(),'t','r',result);assert.equal(tracker.status().openIssues,0);
});

test('an unsaved answer alone does not interrupt speech, but a false saved claim does',async()=>{
 const state=reduceBank(initialState(),{type:'workflow',command:{operation:'run',functionId:'IN05',params:{},source:'voice',utterance:'开始做风险测评'}},crypto.randomUUID());
 const before=JSON.stringify(state);let calls=0;
 const request=(async()=>{calls++;return Response.json({choices:[{message:{content:'{"decision":"continue","message":"","evidence":""}'}}]});}) as typeof fetch;
 const input={...review,utterance:'第一题选三',reply:'好的。'};
 assert.equal((await superviseReply(state,input,provider,undefined,request)).decision,'continue');assert.equal(calls,1);
 const complete=await superviseReply(state,{...input,checkpoint:'complete'},provider,undefined,request);assert.equal(complete.decision,'continue');assert.equal(calls,2);
 const falseClaim=await superviseReply(state,{...input,reply:'已保存你的答案。',checkpoint:'complete'},provider,undefined,request);assert.equal(falseClaim.decision,'pause');assert.equal(calls,2);assert.equal(currentWorkflow(state)!.params.answers,undefined);assert.equal(JSON.stringify(state),before);
});

test('an accepted AA clarification dismisses a false alarm without a cue, cancellation, or correction budget',async()=>{
 let pauses=0,reviews=0;const tracker=new SupervisionTracker();
 const h=harness({supervisionTracker:tracker,onSuperviseReply:async()=>({decision:'pause',message:'AA尚未发起',evidence:'no task'}),onSupervisionPause:async()=>{pauses++;},onReconcileReply:async input=>{reviews++;assert.equal(input.contentOnly,true);return {decision:'accept',facts:{revision:0},message:'需要总额与参与者，追问正常。'};}});
 h.q.userText('AA收款');await h.q.handle({type:'response.created',response:{id:'aa'}});
 await h.q.handle({type:'response.audio_transcript.delta',response_id:'aa',item_id:'m',delta:'请告诉我总金额以及都有哪些人参加？'});await tick();
 assert.equal(reviews,1);assert.equal(pauses,0);assert.equal(h.q.outputAllowed,true);assert.equal(h.sent.filter(e=>e.type==='response.cancel').length,0);
 assert.equal(h.q.diagnostic('test').phase.repairAttempt,0);assert.equal(tracker.status().openIssues,0);h.q.stop();
});

test('unavailable revalidation and a late verdict after user interruption never cancel foreground speech',async()=>{
 const wait=deferred<SpeechVerdict>();let reviews=0,signal:AbortSignal|undefined;
 const h=harness({onSuperviseReply:async()=>({decision:'pause',message:'suspect',evidence:'state'}),onReconcileReply:async input=>{signal=input.signal;reviews++;if(reviews===1)throw new Error('offline');return wait.promise;}});
 h.q.userText('查询余额');await speaking(h);await tick();assert.equal(h.q.outputAllowed,true);assert.equal(h.sent.filter(e=>e.type==='response.cancel').length,0);
 await h.q.handle({type:'response.audio_transcript.delta',response_id:'r1',item_id:'r1-m',delta:'余额还有别的说明。'});await tick();assert.equal(reviews,2);
 h.q.userText('先解释一下利息');assert.equal(signal!.aborted,true);await speaking(h,'new');
 wait.resolve({decision:'repair',facts:{revision:1},repairScope:'content'});await tick();assert.equal(h.q.outputAllowed,true);h.q.stop();
});

test('a foreground tool cancels an in-flight content check and resumes from its own result',async()=>{
 const wait=deferred<SpeechVerdict>();let signal:AbortSignal|undefined,tools=0;
 const h=harness({onSuperviseReply:async()=>({decision:'pause',message:'suspect',evidence:'state'}),onReconcileReply:async input=>{signal=input.signal;return wait.promise;},onTool:async()=>{tools++;return {status:'collecting'};}});
 h.q.userText('AA收款');await speaking(h);await tick();
 await h.q.handle({type:'response.function_call_arguments.done',response_id:'r1',name:'bank_delegate',call_id:'c',arguments:'{}'});await tick();
 assert.equal(signal!.aborted,true);assert.equal(tools,1);wait.resolve({decision:'repair',facts:{revision:0}});await tick();
 assert.equal(h.sent.filter(e=>e.type==='response.cancel').length,0);assert.equal(h.sent.filter(e=>e.item?.type==='function_call_output').length,1);h.q.stop();
});

test('an observer cannot interrupt based on an absent or fabricated spoken claim',async()=>{
 for(const claimQuote of [undefined,'','转账已经完成']){
  const result=await superviseReply(initialState(),{...review,reply:'请问总金额和参与者分别是什么？'},provider,undefined,(async()=>Response.json({choices:[{message:{content:JSON.stringify({decision:'pause',claimQuote,message:'业务没完成',evidence:'no_call'})}}]})) as typeof fetch);
  assert.equal(result.decision,'continue');assert.equal(result.unavailableReason,'missing_spoken_claim');
 }
});

test('content-only revalidation accepts clarification and never turns a cancellation request into an action',async()=>{
 const state=reduceBank(initialState(),{type:'workflow',command:{source:'card',operation:'run',functionId:'TR05',params:{action:'create'}}},crypto.randomUUID());
 const before=JSON.stringify(state),task=currentWorkflow(state)!;
 const result=await reviewReply(state,{...review,utterance:'取消这份草稿',targetTaskId:task.id,contentOnly:true,reply:'请问是要取消当前这份草稿吗？'},provider,undefined,(async()=>Response.json({choices:[{message:{content:'{"decision":"accept","reason":"没有声称已经取消","claimQuote":""}'}}]})) as typeof fetch);
 assert.equal(result.decision,'accept');assert.equal(result.action,undefined);assert.equal(JSON.stringify(state),before);
});

test('content-only corrections require a real quote and cannot return an execution proposal',async()=>{
 const state=initialState(),input={...review,contentOnly:true,reply:'五百元已转出。'};
 const run=(value:unknown)=>reviewReply(state,input,provider,undefined,(async()=>Response.json({choices:[{message:{content:JSON.stringify(value)}}]})) as typeof fetch);
 const result=await run({decision:'repair',reason:'实际尚未转出',claimQuote:'五百元已转出'});assert.equal(result.repairScope,'content');assert.equal(result.action,undefined);
 await assert.rejects(run({decision:'repair',reason:'实际尚未转出',claimQuote:'不存在的声明'}));
 await assert.rejects(run({decision:'repair',reason:'需要取消',claimQuote:'五百元已转出',action:{operation:'cancel'}}));
});

test('accepting a clarification does not exempt a later false claim in the same response',async()=>{
 let reviews=0,pauses=0;
 const h=harness({onSuperviseReply:async()=>({decision:'pause',message:'suspect',evidence:'state'}),onReconcileReply:async()=>({decision:++reviews===1?'accept':'repair',facts:{revision:1},repairScope:'content'}),onSupervisionPause:async()=>{pauses++;}});
 h.q.userText('转账');await speaking(h);await tick();assert.equal(pauses,0);
 await h.q.handle({type:'response.audio_transcript.delta',response_id:'r1',item_id:'r1-m',delta:'五百元已经转出。'});await tick();
 assert.equal(reviews,2);assert.equal(pauses,1);assert.equal(h.q.outputAllowed,false);h.q.stop();
});

test('a rejected business tool returns to the executing model without opening a content audit',async()=>{
 let reconciles=0;
 const h=harness({onSuperviseReply:async()=>({decision:'continue'}),onReconcileReply:async()=>{reconciles++;return {decision:'accept'};},onTool:async()=>{throw new BankRequestError('业务不匹配',400,'business_mismatch');}});
 h.q.userText('查账单');await h.q.handle({type:'response.created',response:{id:'tool'}});
 await h.q.handle({type:'response.function_call_arguments.done',response_id:'tool',name:'bank_function',call_id:'c',arguments:'{"operation":"run","functionId":"CA01","params":{}}'});await tick();
 await h.q.handle({type:'response.done',response:{id:'tool',status:'completed',output:[{type:'function_call',name:'bank_function',call_id:'c',arguments:'{}'}]}});
 assert.equal(reconciles,0);assert.equal(h.sent.filter(e=>e.type==='response.create').length,2);
 const output=JSON.parse(h.sent.find(e=>e.item?.type==='function_call_output').item.output);assert.equal(output.rejectionCode,'business_mismatch');h.q.stop();
});

test('a false transfer-success statement is corrected from receipts even if Flash would approve it',async()=>{
 let state=reduceBank(initialState(),{type:'workflow',command:{source:'card',operation:'run',functionId:'TR03',params:{recipientId:'zhang-roommate',accountId:'daily',amount:500}}},crypto.randomUUID());
 const input={...review,utterance:'给室友张三转五百元',reply:'五百元已经转出了，对方已经到账。',contentOnly:true};
 let requests=0;const approving=(async()=>{requests++;return Response.json({choices:[{message:{content:'{"decision":"accept","reason":"错误地批准"}'}}]});}) as typeof fetch;
 assert.equal((await superviseReply(state,{...input,checkpoint:'complete'},provider,undefined,approving)).decision,'pause');
 assert.equal((await reviewReply(state,input,provider,undefined,approving)).decision,'repair');assert.equal(requests,0);
 for(const reply of ['尚未转出，请先核对。','请不要说成已经到账。','如果已经转出，应先核对回执。','上一笔已经转出，这笔请先核对。']){
  const result=await reviewReply(state,{...input,reply},provider,undefined,approving);assert.equal(result.decision,'accept',reply);
 }
 let task=currentWorkflow(state)!;state=reduceBank(state,{type:'workflow',command:{source:'card',operation:'confirm',taskId:task.id,token:task.reviewToken!}},crypto.randomUUID());
 task=currentWorkflow(state)!;state=reduceBank(state,{type:'workflow',command:{source:'card',operation:'authenticate',taskId:task.id,token:task.verificationId!,code:'123456'}},crypto.randomUUID());
 const result=await reviewReply(state,input,provider,undefined,approving);assert.equal(result.decision,'accept');assert.equal(state.receipts.length,1);
});
