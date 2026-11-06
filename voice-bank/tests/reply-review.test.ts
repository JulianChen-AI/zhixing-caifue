import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {initialState,reduceBank,BankError} from '../lib/bank/engine.ts';
import { scriptedLedger } from '../lib/demo/dataset.ts';
import {dispatchAction} from '../lib/plans/dispatch.ts';
import {operationToolResult} from '../lib/bank/tool-result.ts';
import {currentWorkflow} from '../lib/workflows/engine.ts';
import {reviewReply,type ReplyReviewInput} from '../lib/voice/reply-review.ts';
import {QwenConversation,type ConversationCallbacks, type SpeechVerdict} from '../lib/voice/qwen-protocol.ts';
import type {BankState,BankAction} from '../lib/bank/types.ts';
import {VerifiedAudio} from '../lib/voice/verified-audio.ts';
import {BankRequestError} from '../lib/bank/request-error.ts';
import {explicitWorkflowConfirmation,explicitLiveCommand,explicitWorkflowCancellation} from '../lib/workflows/offline.ts';
import {inferFunction} from '../lib/plans/decompose.ts';
import {queryReviewFacts,queryReplyIssue} from '../lib/voice/query-review.ts';
import {superviseReply} from '../lib/voice/supervision.ts';
import {WorkflowError} from '../lib/workflows/types.ts';
const apply=(s:BankState,a:BankAction)=>reduceBank(s,dispatchAction(s,a),crypto.randomUUID());
const start=()=>apply(scriptedLedger(initialState()),{type:'plan',command:{operation:'create',source:'voice',utterance:'先做风险测评，然后查询订阅清单。'}});
const tick=()=>new Promise(r=>setTimeout(r,0));

test('catalog and definition receipts survive an active Plan without changing task focus or saved answers',()=>{
 let s=start();const id=currentWorkflow(s)!.id;
 s=apply(s,{type:'workflow',command:{operation:'amend',taskId:id,params:{answers:[3,0,0]},source:'voice',utterance:'第一题选三'}});
 for(const args of [{operation:'list' as const},{operation:'describe' as const,functionId:'BI01'}]){
  const before=s;s=apply(s,{type:'workflow',command:{...args,source:'voice',utterance:'查看功能定义'}});
  const out=operationToolResult(before,s,{name:'bank_function',arguments:args});
  assert.equal(currentWorkflow(s)!.id,id);assert.equal(s.plan!.currentTaskId,id);assert.deepEqual(currentWorkflow(s)!.params.answers,[3,0,0]);
  const receipt=out.operationResult.workflow!;
  if(args.operation==='list'){assert.equal((receipt.result as any[]).length,57);assert.ok((receipt.result as any[]).some(f=>f.id==='BI01'));}
  else {assert.ok((receipt.result as any).acceptedFields.includes('period'));assert.equal(receipt.functionId,'BI01');}
  assert.equal(out.workflow!.taskId,id);
  assert.deepEqual(operationToolResult(s,s,{name:'bank_function',arguments:args}).operationResult.workflow!.result,receipt.result,'deduplicated receipt retains directory');
 }
});

test('confirmation receipt stays attached to the executed task after the scheduler advances',()=>{
 let s=start();const id=currentWorkflow(s)!.id;
 s=apply(s,{type:'workflow',command:{operation:'amend',taskId:id,params:{answers:[3,2,1]},source:'voice',utterance:'三题答案是3、2、1'}});
 const args={operation:'confirm',taskId:id},before=s;
 s=apply(s,{type:'workflow',command:{operation:'confirm',taskId:id,token:currentWorkflow(s)!.reviewToken!,source:'voice',turnId:crypto.randomUUID(),utterance:'确认当前风险测评信息，请提交这份测评。'}});
 const out=operationToolResult(before,s,{name:'bank_function',arguments:args});
 assert.equal(out.operationResult.workflow!.taskId,id);assert.equal(out.operationResult.workflow!.status,'complete');assert.equal(out.operationResult.workflow!.effectCommitted,true);
 assert.equal(out.workflow!.functionId,'SU01');assert.equal(s.plan!.status,'complete');assert.equal(s.workflows!.records.questionnaires.length,1);
});

function harness(review:NonNullable<ConversationCallbacks['onReviewReply']>){
 const sent:any[]=[],heard:string[]=[],played:string[]=[],discarded:string[]=[];
 const q=new QwenConversation((type,extra)=>sent.push({type,...extra}),{onTranscript:(speaker,text)=>{if(speaker==='assistant')heard.push(text)},onInterrupt:()=>{},onTool:async()=>({}),onReviewReply:review,onReplyVerified:id=>played.push(id),onReplyDiscarded:id=>discarded.push(id)});
 return {q,sent,heard,played,discarded};
}
async function response(q:QwenConversation,id:string,text:string){
 await q.handle({type:'response.created',response:{id}});
 await q.handle({type:'response.audio_transcript.delta',response_id:id,item_id:id,delta:text});
 await q.handle({type:'response.done',response:{id,status:'completed',output:[{type:'message'}]}});
}
test('a premature saved claim is withheld, corrected once and only the verified replacement is released',async()=>{
 let release!:(v:SpeechVerdict)=>void;const seen:any[]=[];
 const h=harness(c=>{seen.push(c);return new Promise(r=>release=r)});h.q.userText('第三题选一');
 await response(h.q,'bad','已保存第三题。');assert.equal(h.q.outputAllowed,false);assert.ok(!h.heard.includes('已保存第三题。'));assert.equal(h.played.length,0);
 release({decision:'repair',facts:{answers:[3,2,1]},message:'已补存答案'});await tick();
 assert.deepEqual(h.discarded,['bad']);await h.q.handle({type:'session.updated'});
 await response(h.q,'corrected','第三题已保存，请核对。');assert.equal(seen[1].repairAttempt,1);
 release({decision:'accept'});await tick();assert.deepEqual(h.played,['corrected']);assert.ok(h.heard.includes('第三题已保存，请核对。'));h.q.stop();
});
test('user interruption aborts pending verification and never releases a late old reply',async()=>{
 let release!:(v:SpeechVerdict)=>void,signal:AbortSignal|undefined;
 const h=harness(c=>{signal=c.signal;return new Promise(r=>release=r)});h.q.userText('第一题选三');await response(h.q,'old','已保存。');
 h.q.userText('先等等');release({decision:'accept'});await tick();assert.equal(signal!.aborted,true);assert.equal(h.played.length,0);assert.ok(!h.heard.includes('已保存。'));h.q.stop();
});
test('unavailable verification fails closed and duplicate response.done cannot replay a verified reply',async()=>{
 const failed=harness(async()=>{throw new Error('provider unavailable')});failed.q.userText('第一题选三');await response(failed.q,'bad','已保存。');await tick();assert.equal(failed.played.length,0);assert.ok(!failed.heard.includes('已保存。'));failed.q.stop();
 let calls=0;const h=harness(async()=>{calls++;return {decision:'accept'}});h.q.userText('你好');await response(h.q,'ok','你好。');await tick();await h.q.handle({type:'response.done',response:{id:'ok',status:'completed',output:[{type:'message'}]}});await tick();assert.equal(calls,1);assert.deepEqual(h.played,['ok']);h.q.stop();
});

