import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,reduceBank} from '../lib/bank/engine.ts';
import {dispatchAction} from '../lib/plans/dispatch.ts';
import {ContextBudget,compactVoiceResult,sessionContextFacts} from '../lib/voice/session-context.ts';
import {VoiceTrace} from '../lib/voice/diagnostics.ts';
import {QwenConversation} from '../lib/voice/qwen-protocol.ts';
import {currentWorkflow} from '../lib/workflows/engine.ts';
import {operationToolResult} from '../lib/bank/tool-result.ts';
import type {BankState,BankAction} from '../lib/bank/types.ts';
const apply=(s:BankState,a:BankAction)=>reduceBank(s,dispatchAction(s,a),crypto.randomUUID());
test('context usage is the latest input window, not the sum of billed historical inputs',()=>{
 const budget=new ContextBudget({inputTokens:100,turns:3,ageMs:1000},0);
 budget.turn('a');budget.turn('a');budget.usage({input_tokens:60});budget.usage({input_tokens:70});assert.equal(budget.reason(500),undefined);assert.equal(budget.snapshot(500).turns,1);
 budget.usage({input_tokens:101});assert.equal(budget.reason(500),'input_tokens');budget.usage({input_tokens:50});assert.equal(budget.reason(500),undefined);assert.equal(budget.snapshot(500).peakInputTokens,101);
 budget.turn('b');budget.turn('c');assert.equal(budget.reason(500),'turns');assert.equal(new ContextBudget({inputTokens:100,turns:3,ageMs:1000},0).reason(1001),'age');
});
test('compaction keeps all 55 catalog entries and the exact operation receipt while removing duplicate copies',()=>{
 let s=apply(initialState(),{type:'plan',command:{operation:'create',source:'voice',utterance:'先做风险测评，然后查询订阅清单。'}}),before=s;
 s=apply(s,{type:'workflow',command:{operation:'list',source:'voice',utterance:'查看功能目录'}});
 const receipt=operationToolResult(before,s,{name:'bank_function',arguments:{operation:'list'}}),copy=structuredClone(receipt),compact=compactVoiceResult(receipt);
 assert.equal((compact.operationResult.workflow!.result as any[]).length,55);assert.deepEqual(compact.operationResult,receipt.operationResult);assert.deepEqual(receipt,copy);
 const duplicated={workflow:{taskId:'a',result:[1,2]},operationResult:{workflow:{taskId:'a',result:[1,2]}},plan:{completedResults:[{taskId:'a',result:[1,2]}]}};
 assert.equal((compactVoiceResult(duplicated).workflow as any).result,undefined);assert.deepEqual(compactVoiceResult(duplicated).operationResult.workflow.result,[1,2]);
});
test('handoff preserves pending task identities, answers and yuan parameters without restoring authorization from prose',()=>{
 let s=apply(initialState(),{type:'plan',command:{operation:'create',source:'voice',utterance:'先做风险测评，然后创建储蓄目标，名称读书计划，目标2500元，截止2027-06-01，不要自动存钱。'}});
 const id=currentWorkflow(s)!.id;s=apply(s,{type:'workflow',command:{operation:'amend',taskId:id,params:{answers:[3,0,0]},source:'voice',utterance:'第一题选三'}});
 const facts=sessionContextFacts(s),tasks=facts.handoff.pendingTasks!;assert.deepEqual(tasks.find(t=>t.taskId===id)!.params.answers,[3,0,0]);assert.equal(tasks.find(t=>t.functionId==='IN01')!.params.target,2500);assert.match(facts.handoff.authority,/不是用户本轮授权/);
 assert.equal(facts.explanationReference.products!.find(p=>p.id==='fund-bond')!.risk,3);assert.match(facts.explanationReference.authority,/不代表本轮已执行查询/);
 assert.deepEqual(tasks.map(t=>t.taskId),s.workflows!.tasks.filter(t=>['queued','collecting','review','authenticate','blocked'].includes(t.status)).map(t=>t.id));assert.equal(s.workflows!.records.questionnaires.length,0);
});
test('planned renewal intercepts the next input only at an idle boundary and never resends a completed tool',async()=>{
 const events:any[]=[],renewals:any[]=[];let q:QwenConversation;
 q=new QwenConversation((type,extra)=>events.push({type,...extra}),{contextLimits:{inputTokens:100,turns:1,ageMs:60000},onTranscript:()=>{},onInterrupt:()=>{},onTool:async()=>({}),onContextRenewal:c=>{renewals.push(c);q.stop();}});
 q.userText('解释');await q.handle({type:'response.created',response:{id:'r'}});await q.handle({type:'response.done',response:{id:'r',output:[{type:'message'}]}});
 q.userText('第二题选二');assert.equal(renewals.length,1);assert.equal(renewals[0].utterance,'第二题选二');assert.equal(renewals[0].reason,'turns');assert.equal(events.filter(e=>e.item?.role==='user').length,1);
});
test('an ASR turn with a tool already pending defers planned renewal rather than replaying that operation',async()=>{
 let rotations=0,tools=0,done!:()=>void;const called=new Promise<void>(resolve=>done=resolve);
 const q=new QwenConversation(()=>{},{contextLimits:{inputTokens:1,turns:1,ageMs:1},onTranscript:()=>{},onInterrupt:()=>{},onTool:async()=>{tools++;done();return {};},onContextRenewal:()=>rotations++});
 await q.handle({type:'input_audio_buffer.speech_started',item_id:'human'});await q.handle({type:'input_audio_buffer.speech_stopped',item_id:'human'});await q.handle({type:'response.created',response:{id:'r'}});
 await q.handle({type:'response.function_call_arguments.done',name:'bank_function',call_id:'c',arguments:'{"operation":"run","functionId":"CA01"}'});await q.handle({type:'conversation.item.input_audio_transcription.completed',item_id:'human',transcript:'查询银行卡'});await called;assert.equal(rotations,0);assert.equal(tools,1);q.stop();
});
test('an ASR turn can cross the renewal boundary before any tool has started',async()=>{
 const rotations:any[]=[];let tools=0;let q:QwenConversation;
 q=new QwenConversation(()=>{},{contextLimits:{inputTokens:1,turns:1,ageMs:1},onTranscript:()=>{},onInterrupt:()=>{},onTool:async()=>{tools++;return {};},onContextRenewal:c=>{rotations.push(c);q.stop();}});
 await q.handle({type:'input_audio_buffer.speech_started',item_id:'human'});await q.handle({type:'input_audio_buffer.speech_stopped',item_id:'human'});await q.handle({type:'conversation.item.input_audio_transcription.completed',item_id:'human',transcript:'第二题选二'});
 assert.equal(rotations.length,1);assert.equal(rotations[0].source,'audio');assert.equal(rotations[0].utterance,'第二题选二');assert.equal(tools,0);
});
test('diagnostics retain provider stages and context usage without storing user text, output or tokens',()=>{
 const trace=new VoiceTrace();trace.record('out',{type:'conversation.item.create',item:{role:'user',content:[{text:'secret user text'}],output:'secret confirmationToken'}});trace.record('in',{type:'error',error:{message:'Receive batching backend response failed!'}});trace.record('in',{type:'response.done',response:{id:'response-a',status:'completed',usage:{input_tokens:58151,output_tokens:79}}});
 const data=trace.snapshot('test'),text=JSON.stringify(data);assert.ok(!text.includes('secret'));assert.equal(data.events[1].code,'provider_batching_failure');assert.equal(data.events[2].inputTokens,58151);
});
