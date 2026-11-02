import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,reduceBank} from '../lib/bank/engine.ts';
import {currentWorkflow} from '../lib/workflows/engine.ts';
import {workflowToolResult} from '../lib/workflows/realtime.ts';
import {answerPatch,RISK_QUESTIONS} from '../lib/workflows/questionnaire.ts';
import {recoveryAction,recoverDraft} from '../lib/workflows/recovery.ts';
import {QwenConversation,VOICE_INSTRUCTIONS} from '../lib/voice/qwen-protocol.ts';
import type {BankState} from '../lib/bank/types.ts';
import {businessProgress} from '../lib/voice/progress.ts';
import {explicitLiveCommand} from '../lib/workflows/offline.ts';
const act=(s:BankState,c:any,text='开始做风险测评',source='voice')=>reduceBank(s,{type:'workflow',command:{...c,source,utterance:text}},crypto.randomUUID());
const start=()=>act(initialState(),{operation:'run',functionId:'IN05'});
const fill=(s:BankState,text:string)=>({operation:'amend',taskId:currentWorkflow(s)!.id,params:{answers:answerPatch(text,currentWorkflow(s)!.params.answers)}});
const input=(text:string)=>({utterance:text,reason:'no_call' as const,turnId:crypto.randomUUID()});

test('checklist has independent question slots and saves each answer across reload and a side query',()=>{
 let s=start();const id=currentWorkflow(s)!.id;
 for(const [text,expected]of [['第一题选三',[3,0,0]],['第二题选二',[3,2,0]],['第三题选一',[3,2,1]]] as const){
  const command=fill(s,text)!;assert.equal(command.operation,'amend');s=act(s,command,text);
  assert.deepEqual(currentWorkflow(s)!.params.answers,expected);s=JSON.parse(JSON.stringify(s));
 }
 assert.equal(currentWorkflow(s)!.id,id);assert.equal(currentWorkflow(s)!.status,'review');assert.equal(s.workflows!.riskProfile,null);
 assert.equal(explicitLiveCommand(s,'确认当前信息'),undefined,'assessment confirmation must return through native voice tooling');
 assert.equal(s.workflows!.records.questionnaires.length,0);
 const old=currentWorkflow(s)!.reviewToken;
 s=act(s,{operation:'amend',taskId:id,params:{answers:[2,2,1]}},'第一题改成二');assert.notEqual(currentWorkflow(s)!.reviewToken,old);
 s=act(s,{operation:'run',functionId:'IN06'},'查询理财产品');s=act(s,{operation:'resume',taskId:id});
 assert.equal(currentWorkflow(s)!.id,id);assert.deepEqual(currentWorkflow(s)!.params.answers,[2,2,1]);
});
test('card labels and model questions share all fifteen options and the next unanswered question',()=>{
 let s=start();let c=workflowToolResult(s)!.checklist;
 assert.equal(c.questions!.length,3);assert.equal(c.nextQuestion!.title,RISK_QUESTIONS[0].title);
 assert.equal(c.questions!.flatMap(q=>q.choices).length,15);
 s=act(s,fill(s,'选3'),'选3');c=workflowToolResult(s)!.checklist;
 assert.equal(c.questions![0].value,3);assert.equal(c.nextQuestion!.index,2);
 assert.equal(currentWorkflow(s)!.fieldEvidence!['answers.0'].quote,'选3');
});
test('revision-only refreshes do not masquerade as a saved field',()=>{
 const s=start(),key=businessProgress(s),refreshed=act(s,{operation:'status',taskId:currentWorkflow(s)!.id});
 assert.ok(refreshed.revision>s.revision);assert.equal(businessProgress(refreshed),key);
 assert.notEqual(businessProgress(act(s,fill(s,'第一题选三'),'第一题选三')),key);
});
test('a record lookup reads state without collecting answers, and can resume an existing draft',()=>{
 let s=start();const id=currentWorkflow(s)!.id;s=act(s,fill(s,'第一题选三'),'第一题选三');
 s=act(s,{operation:'run',functionId:'IN05',params:{action:'status'}},'我有没有做过风险测评？');
 assert.equal(currentWorkflow(s)!.status,'complete');assert.equal((currentWorkflow(s)!.result as any).assessmentState,'not_found');
 s=act(s,{operation:'resume',taskId:id});assert.equal(currentWorkflow(s)!.id,id);assert.deepEqual(currentWorkflow(s)!.params.answers,[3,0,0]);
});
test('recovering a hidden questionnaire selects its original task without resetting saved answers',()=>{
 let s=start();const id=currentWorkflow(s)!.id;s=act(s,fill(s,'第一题选三'),'第一题选三');
 s=reduceBank(s,{type:'home'},crypto.randomUUID());s=act(s,{operation:'status',taskId:id},'我看不到选项啊');
 assert.equal(s.view,'workflow');assert.equal(currentWorkflow(s)!.id,id);assert.deepEqual(currentWorkflow(s)!.params.answers,[3,0,0]);
});
test('amounts, dates, negations and invented or cleared answers do not become questionnaire selections',()=>{
 for(const text of ['我有500元','2026-10-26','不要选三','第一题不选三','第一题选三还是四']){
  assert.equal(answerPatch(text,[]),undefined,text);
 }
 const s=start();
 // Use the same task ID for evidence checks.
 const id=currentWorkflow(s)!.id;
 assert.throws(()=>act(s,{operation:'amend',taskId:id,params:{answers:[5,5,5]}},'我有500元想买基金'));
 let p=act(s,{operation:'amend',taskId:id,params:{answers:[3,0,0]}},'第一题选三');
 assert.throws(()=>act(p,{operation:'amend',taskId:id,params:{answers:[0,2,0]}},'第二题选二'));
 assert.throws(()=>act(p,{operation:'amend',taskId:id,params:{answers:[3,6,0]}},'第二题选六'));
});
test('exact option text is grounded without mistaking its leading Chinese numeral for a selection number',()=>{
 assert.deepEqual(answerPatch('第一题选一年内',[]),[3,0,0]);
 assert.deepEqual(answerPatch('我选一个月内',[]),[1,0,0]);
 assert.deepEqual(answerPatch('我不接受波动',[3,0,0]),[3,1,0]);
 assert.deepEqual(answerPatch('第一题选第三项',[]),[3,0,0]);
 assert.equal(answerPatch('第一题选一年以内还是三年以内',[]),undefined);
});
test('generic checklist exposes required, filled and optional transfer fields without changing execution authorization',()=>{
 const s=act(initialState(),{operation:'run',functionId:'TR03',params:{}},'我要转账');
 const c=workflowToolResult(s)!.checklist;assert.equal(c.fields.find(f=>f.key==='amount')!.status,'missing');
 assert.equal(c.fields.find(f=>f.key==='note')!.status,'optional');assert.equal(s.receipts.length,0);
});
test('Flash can repair a grounded draft but cannot confirm, authenticate, overwrite prior answers or create duplicates',()=>{
 const s=start(),id=currentWorkflow(s)!.id;
 const a=recoveryAction(s,input('第一题选三'),{operation:'amend',taskId:id,params:{answers:[3,0,0]}})!;
 const updated=reduceBank(s,a,crypto.randomUUID());assert.equal(currentWorkflow(updated)!.status,'collecting');
 assert.throws(()=>recoveryAction(s,input('确认'),{operation:'confirm',taskId:id}));
 assert.throws(()=>recoveryAction(s,input('123456'),{operation:'authenticate',taskId:id}));
 assert.throws(()=>recoveryAction(s,input('开始做风险测评'),{operation:'run',functionId:'IN05'}));
 assert.throws(()=>recoveryAction(s,input('查一下测评记录'),{operation:'amend',taskId:id,params:{action:'status'}}));
 assert.throws(()=>recoveryAction(updated,input('第二题选二'),{operation:'amend',taskId:id,params:{answers:[5,2,0]}}));
 assert.throws(()=>recoveryAction(s,input('第一题选三'),{operation:'amend',taskId:'missing',params:{answers:[3,0,0]}}));
 assert.equal(recoveryAction(s,input('你好'),{operation:'none'}),undefined);
});
test('Flash receives task facts and uses JSON mode; provider failure or malformed output never changes state',async()=>{
 const s=start(),before=JSON.stringify(s),id=currentWorkflow(s)!.id;let body:any;
 const request=async(_url:any,init:any)=>{body=JSON.parse(init.body);return Response.json({choices:[{message:{content:JSON.stringify({operation:'amend',taskId:id,params:{answers:[3,0,0]}})}}]});};
 assert.ok(await recoverDraft(s,input('第一题选三'),{base:'https://example.invalid',key:'test',planner:'qwen-flash'},undefined,request as any));
 assert.equal(body.response_format.type,'json_object');assert.equal(JSON.parse(body.messages[1].content).facts.current.questions.length,3);
 await assert.rejects(()=>recoverDraft(s,input('第一题选三'),{base:'x',planner:'x'},undefined,async()=>new Response('',{status:503})));
 await assert.rejects(()=>recoverDraft(s,input('第一题选三'),{base:'x',planner:'x'},undefined,async()=>Response.json({choices:[{message:{content:'not JSON'}}]})));
 assert.equal(JSON.stringify(s),before);
});
test('speech-only turn invokes bounded recovery once, and interruption discards a late recovery',async()=>{
 const sent:any[]=[],seen:any[]=[];let finish:(x:unknown)=>void=()=>{};
 const q=new QwenConversation((type,extra)=>sent.push({type,...extra}),{onTranscript:()=>{},onInterrupt:()=>{},onTool:async()=>({}),onTurnComplete:c=>{seen.push(c);return new Promise(r=>{finish=r;});}});
 q.userText('第一题选三');await q.handle({type:'response.created',response:{id:'r'}});await q.handle({type:'response.done',response:{id:'r',output:[{type:'message'}]}});
 assert.equal(seen.length,1);q.userText('先等等');finish({reply:'late recovery'});await new Promise(r=>setTimeout(r,0));
 assert.equal(seen[0].signal.aborted,true);assert.ok(!JSON.stringify(sent).includes('late recovery'));q.stop();
});
test('initial prompt stays compact and delegates business details to the task checklist',()=>{
 assert.ok(VOICE_INSTRUCTIONS.length<1600);assert.match(VOICE_INSTRUCTIONS,/Checklist/);
});
test('fact refresh never truncates the outer plan or questionnaire into invalid JSON',async()=>{
 const sent:any[]=[];const q=new QwenConversation((type,extra)=>sent.push({type,...extra}),{onTranscript:()=>{},onInterrupt:()=>{},onTool:async()=>({})});
 const facts={workflow:{checklist:{questions:RISK_QUESTIONS},result:'演示'.repeat(4000)},plan:{id:'saved-plan',savedPlans:[{id:'original-plan'}]}};
 q.contextUpdate(JSON.stringify(facts));const instructions=sent.at(-1).session.instructions;
 assert.ok(instructions.endsWith(JSON.stringify(facts)));assert.match(instructions,/original-plan/);q.stop();
});