const input=(s:BankState):ReplyReviewInput=>({utterance:'第一题选三',reason:'no_call',turnId:crypto.randomUUID(),reply:'第一题已保存。',startRevision:s.revision,repairAttempt:0});
const provider={base:'https://example.invalid',planner:'fake',key:'test'};
const fake=(value:unknown):typeof fetch=>async()=>Response.json({choices:[{message:{content:JSON.stringify(value)}}]});

test('literal cancellation repairs the original transfer draft without granting Flash cancellation authority',async()=>{
 let s=apply(initialState(),{type:'workflow',command:{operation:'run',functionId:'TR03',params:{amount:300,accountId:'daily',recipientId:'zhang-roommate'},source:'card'}});
 const task=currentWorkflow(s)!,before=structuredClone(s),never:typeof fetch=async()=>{throw new Error('literal cancellation must not call a model')};
 assert.equal(task.status,'review');
 for(const utterance of ['不转了。','这笔转账不转了','取消当前这笔转账','取消当前转账草稿','不转了，取消当前这笔转账']){
  const review={...input(s),utterance,targetTaskId:task.id,reply:'转账已取消。'};
  const observed=await superviseReply(s,{...review,checkpoint:'complete'},provider,undefined,never);
  assert.equal(observed.decision,'pause');assert.deepEqual(s,before,'observation is read-only');
  const result=await reviewReply(s,review,provider,undefined,never);
  assert.equal(result.action?.type,'workflow');
  const saved=apply(s,result.action!);assert.equal(saved.workflows!.tasks.find(t=>t.id===task.id)!.status,'cancelled');
  assert.deepEqual(saved.accounts,before.accounts);assert.deepEqual(saved.receipts,before.receipts);
  assert.equal(explicitWorkflowCancellation(saved,utterance,task.id),undefined);
 }
 assert.equal((await reviewReply(s,{...input(s),utterance:'不转了',targetTaskId:task.id,repairAttempt:1},provider,undefined,never)).action,undefined);
 // Waiting for authentication is still unexecuted and can be withdrawn.
 s=apply(s,{type:'workflow',command:{operation:'confirm',taskId:task.id,token:task.reviewToken!,source:'card'}});
 assert.equal(currentWorkflow(s)!.status,'authenticate');assert.ok(explicitWorkflowCancellation(s,'不转了',task.id));
 s=apply(s,{type:'workflow',command:{operation:'authenticate',taskId:task.id,token:currentWorkflow(s)!.verificationId!,code:'123456',source:'card'}});
 assert.equal(s.workflows!.tasks.find(t=>t.id===task.id)!.status,'complete');assert.equal(explicitWorkflowCancellation(s,'不转了',task.id),undefined);
});

test('withdrawal cannot target a different card or be inferred from negation, questions or reviewer proposals',async()=>{
 const s=apply(initialState(),{type:'workflow',command:{operation:'run',functionId:'TR03',params:{amount:300,accountId:'daily',recipientId:'zhang-roommate'},source:'card'}}),id=currentWorkflow(s)!.id;
 for(const utterance of ['不要取消当前这笔转账','不转了？','为什么不转了','如果不转了','取消全部转账','取消另一笔转账','不转了，改成500元','不转了，先查余额'])assert.equal(explicitWorkflowCancellation(s,utterance,id),undefined,utterance);
 assert.equal(explicitWorkflowCancellation(s,'不转了',crypto.randomUUID()),undefined);
 for(const targetTaskId of [undefined,crypto.randomUUID()]){
  const result=await reviewReply(s,{...input(s),utterance:'不转了',targetTaskId},provider,undefined,fake({decision:'repair',repairType:'action',reason:'取消',action:{operation:'cancel',taskId:id}}));
  assert.equal(result.action,undefined,'a model-proposed cancel cannot bypass the literal bound-target path');
 }
});

test('review transport failures keep two deadlines and return explicit HTTP errors without swallowing cancellation',async t=>{
 // Execute the real pure mapper without importing its Cloudflare runtime bindings.
 const source=readFileSync(new URL('../lib/bank/server.ts',import.meta.url),'utf8'),marker='export function errorResponse';
 assert.equal(source.split(marker).length,2);
 const errorResponse=Function('BankError','WorkflowError',stripTypeScriptTypes(source.slice(source.indexOf(marker))).replace('export function','return function'))(BankError,WorkflowError) as (error:unknown)=>Response;
 const deadlines:number[]=[],timeout=AbortSignal.timeout.bind(AbortSignal);
 t.mock.method(AbortSignal,'timeout',(ms:number)=>{deadlines.push(ms);return timeout(ms);});
 const s=initialState(),before=JSON.stringify(s),review={...input(s),utterance:'你好',reply:'你好',reason:'completed' as const};
 for(const [failure,status,message]of [
  [new DOMException('simulated deadline','TimeoutError'),504,'复核超时，回复未播放，请查看业务卡片。'],
  [new TypeError('fetch failed'),502,'复核网络请求失败，回复未播放，请查看业务卡片。'],
  [new Error('Network connection lost.'),502,'复核网络请求失败，回复未播放，请查看业务卡片。'],
 ]as const){
  let calls=0,caught:unknown;
  await assert.rejects(reviewReply(s,review,provider,undefined,async()=>{calls++;throw failure;}),error=>{caught=error;return true;});
  assert.equal(calls,2);assert.deepEqual(deadlines.splice(0),[15000,8000]);
  const response=errorResponse(caught);assert.equal(response.status,status);assert.deepEqual(await response.json(),{error:message});
  assert.ok(caught instanceof WorkflowError);assert.equal(JSON.stringify(s),before);
 }
 for(const failure of [new Error('programming failure'),new TypeError('unexpected model object')]){
  let calls=0;
  await assert.rejects(reviewReply(s,review,provider,undefined,async()=>{calls++;throw failure;}),error=>error===failure);
  assert.equal(calls,2);assert.deepEqual(deadlines.splice(0),[15000,8000]);
 }
 const controller=new AbortController(),reason=new Error('user stopped');let calls=0;
 await assert.rejects(reviewReply(s,review,provider,controller.signal,async()=>{calls++;controller.abort(reason);throw new DOMException('simulated deadline','TimeoutError');}),error=>error===reason);
 assert.equal(calls,1);assert.deepEqual(deadlines,[15000]);assert.equal(JSON.stringify(s),before);
});

test('completed queries review only their own receipts, and reject wrong balance numbers even when Flash accepts',async()=>{
 let s=start();const original=currentWorkflow(s)!.id,startRevision=s.revision,utterance='看看我的两个账户余额，不转钱。';
 assert.equal(queryReviewFacts(s,utterance,startRevision),undefined);
 s=apply(s,{type:'workflow',command:{operation:'run',functionId:'TR02',params:{},source:'card'}});
 const before=structuredClone(s),requests:any[]=[],request:typeof fetch=async(_url,options)=>{requests.push(JSON.parse(String(options!.body)));return fake({decision:'accept',reason:'looks correct'})(_url,options);};
 const wrong=await reviewReply(s,{...input(s),utterance,startRevision,reply:'日常账户余额2600元，储蓄账户余额12000元。'},provider,undefined,request);
 assert.equal(wrong.decision,'repair');assert.equal(wrong.repairScope,'query');assert.equal(wrong.action,undefined);
 const data=JSON.parse(requests[0].messages[1].content);assert.equal(data.query.receipts[0].functionId,'TR02');assert.equal(data.facts,undefined);assert.equal(data.actual,undefined);
 for(const key of ['nextQuestion','confirmationRequest','acceptedParams','pendingTasks'])assert.ok(!JSON.stringify(data).includes(key));
 const correct=await reviewReply(s,{...input(s),utterance,startRevision,reply:'日常账户余额12,865元，储蓄账户余额3万元。'},provider,undefined,request);assert.equal(correct.decision,'accept');
 assert.deepEqual(s,before);assert.equal(s.workflows!.tasks.find(t=>t.id===original)!.status,'collecting');
 assert.equal(queryReviewFacts(s,utterance,s.revision),undefined,'an old read is not evidence of a new query');
});

test('task titles and next questions cannot substitute for actual card or spending results',()=>{
 let s=start();
 for(const [functionId,params,utterance,correct] of [
  ['CA01',{},'查看我的银行卡列表和当前状态。','日常借记卡状态正常，储蓄借记卡受限。'],
  ['BI02',{period:'2026-10',category:'餐饮'},'查2026年10月的餐饮支出，只查询。','餐饮支出64元，扣除12元退款后净支出52元。'],
 ] as const){const revision=s.revision;s=apply(s,{type:'workflow',command:{operation:'run',functionId,params:{...params},source:'card'}});const facts=queryReviewFacts(s,utterance,revision);assert.ok(facts);assert.ok(queryReplyIssue(facts,'查询已完成，请继续回答第二题。'));assert.equal(queryReplyIssue(facts,correct),undefined);}
});

test('a completed read cannot be redirected into a background draft by a reviewer action',async()=>{
 let s=start();const taskId=currentWorkflow(s)!.id,startRevision=s.revision,utterance='查看我的银行卡列表和当前状态。';s=apply(s,{type:'workflow',command:{operation:'run',functionId:'CA01',params:{},source:'card'}});
 const result=await reviewReply(s,{...input(s),utterance,startRevision,reply:'日常借记卡正常。'},provider,undefined,fake({decision:'repair',repairType:'action',reason:'还需恢复问卷',action:{operation:'resume',taskId}}));assert.equal(result.repairScope,'query');assert.equal(result.action,undefined);
});

test('a query repair uses a fresh read-only handoff with the original question',async()=>{
 const sent:any[]=[],handoffs:any[]=[],facts={originalRequest:'看看我的两个账户余额，不转钱。',startRevision:3,query:{receipts:[]}};
 const q=new QwenConversation((type,extra)=>sent.push({type,...extra}),{onTranscript:()=>{},onInterrupt:()=>{},onTool:async()=>({}),onReviewReply:async()=>({decision:'repair',repairScope:'query',facts,toolAttempted:true}),onHaltedRecovery:f=>handoffs.push(f)});
 q.userText(facts.originalRequest);await response(q,'bad-query','日常账户2600元。');await tick();assert.deepEqual(handoffs,[facts]);assert.equal(sent.filter(e=>e.type==='session.update').length,0);q.stop();
});
test('Flash review proposes one grounded repair, but cannot confirm, authenticate or overwrite unrelated saved fields',async()=>{
 let s=start();const id=currentWorkflow(s)!.id,before=JSON.stringify(s);
 const good=await reviewReply(s,input(s),provider,undefined,fake({decision:'repair',reason:'漏保存',action:{operation:'amend',taskId:id,params:{answers:[3,0,0]}}}));
 assert.equal(good.action!.type,'workflow');assert.equal(JSON.stringify(s),before);
 for(const operation of ['confirm','authenticate'])assert.equal((await reviewReply(s,input(s),provider,undefined,fake({decision:'repair',reason:'x',action:{operation,taskId:id}}))).decision,'reject');
 s=apply(s,good.action!);
 const bad=await reviewReply(s,{...input(s),utterance:'第二题选二'},provider,undefined,fake({decision:'repair',reason:'x',action:{operation:'amend',taskId:id,params:{answers:[5,2,0]}}}));assert.equal(bad.decision,'repair');assert.deepEqual(currentWorkflow(apply(s,bad.action!))!.params.answers,[3,2,0],'invalid model overwrite is replaced only by the independently grounded user delta');
 const bounded=await reviewReply(s,{...input(s),repairAttempt:1},provider,undefined,fake({decision:'repair',reason:'again',action:{operation:'amend',taskId:id,params:{answers:[3,0,0]}}}));assert.equal(bounded.decision,'reject');assert.equal(bounded.action,undefined);
});
test('a second model approval cannot turn an unchanged rejected operation into a success receipt',async()=>{
 const s=start();const v=await reviewReply(s,{...input(s),utterance:'提交当前信息',reason:'tool_error'},provider,undefined,fake({decision:'accept',reason:'models agree'}));assert.equal(v.decision,'reject');
 await assert.rejects(()=>reviewReply(s,input(s),provider,undefined,fake({decision:'invented',reason:'bad'})));
});
test('Flash cannot accept an unsaved explicit answer even when both models claim it is saved',async()=>{
 const s=start(),before=JSON.stringify(s),v=await reviewReply(s,input(s),provider,undefined,fake({decision:'accept',reason:'已保存第一题'}));
 assert.equal(v.decision,'repair');assert.equal(v.action!.type,'workflow');
 const saved=apply(s,v.action!);assert.deepEqual(currentWorkflow(saved)!.params.answers,[3,0,0]);assert.equal(JSON.stringify(s),before);
});
test('completed record lookup cannot satisfy starting a new assessment, and a negated start cannot allocate a questionnaire',async()=>{
 let s=apply(initialState(),{type:'workflow',command:{operation:'run',functionId:'IN05',params:{action:'status'},source:'voice',utterance:'我有没有做过风险测评？'}});
 const approved=fake({decision:'accept',reason:'complete'});
 const v=await reviewReply(s,{...input(s),utterance:'好，开始做风险测评'},provider,undefined,approved);assert.equal(v.decision,'repair');
 s=apply(s,v.action!);assert.equal(currentWorkflow(s)!.status,'collecting');assert.notEqual(currentWorkflow(s)!.params.action,'status');
 const no=await reviewReply(initialState(),{...input(initialState()),utterance:'不要开始风险测评'},provider,undefined,approved);assert.equal(no.action,undefined);
});
test('an action omission identified by the reviewer gets one separate grounded proposal instead of only rewording a promise',async()=>{
 const s=start(),id=currentWorkflow(s)!.id;let calls=0;
 const request:typeof fetch=async()=>{calls++;return Response.json({choices:[{message:{content:JSON.stringify(calls===1?{decision:'repair',repairType:'action',reason:'漏更新'}:{operation:'resume',taskId:id})}}]});};
 const v=await reviewReply(s,{...input(s),utterance:'继续原来的风险测评，不要创建新问卷。'},provider,undefined,request);
 assert.equal(v.decision,'repair');assert.ok(v.action);assert.equal(s.workflows!.records.questionnaires.length,0);
 // The unique-task resume fast path can resolve without a second model inference.
 assert.ok(calls<=2);
});
test('a wrong-business rejection allows a different function instead of pinning the incorrect one',async()=>{
 const sent:any[]=[];const q=new QwenConversation((type,extra)=>sent.push({type,...extra}),{onTranscript:()=>{},onInterrupt:()=>{},onTool:async()=>{throw new BankRequestError('所选业务与本轮要求不一致',400,'business_mismatch')}});
 q.userText('查2026年10月的餐饮支出，只查询。');await q.handle({type:'response.function_call_arguments.done',name:'bank_function',call_id:'wrong',arguments:JSON.stringify({operation:'run',functionId:'IN08',params:{period:'2026-10'}})});await tick();
 const result=JSON.parse(sent.find(e=>e.item?.type==='function_call_output').item.output);assert.equal(result.rejectionCode,'business_mismatch');assert.match(result.instruction,/改用正确/);assert.ok(!result.instruction.includes('保持原functionId=IN08'));q.stop();
});
test('missing read calls and rejected model field names use canonical user fields without replacing an assessment',async()=>{
 const s=start();const approved=fake({decision:'accept',reason:'cached cards are sufficient'});
 const cards=await reviewReply(s,{...input(s),utterance:'我有哪些银行卡？请显示列表。'},provider,undefined,approved);assert.equal(cards.decision,'repair');assert.equal((cards.action as any).command.functionId,'CA01');
 const read=await reviewReply(s,{...input(s),utterance:'查一下有没有已经完成的风险测评记录，不提交正在填写的问卷。'},provider,undefined,approved);assert.equal(read.decision,'repair');assert.equal((read.action as any).command.params.action,'status');
 const expenses=await reviewReply(s,{...input(s),reason:'tool_error',utterance:'查2026年10月的餐饮支出，只查询。'},provider,undefined,fake({decision:'repair',repairType:'action',reason:'wrong business',action:{operation:'run',functionId:'BI01',params:{dateRange:'2026-10'}}}));
 assert.equal(expenses.decision,'repair');assert.deepEqual((expenses.action as any).command.params,{period:'2026-10',category:'餐饮'});assert.ok(['BI01','BI02'].includes((expenses.action as any).command.functionId));assert.equal(s.workflows!.records.questionnaires.length,0);
});
test('a missing goal draft is created from explicit fields and a later amendment preserves its other fields',async()=>{
 let s=start();const v=await reviewReply(s,{...input(s),utterance:'创建一个储蓄目标，名称读书计划，目标2000元，截止2027-06-01，不要自动存钱。先给我看草稿，不确认。'},provider,undefined,fake({decision:'repair',repairType:'action',reason:'missing task'}));
 assert.ok(v.action);s=apply(s,v.action!);const id=currentWorkflow(s)!.id;assert.equal(currentWorkflow(s)!.functionId,'IN01');assert.equal(currentWorkflow(s)!.params.target,2000);
 const updated=await reviewReply(s,{...input(s),utterance:'把刚才读书计划的目标改成2500元，其他信息保留，仍然不要提交。'},provider,undefined,fake({decision:'accept',reason:'both models falsely say saved'}));
 s=apply(s,updated.action!);assert.equal(currentWorkflow(s)!.id,id);assert.equal(currentWorkflow(s)!.params.target,2500);assert.equal(currentWorkflow(s)!.params.name,'读书计划');assert.equal(currentWorkflow(s)!.params.deadline,'2027-06-01');assert.equal(currentWorkflow(s)!.status,'review');assert.equal(s.workflows!.records.goals.some(g=>g.name==='读书计划'),false);
});
test('a model interrupt for an explicit goal correction updates the original task instead of allocating a second draft',()=>{
 let s=apply(initialState(),{type:'plan',command:{operation:'create',source:'voice',utterance:'创建一个储蓄目标，名称读书计划，目标2000元，截止2027-06-01，不要自动存钱。'}});
 const id=currentWorkflow(s)!.id,count=s.workflows!.tasks.length,token=currentWorkflow(s)!.reviewToken;
 s=apply(s,{type:'plan',command:{operation:'interrupt',source:'voice',utterance:'把刚才读书计划的目标改成2500元，其他信息保留，仍然不要提交。',tasks:[{quote:'把刚才读书计划的目标改成2500元，其他信息保留，仍然不要提交。',functionId:'IN01'}]}});
 assert.equal(currentWorkflow(s)!.id,id);assert.equal(s.workflows!.tasks.length,count);assert.equal(currentWorkflow(s)!.params.target,2500);assert.equal(currentWorkflow(s)!.params.name,'读书计划');assert.equal(currentWorkflow(s)!.params.deadline,'2027-06-01');assert.notEqual(currentWorkflow(s)!.reviewToken,token);assert.equal(s.workflows!.records.goals.some(g=>g.name==='读书计划'),false);
});
test('summary statistics cannot satisfy an explicit bill-details request through either native entry',()=>{
 const s=start(),text='先查询2026年10月账单明细，查完继续测评。';
 for(const action of [
  {type:'plan',command:{operation:'interrupt',functionId:'BI02',params:{period:'2026-10'},source:'voice',utterance:text}},
  {type:'workflow',command:{operation:'run',functionId:'BI02',params:{period:'2026-10'},source:'voice',utterance:text}},
 ] as BankAction[])assert.throws(()=>apply(s,action),/BI01账单明细/);
 const corrected=apply(s,{type:'plan',command:{operation:'interrupt',functionId:'BI01',params:{period:'2026-10'},source:'voice',utterance:text}});assert.ok(corrected.workflows!.tasks.some(t=>t.functionId==='BI01'&&t.status==='complete'));
});
test('an approving reviewer cannot claim the original questionnaire resumed while the goal still has focus',async()=>{
 let s=start();const assessment=currentWorkflow(s)!.id;
 s=apply(s,{type:'plan',command:{operation:'interrupt',functionId:'IN01',params:{name:'读书计划',target:2500,deadline:'2027-06-01',autoSave:false},source:'voice',utterance:'创建一个储蓄目标，名称读书计划，目标2500元，截止2027-06-01，不要自动存钱。'}});
 const v=await reviewReply(s,{...input(s),utterance:'继续原来的风险测评，不要创建新问卷。'},provider,undefined,fake({decision:'accept',reason:'already resumed'}));
 assert.equal(v.decision,'repair');s=apply(s,v.action!);assert.equal(currentWorkflow(s)!.id,assessment);assert.equal(s.workflows!.tasks.filter(t=>t.functionId==='IN05'&&t.params.action!=='status').length,1);
});
test('reading generic state does not prove an expense query executed, while a current-turn query receipt does',async()=>{
 let s=start();const startRevision=s.revision,utterance='查2026年10月的餐饮支出，只查询。',approved=fake({decision:'accept',reason:'already queried'});
 const missing=await reviewReply(s,{...input(s),utterance,startRevision,reason:'completed',attempts:[{name:'bank_request',operation:'get_state'}]},provider,undefined,approved);
 assert.equal(missing.decision,'repair');assert.ok(missing.action);s=apply(s,missing.action!);
 const falselyApproved=await reviewReply(start(),{...input(start()),utterance,startRevision:0,repairAttempt:1},provider,undefined,approved);assert.equal(falselyApproved.decision,'reject');assert.equal(falselyApproved.action,undefined);
 const verified=await reviewReply(s,{...input(s),utterance,startRevision,reason:'completed',repairAttempt:1,reply:'餐饮支出64元，退款12元，净支出52元。'},provider,undefined,approved);assert.equal(verified.decision,'accept');assert.equal(verified.action,undefined);
});
test('a claimed freeze draft requires an actual Task while the card stays active and unauthenticated',async()=>{
 const s=start(),id=currentWorkflow(s)!.id,v=await reviewReply(s,{...input(s),utterance:'准备临时冻结日常借记卡的草稿，先展示卡片，不要确认或执行。'},provider,undefined,fake({decision:'accept',reason:'draft already displayed'}));
 assert.equal(v.decision,'repair');const saved=apply(s,v.action!);assert.equal(currentWorkflow(saved)!.functionId,'CA06');assert.equal(currentWorkflow(saved)!.status,'review');assert.equal(saved.workflows!.records.cards.find(c=>c.id==='card-daily')!.status,'active');assert.equal(saved.workflows!.tasks.find(t=>t.id===id)!.status,'collecting');
});
test('hitting the native tool limit still invokes one review and switches to a separate read-only receipt path',async()=>{
 const sent:any[]=[],receipts:any[]=[];let tools=0,reviews=0;
 const q=new QwenConversation((type,extra)=>sent.push({type,...extra}),{onTranscript:()=>{},onInterrupt:()=>{},onTool:async()=>{tools++;throw new BankRequestError('invalid parameter',400)},onReviewReply:async()=>{reviews++;return {decision:'repair',facts:{revision:3,operationResult:{message:'查询完成'}}}},onHaltedRecovery:facts=>receipts.push(facts)});
 q.userText('查餐饮支出');
 for(let i=0;i<7;i++){await q.handle({type:'response.created',response:{id:'r'+i}});await q.handle({type:'response.function_call_arguments.done',name:'bank_function',call_id:'c'+i,arguments:'{"operation":"run","functionId":"IN08"}'});await tick();await q.handle({type:'response.done',response:{id:'r'+i,output:[{type:'function_call',name:'bank_function',call_id:'c'+i,arguments:'{"operation":"run","functionId":"IN08"}'}]}});}
 await tick();assert.equal(tools,6);assert.equal(reviews,1);assert.equal(receipts.length,1);const cancelled=sent.findLastIndex(e=>e.type==='response.cancel');assert.ok(cancelled>=0);assert.ok(!sent.slice(cancelled+1).some(e=>e.type==='response.create'),'cancelled tool turn must not be continued');q.stop();
});
test('a definite business mismatch goes to review immediately instead of letting Omni repeat the wrong function',async()=>{
 let tools=0,reviews=0,handoffs=0;
 const q=new QwenConversation(()=>{},{onTranscript:()=>{},onInterrupt:()=>{},onTool:async()=>{tools++;throw new BankRequestError('wrong business',400,'business_mismatch')},onReviewReply:async()=>{reviews++;return {decision:'repair',facts:{revision:1}}},onHaltedRecovery:()=>{handoffs++;}});
 q.userText('查账单');await q.handle({type:'response.created',response:{id:'r'}});await q.handle({type:'response.function_call_arguments.done',name:'bank_function',call_id:'bad',arguments:'{"operation":"run","functionId":"IN08"}'});await tick();await tick();
 assert.equal(tools,1);assert.equal(reviews,1);assert.equal(handoffs,1);q.stop();
});
test('a missed assessment confirmation has a literal current-card fallback, without letting questions or amendments authorize it',()=>{
 let s=start();const id=currentWorkflow(s)!.id;s=apply(s,{type:'workflow',command:{operation:'amend',taskId:id,params:{answers:[3,2,1]},source:'voice',utterance:'三题答案是3、2、1'}});
 const text='确认当前风险测评信息，请提交这份测评。',confirmation=explicitWorkflowConfirmation(s,text)!;
 assert.equal(confirmation.taskId,id);assert.equal(confirmation.token,currentWorkflow(s)!.reviewToken);assert.equal(explicitLiveCommand(s,text),undefined,'native Omni gets the first attempt');
 for(const input of [text+'？','不要'+text,'确认当前风险测评信息，第一题改成二后提交。'])assert.equal(explicitWorkflowConfirmation(s,input),undefined);
 s=apply(s,{type:'workflow',command:{...confirmation,source:'voice',utterance:text,turnId:crypto.randomUUID()}});assert.equal(s.workflows!.records.questionnaires.length,1);assert.equal(s.plan!.status,'complete');
});
test('a prohibited freeze clause cannot replace a positive card-status query',async()=>{
 const text='查询日常借记卡的当前状态，不执行冻结。';assert.equal(inferFunction(text),'CA01');assert.equal(inferFunction('先不要确认这份风险测评，帮我查一下2026年10月账单。'),'BI02');
 let s=start();s=apply(s,{type:'plan',command:{operation:'interrupt',functionId:'CA06',params:{cardId:'card-daily',action:'freeze'},source:'voice',utterance:'准备临时冻结日常借记卡的草稿，先展示卡片，不要确认或执行。'}});const freeze=currentWorkflow(s)!.id;
 const v=await reviewReply(s,{...input(s),utterance:text},provider,undefined,fake({decision:'accept',reason:'already displayed'}));assert.equal(v.decision,'repair');s=apply(s,v.action!);
 assert.ok(s.workflows!.tasks.some(t=>t.functionId==='CA01'&&t.status==='complete'));assert.equal(s.workflows!.tasks.find(t=>t.id===freeze)!.status,'review');assert.equal(s.workflows!.records.cards.find(c=>c.id==='card-daily')!.status,'active');
});

test('a sequential plan does not prematurely repair a later queued query',async()=>{
 const text='先查询理财产品，然后做风险测评，最后查询订阅清单。';
 let s=apply(initialState(),{type:'plan',command:{operation:'create',source:'voice',utterance:text}});
 assert.ok(s.workflows!.tasks.some(t=>t.functionId==='IN06'&&t.status==='complete'));
 assert.ok(s.workflows!.tasks.some(t=>t.functionId==='SU01'&&t.status==='queued'));
 const v=await reviewReply(s,{...input(s),utterance:text,startRevision:0},provider,undefined,fake({decision:'accept',reason:'the current step progressed and assessment is next'}));
 assert.equal(v.decision,'accept');assert.equal(v.action,undefined);
});

test('a rejected reply after a completed tool hands its receipt to an independent narrator',async()=>{
 const receipts:any[]=[];
 const q=new QwenConversation(()=>{},{onTranscript:()=>{},onInterrupt:()=>{},onTool:async()=>({status:'complete'}),onReviewReply:async()=>({decision:'reject',message:'wording is misleading',facts:{operationResult:{message:'三张银行卡'}}}),onHaltedRecovery:f=>receipts.push(f)});
 q.userText('显示银行卡列表');await q.handle({type:'response.created',response:{id:'tool'}});
 await q.handle({type:'response.function_call_arguments.done',name:'bank_function',call_id:'c',arguments:'{"operation":"run","functionId":"CA01"}'});await tick();
 await q.handle({type:'response.done',response:{id:'tool',output:[{type:'function_call',name:'bank_function',call_id:'c',arguments:'{"operation":"run","functionId":"CA01"}'}]}});await response(q,'reply','列表已查询。');await tick();
 assert.equal(receipts.length,1);assert.equal(receipts[0].operationResult.message,'三张银行卡');q.stop();
});

test('both models approving a spoken selection cannot invent an answer in an empty slot',async()=>{
 let s=start();s=apply(s,{type:'workflow',command:{operation:'amend',taskId:currentWorkflow(s)!.id,params:{answers:[3,0,0]},source:'voice',utterance:'第一题选三'}});
 const approved=fake({decision:'accept',reason:'reply matches'}),base={...input(s),utterance:'第一题选三'};
 const wrong=await reviewReply(s,{...base,reply:'第二题你选的是中等波动。接下来第三题，你有多少投资经验？'},provider,undefined,approved);assert.equal(wrong.decision,'repair');assert.equal(wrong.action,undefined);
 const retry=await reviewReply(s,{...base,repairAttempt:1,reply:'第二题你选的是中等波动。'},provider,undefined,approved);assert.equal(retry.decision,'reject');
 const correct=await reviewReply(s,{...base,reply:'第一题你选的是一年内。第二题：面对本金波动，你能接受多大程度？选项包括中等波动。'},provider,undefined,approved);assert.equal(correct.decision,'accept');assert.deepEqual(currentWorkflow(s)!.params.answers,[3,0,0]);
});

test('a pending questionnaire cannot turn an explicit product explanation into completing or submitting that questionnaire',async()=>{
 const s=start(),before=structuredClone(s),utterance='只比较演示现金基金和演示债券基金，不申购。';
 const v=await reviewReply(s,{...input(s),utterance,reply:'现金基金风险等级1，债券基金风险等级3，只做比较不办理。'},provider,undefined,fake({decision:'repair',repairType:'action',reason:'未完成风险测评提交，需补全并提交问卷',action:{operation:'resume',taskId:currentWorkflow(s)!.id}}));
 assert.equal(v.decision,'repair');assert.equal(v.action,undefined);assert.equal(v.repairScope,'explanation');assert.deepEqual(s,before);
});

test('pure explanation review receives product facts without Checklist commands, and cannot execute a proposed action',async()=>{
 const s=start(),before=structuredClone(s),requests:any[]=[];
 const request:typeof fetch=async(_url,options)=>{requests.push(JSON.parse(String(options!.body)));return Response.json({choices:[{message:{content:JSON.stringify({decision:'repair',repairType:'action',reason:'needs submitting',action:{operation:'confirm',taskId:currentWorkflow(s)!.id}})}}]});};
 const v=await reviewReply(s,{...input(s),utterance:'只比较演示现金基金和演示债券基金，不申购。'},provider,undefined,request);
 const payload=JSON.parse(requests[0].messages[1].content);assert.equal(payload.actual,undefined);assert.equal(payload.facts,undefined);assert.equal(payload.explanation.products.find((p:any)=>p.id==='fund-bond').risk,3);
 for(const key of ['nextQuestion','confirmationRequest','acceptedParams','amendRequest'])assert.ok(!JSON.stringify(payload).includes(key));
 assert.equal(v.action,undefined);assert.equal(v.repairScope,'explanation');assert.deepEqual(s,before);
});

test('an approving reviewer cannot replace a two-product comparison with shared features or a questionnaire',async()=>{
 const s=start(),utterance='只比较演示现金基金和演示债券基金，不申购。',approved=fake({decision:'accept',reason:''});
 for(const reply of ['两款都是演示基金，均预计T+1工作日赎回。','现金基金低风险、债券基金中风险。请继续回答风险测评第三题。']){
  const v=await reviewReply(s,{...input(s),utterance,reply},provider,undefined,approved);assert.equal(v.decision,'repair');assert.equal(v.repairScope,'explanation');assert.equal(v.action,undefined);
 }
 const v=await reviewReply(s,{...input(s),utterance,reply:'现金基金是货币类，债券基金是债券类，均不保证收益。'},provider,undefined,approved);assert.equal(v.decision,'accept');
});

test('explanation corrections with a handoff callback use a fresh read-only path rather than reusing the old conversation',async()=>{
 const sent:any[]=[],handoffs:any[]=[];const facts={originalRequest:'只比较产品，不申购',explanation:{products:[]}};
 const q=new QwenConversation((type,extra)=>sent.push({type,...extra}),{onTranscript:()=>{},onInterrupt:()=>{},onTool:async()=>({}),onReviewReply:async()=>({decision:'repair',repairScope:'explanation',facts}),onHaltedRecovery:f=>handoffs.push(f)});
 q.userText('只比较产品，不申购');await response(q,'bad','请继续第三题。');await tick();assert.deepEqual(handoffs,[facts]);assert.equal(sent.filter(e=>e.type==='response.create').length,1);assert.equal(sent.filter(e=>e.type==='session.update').length,0);q.stop();
});

test('one invalid reviewer response can be retried read-only without changing saved facts',async()=>{
 const s=start(),before=JSON.stringify(s);let calls=0;
 const request:typeof fetch=async()=>{calls++;return Response.json({choices:[{message:{content:calls===1?'not-json':JSON.stringify({decision:'accept',reason:'x'.repeat(900)})}}]});};
 const v=await reviewReply(s,{...input(s),utterance:'只比较演示现金基金和演示债券基金，不申购。',reply:'现金基金为货币类，债券基金为债券类。'},provider,undefined,request);assert.equal(calls,2);assert.equal(v.decision,'accept');assert.equal(v.reviewerAttempts,2);assert.equal(v.message.length,600);assert.equal(JSON.stringify(s),before);
});

test('explanation repair uses its own task scope and rejects business tools without invoking the backend',async()=>{
 const sent:any[]=[];let tools=0;
 const q=new QwenConversation((type,extra)=>sent.push({type,...extra}),{onTranscript:()=>{},onInterrupt:()=>{},onTool:async()=>{tools++;return {};},onReviewReply:async()=>({decision:'repair',repairScope:'explanation',facts:{originalRequest:'只比较产品，不申购',explanation:{products:[{name:'现金基金',risk:1}]}},message:'核对事实'})});
 q.userText('只比较产品，不申购');await response(q,'first','两款都低风险。');await tick();const update=sent.find(e=>e.type==='session.update');assert.match(update.session.instructions,/不要继续背景问卷/);assert.ok(!update.session.instructions.includes('已保存2题'));
 await q.handle({type:'session.updated'});await q.handle({type:'response.created',response:{id:'repair'}});await q.handle({type:'response.function_call_arguments.done',name:'bank_function',call_id:'forbidden',arguments:'{"operation":"confirm"}'});await tick();assert.equal(tools,0);assert.ok(sent.some(e=>e.item?.type==='function_call_output'&&JSON.parse(e.item.output).status==='read_only'));q.stop();
});

test('response.done snapshot restores a complete transcript when transient text events are missing or partial',async()=>{
 const seen:any[]=[];const h=harness(async c=>{seen.push(c.reply);return {decision:'accept'};});h.q.userText('解释草稿');
 await h.q.handle({type:'response.created',response:{id:'snapshot'}});await h.q.handle({type:'response.audio_transcript.delta',response_id:'snapshot',item_id:'item',delta:'已提交'});
 await h.q.handle({type:'response.done',response:{id:'snapshot',status:'completed',output:[{type:'message',id:'item',content:[{type:'audio',transcript:'草稿尚未提交。'}]}]}});await tick();
 assert.deepEqual(seen,['草稿尚未提交。']);assert.deepEqual(h.played,['snapshot']);assert.ok(!h.heard.includes('已提交'));h.q.stop();
});

test('a final tool snapshot without dedicated arguments events executes exactly once, even if the event arrives late',async()=>{
 let tools=0;const q=new QwenConversation(()=>{},{onTranscript:()=>{},onInterrupt:()=>{},onTool:async()=>{tools++;return {status:'complete'};}});q.userText('查询银行卡');await q.handle({type:'response.created',response:{id:'r'}});
 const item={type:'function_call',id:'item',name:'bank_function',call_id:'snapshot-call',arguments:'{"operation":"run","functionId":"CA01"}'};
 await q.handle({type:'response.done',response:{id:'r',status:'completed',output:[item]}});await tick();await q.handle({...item,type:'response.function_call_arguments.done',response_id:'r'});await tick();assert.equal(tools,1);q.stop();
});

test('failed or structurally incomplete final tool snapshots are not promoted into executable requests',async()=>{
 for(const item of [{type:'function_call',status:'failed',name:'bank_function',call_id:'c',arguments:'{"operation":"confirm"}'},{type:'function_call',name:'bank_function',call_id:'c'}]){
  let tools=0;const contexts:any[]=[];const q=new QwenConversation(()=>{},{onTranscript:()=>{},onInterrupt:()=>{},onTool:async()=>{tools++;return {};},onStall:c=>contexts.push(c)});q.userText('确认');await q.handle({type:'response.created',response:{id:'r'}});await q.handle({type:'response.done',response:{id:'r',status:'completed',output:[item]}});await tick();assert.equal(tools,0);assert.equal(contexts[0].beforeAnyTool,true);
 }
});

test('empty and incomplete final replies recover immediately instead of silently ending or accepting partial text',async()=>{
 for(const status of ['completed','failed','incomplete']){
  const contexts:any[]=[],diagnostics:any[]=[];let reviews=0;
  const q=new QwenConversation(()=>{},{onTranscript:()=>{},onInterrupt:()=>{},onTool:async()=>({}),onReviewReply:async()=>{reviews++;return {decision:'accept'};},onStall:c=>contexts.push(c),onDiagnostic:d=>diagnostics.push(d)});
  q.userText('解释一下');await q.handle({type:'response.created',response:{id:'r'}});await q.handle({type:'response.done',response:{id:'r',status,output:[]}});assert.equal(reviews,0);assert.equal(contexts.length,1);assert.equal(contexts[0].beforeAnyTool,true);assert.match(diagnostics[0].reason,/provider_/);
 }
 const contexts:any[]=[];const q=new QwenConversation(()=>{},{onTranscript:()=>{},onInterrupt:()=>{},onTool:async()=>({status:'complete'}),onStall:c=>contexts.push(c)});q.userText('查询银行卡');await q.handle({type:'response.created',response:{id:'tool'}});await q.handle({type:'response.function_call_arguments.done',call_id:'c',name:'bank_function',arguments:'{"operation":"run","functionId":"CA01"}'});await tick();await q.handle({type:'response.done',response:{id:'tool',output:[{type:'function_call',name:'bank_function',call_id:'c',arguments:'{"operation":"run","functionId":"CA01"}'}]}});await q.handle({type:'response.created',response:{id:'empty'}});await q.handle({type:'response.done',response:{id:'empty',status:'completed',output:[]}});assert.equal(contexts[0].beforeAnyTool,false);
});

test('continuous partial words cannot extend a single model response beyond its absolute deadline',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const contexts:any[]=[],diagnostics:any[]=[];
 const q=new QwenConversation(()=>{},{onTranscript:()=>{},onInterrupt:()=>{},onTool:async()=>({}),onReviewReply:async()=>({decision:'accept'}),onStall:c=>contexts.push(c),onDiagnostic:d=>diagnostics.push(d)});
 q.userText('解释一下');await q.handle({type:'response.created',response:{id:'r'}});
 for(let i=0;i<6;i++){t.mock.timers.tick(20000);await q.handle({type:'response.text.delta',response_id:'r',item_id:'item',delta:'持续输出文字'});}
 assert.equal(contexts.length,1);assert.equal(diagnostics.at(-1).reason,'response_deadline_exceeded');t.mock.timers.reset();
});

test('duplicate old response events cannot clear the next input watchdog or mark it as accepted',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const contexts:any[]=[],diagnostics:any[]=[];
 const q=new QwenConversation(()=>{},{onTranscript:()=>{},onInterrupt:()=>{},onTool:async()=>({}),onStall:c=>contexts.push(c),onDiagnostic:d=>diagnostics.push(d)});
 q.userText('第一轮');await q.handle({type:'response.created',response:{id:'old'}});const completed={type:'response.done',response:{id:'old',status:'completed',output:[{type:'message',content:[{type:'text',text:'收到'}]}]}};
 await q.handle(completed);q.userText('第二轮');await q.handle({type:'response.created',response:{id:'old'}});await q.handle(completed);t.mock.timers.tick(30001);assert.equal(contexts.length,1);assert.equal(contexts[0].utterance,'第二轮');assert.equal(contexts[0].beforeAnyTool,true);assert.equal(diagnostics.at(-1).phase.requested,true);assert.equal(diagnostics.at(-1).phase.active,false);t.mock.timers.reset();
});

test('a late old response usage cannot overwrite the current context budget',async()=>{
 const q=new QwenConversation(()=>{},{onTranscript:()=>{},onInterrupt:()=>{},onTool:async()=>({})});q.userText('一');await q.handle({type:'response.created',response:{id:'old'}});await q.handle({type:'response.done',response:{id:'old',usage:{input_tokens:100},output:[{type:'message'}]}});q.userText('二');await q.handle({type:'response.created',response:{id:'new'}});await q.handle({type:'response.done',response:{id:'new',usage:{input_tokens:500},output:[{type:'message'}]}});await q.handle({type:'response.done',response:{id:'old',usage:{input_tokens:99999},output:[{type:'message'}]}});assert.equal((q.diagnostic('test').budget as any).inputTokens,500);q.stop();
});

test('an existing freeze draft must save the explicitly requested action, not only the card identity',async()=>{
 let s=apply(initialState(),{type:'workflow',command:{operation:'run',functionId:'CA06',params:{cardId:'card-daily'},source:'card'}});const id=currentWorkflow(s)!.id;assert.equal(currentWorkflow(s)!.status,'collecting');
 const v=await reviewReply(s,{...input(s),utterance:'准备临时冻结日常借记卡的草稿，先展示卡片，不要确认或执行。'},provider,undefined,fake({decision:'accept',reason:'the draft exists'}));
 assert.equal(v.decision,'repair');assert.ok(v.action);s=apply(s,v.action!);assert.equal(currentWorkflow(s)!.id,id);assert.equal(currentWorkflow(s)!.params.action,'freeze');assert.equal(currentWorkflow(s)!.status,'review');assert.equal(s.workflows!.records.cards.find(c=>c.id==='card-daily')!.status,'active');
});

test('an omitted literal freeze-draft cancellation can use the current card without granting Flash cancellation authority',()=>{
 let s=apply(initialState(),{type:'plan',command:{operation:'create',functionId:'CA06',params:{cardId:'card-daily',action:'freeze'},source:'voice',utterance:'准备临时冻结日常借记卡的草稿，不确认'}});const id=currentWorkflow(s)!.id;
 const text='取消这份还未执行的冻结草稿。',command=explicitWorkflowCancellation(s,text)!;assert.equal(command.taskId,id);
 for(const t of ['不要'+text,text+'？','为什么'+text,'取消风险测评草稿'])assert.equal(explicitWorkflowCancellation(s,t),undefined);
 s=apply(s,{type:'workflow',command:{...command,source:'voice',utterance:text,turnId:crypto.randomUUID()}});assert.equal(s.workflows!.tasks.find(t=>t.id===id)!.status,'cancelled');assert.equal(s.workflows!.records.cards.find(c=>c.id==='card-daily')!.status,'active');assert.equal(explicitWorkflowCancellation(s,text),undefined);
});

test('native audio remains buffered until release and interruption prevents late playback',async()=>{
 const originalRecorder=globalThis.MediaRecorder,originalAudio=globalThis.Audio;
 let plays=0,ended=0;const playing:boolean[]=[];let currentAudio:any;
 class Recorder{
  static isTypeSupported(){return true;}state='inactive';mimeType='audio/webm';ondataavailable:any;onstop:any;onerror:any;
  start(){this.state='recording';}stop(){this.state='inactive';queueMicrotask(()=>{this.ondataavailable?.({data:new Blob(['synthetic audio'])});this.onstop?.();});}
 }
 class AudioStub{src:string;onended:any;onerror:any;constructor(src:string){this.src=src;currentAudio=this;}async play(){plays++;}pause(){}}
 Object.assign(globalThis,{MediaRecorder:Recorder,Audio:AudioStub});
 try{
  const audio=new VerifiedAudio(()=>{},value=>playing.push(value),()=>ended++);audio.setStream({} as MediaStream);
  audio.start('withheld');assert.equal(plays,0);audio.finish('withheld');await audio.play('withheld');assert.equal(plays,1);assert.deepEqual(playing,[true]);
  currentAudio.onended();assert.equal(ended,1);audio.interrupt();assert.deepEqual(playing,[true,false]);
  audio.start('late');const late=audio.play('late');audio.interrupt();await late;assert.equal(plays,1);assert.equal(ended,1,'interruption must not resume listening as if playback ended naturally');audio.stop();
 }finally{Object.assign(globalThis,{MediaRecorder:originalRecorder,Audio:originalAudio});}
});
test('the watchdog distinguishes no tool execution from a completed tool with a stalled continuation',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const contexts:any[]=[];
 const make=()=>new QwenConversation(()=>{},{onTranscript:()=>{},onInterrupt:()=>{},onTool:async()=>({status:'complete'}),onStall:c=>contexts.push(c)});
 const before=make();before.userText('查余额');await before.handle({type:'response.created',response:{id:'no-tool'}});t.mock.timers.tick(30001);assert.equal(contexts[0].beforeAnyTool,true);assert.equal(contexts[0].utterance,'查余额');
 const after=make();after.userText('查余额');await after.handle({type:'response.created',response:{id:'tool'}});await after.handle({type:'response.function_call_arguments.done',name:'bank_request',call_id:'c',arguments:'{"operation":"list_accounts"}'});await new Promise(r=>setImmediate(r));
 await after.handle({type:'response.done',response:{id:'tool',output:[{type:'function_call',name:'bank_request',call_id:'c',arguments:'{"operation":"list_accounts"}'}]}});await after.handle({type:'response.created',response:{id:'continuation'}});t.mock.timers.tick(30001);assert.equal(contexts[1].beforeAnyTool,false);
 const literal=new QwenConversation(()=>{},{onTranscript:()=>{},onInterrupt:()=>{},literalCommandFor:()=>({operation:'confirm'}),onTool:async()=>({reply:'等待页面认证'}),onStall:c=>contexts.push(c)});
 literal.userText('确认');await new Promise(r=>setImmediate(r));t.mock.timers.tick(30001);assert.equal(contexts[2].beforeAnyTool,false,'a literal confirmation is still a real tool attempt');t.mock.timers.reset();
});
test('transport failures retain the pending turn boundary and an idle conversation does not restart',async()=>{
 const q=new QwenConversation(()=>{},{onTranscript:()=>{},onInterrupt:()=>{},onTool:async()=>({status:'complete'})});
 assert.equal(q.pendingRecovery(),undefined);q.userText('查询银行卡');assert.equal(q.pendingRecovery()!.beforeAnyTool,true);
 await q.handle({type:'response.created',response:{id:'r'}});await q.handle({type:'response.function_call_arguments.done',name:'bank_function',call_id:'c',arguments:'{"operation":"run","functionId":"CA01"}'});await tick();
 assert.equal(q.pendingRecovery()!.beforeAnyTool,false);await q.handle({type:'response.done',response:{id:'r',output:[{type:'function_call',name:'bank_function',call_id:'c',arguments:'{"operation":"run","functionId":"CA01"}'}]}});await q.handle({type:'response.created',response:{id:'answer'}});await q.handle({type:'response.done',response:{id:'answer',output:[{type:'message'}]}});
 assert.equal(q.pendingRecovery(),undefined);q.stop();
});

test('review-executed commands and page actions are never classified as safe to replay',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const contexts:any[]=[];
 const q=new QwenConversation(()=>{},{onTranscript:()=>{},onInterrupt:()=>{},onTool:async()=>({}),onReviewReply:async()=>({decision:'repair',facts:{revision:2},toolAttempted:true}),onStall:c=>contexts.push(c)});
 q.userText('确认当前风险测评信息，请提交这份测评。');await response(q,'missed','我会提交。');await new Promise(r=>setImmediate(r));await q.handle({type:'session.updated'});await q.handle({type:'response.created',response:{id:'receipt'}});t.mock.timers.tick(30001);assert.equal(contexts[0].beforeAnyTool,false);
 const page=new QwenConversation(()=>{},{onTranscript:()=>{},onInterrupt:()=>{},onTool:async()=>({}),onStall:c=>contexts.push(c)});page.userText('确认');await page.handle({type:'response.created',response:{id:'r'}});await page.handle({type:'response.done',response:{id:'r'}});page.contextUpdate('{"status":"complete"}');t.mock.timers.tick(30001);assert.equal(contexts[1].beforeAnyTool,false);t.mock.timers.reset();
});

test('a bare wait notice before a tool call plays at once; anything carrying facts stays unreviewed and silent',async()=>{
 for(const [text,plays] of [['好的，我查一下，请稍等。',true],['已经转好了，请稍等。',false],['500元转出中，稍等',false],['我能帮你转账和查余额。',false]] as const){
  const heard:string[]=[],notices:string[]=[];
  const q=new QwenConversation(()=>{},{onTranscript:(speaker,t)=>{if(speaker==='assistant')heard.push(t)},onInterrupt:()=>{},onTool:()=>new Promise(()=>{}),onReviewReply:async()=>({decision:'accept'}),onWaitNotice:(_id,t)=>notices.push(t)});
  q.userText('我有哪些订阅');
  await q.handle({type:'response.created',response:{id:'r1'}});
  await q.handle({type:'response.audio_transcript.delta',response_id:'r1',item_id:'m1',delta:text});
  await q.handle({type:'response.done',response:{id:'r1',status:'completed',output:[{type:'message'},{type:'function_call',call_id:'c1',name:'bank_request',arguments:'{"operation":"get_state"}',status:'completed'}]}});
  assert.deepEqual(notices,plays?[text]:[],text);assert.equal(heard.includes(text),plays,text);q.stop();
 }
});
