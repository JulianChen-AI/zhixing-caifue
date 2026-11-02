import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduceBank } from '../lib/bank/engine.ts';
import type { BankState, BankAction } from '../lib/bank/types.ts';
import { currentPlanStep, planTextAction } from '../lib/plans/engine.ts';
import { decompose, isComplexRequest } from '../lib/plans/decompose.ts';
import { planToolArguments } from '../lib/plans/schema.ts';
import { bankToolResult } from '../lib/bank/realtime-tools.ts';
import type { PlanCommand } from '../lib/plans/types.ts';
const act=(s:BankState,a:BankAction,id:string=crypto.randomUUID())=>reduceBank(s,a,id);
const plan=(s:BankState,c:Omit<PlanCommand,'source'>&{source?:'voice'|'card'},id:string=crypto.randomUUID())=>act(s,{type:'plan',command:{source:'voice',...c}},id);
const create=(text:string,s=initialState())=>plan(s,{operation:'create',utterance:text});
const flow=(s:BankState)=>s.workflows!.tasks.find(t=>t.id===currentPlanStep(s)?.taskId)!;
function confirm(s:BankState){const t=flow(s);return act(s,{type:'workflow',command:{operation:'confirm',taskId:t.id,token:t.reviewToken!,source:'voice',utterance:'确认',turnId:crypto.randomUUID()}});}
function authenticate(s:BankState,id:string=crypto.randomUUID()){const t=flow(s);return act(s,{type:'workflow',command:{operation:'authenticate',taskId:t.id,token:t.verificationId!,code:'123456',source:'card'}},id);}
const fraction='我要转账，额，给尾号6688的那个张三，然后转余额比较小的那个账户的三分之一余额。先给我核对，不要直接提交。';

test('typed freeze acknowledgements use the workflow confirmation gate inside an active plan',()=>{
 for(const utterance of ['确认冻结','确定冻结','确认']){
  let s=create('冻结日常卡');const id=flow(s).id;
  const action=planTextAction(s,utterance)!;assert.equal(action.type,'workflow');
  s=act(s,action);assert.equal(flow(s).id,id);assert.equal(flow(s).status,'authenticate');
  assert.equal(s.workflows!.records.cards.find(card=>card.id==='card-daily')!.status,'active');
 }
 const s=create('冻结日常卡');assert.throws(()=>planTextAction(s,'确认解冻'),/操作与当前摘要不一致/);
 const negated=act(s,planTextAction(s,'不要确认冻结')!);assert.equal(flow(negated).status,'review');
});

test('the advertised cancel-all phrase cancels only unfinished tasks and preserves completed work',()=>{
 let s=create('先查询余额，然后从日常账户给室友转50元，然后从储蓄账户给李四转30元');
 s=act(s,planTextAction(s,'取消全部剩余任务')!);
 assert.equal(s.plan!.status,'cancelled');
 assert.deepEqual(s.plan!.steps.map(step=>step.status),['complete','cancelled','cancelled']);
 assert.equal(s.receipts.length,0);assert.equal(s.accounts[0].balance,1286500);
});

test('cancel-current text binds to the visible task without cancelling the next transfer',()=>{
 let s=create('先从日常账户给室友转50元，然后从储蓄账户给李四转30元');
 const first=flow(s).id,second=s.plan!.steps[1].taskId;
 s=act(s,planTextAction(s,'取消当前任务')!);
 assert.equal(s.workflows!.tasks.find(task=>task.id===first)!.status,'cancelled');
 assert.notEqual(s.workflows!.tasks.find(task=>task.id===second)!.status,'cancelled');
 assert.equal(s.receipts.length,0);
});

test('cancelling the only task ends the plan rather than displaying a resumable empty pause',()=>{
 let s=create('冻结日常卡');
 s=act(s,{type:'workflow',command:{operation:'cancel',taskId:flow(s).id,source:'card'}});
 assert.equal(s.plan!.status,'cancelled');assert.equal(s.plan!.currentTaskId,undefined);
});

test('manual order settlement preserves its actual result as the visible task after plan reconciliation',()=>{
 const fixture=initialState();fixture.workflows!.riskProfile={level:5,answers:[5,5,5],validUntil:'2027-10-29T00:00:00Z'};
 let s=plan(fixture,{operation:'create',source:'card',functionId:'IN08',params:{accountId:'daily',productId:'fund-cash',amount:100}});s=authenticate(confirm(s));
 assert.equal(s.workflows!.records.orders[0].status,'pending');
 s=act(s,{type:'workflow',command:{operation:'settle',source:'card'}});
 const shown=s.workflows!.tasks.find(task=>task.id===s.workflows!.currentTaskId)!;
 assert.equal(shown.functionId,'sandbox');assert.equal(shown.status,'complete');
 assert.equal(s.workflows!.records.orders[0].status,'settled');assert.equal(s.accounts[0].balance,1276500);
 assert.equal(s.plan!.status,'complete');
});

test('ordinary tasks also have a one-item plan and corrections do not split the request',()=>{
 assert.equal(isComplexRequest('从日常账户给室友转500元',initialState()),false);
 assert.equal(isComplexRequest('从日常账户给室友转500元，然后改成300元',initialState()),false);
 const s=create('从日常账户给室友转500元');assert.equal(s.plan!.steps.length,1);assert.equal(s.plan!.steps[0].status,'review');assert.equal(s.task!.amount,50000);assert.equal(s.task!.step,'review');
});
test('balance comparison and one-third produce read, deterministic calculation, and inner transfer checklist',()=>{
 let s=create(fraction);assert.equal(s.plan!.steps.length,3);assert.deepEqual(s.plan!.steps.map(x=>x.kind),['workflow','calculation','workflow']);
 assert.deepEqual(s.plan!.steps.map(x=>x.status),['complete','complete','review']);
 const calc=s.plan!.steps[1].calculation!;assert.equal(calc.accountId,'daily');assert.equal(calc.amountCents,428833);assert.equal(calc.remainder,1);
 assert.equal(s.task!.amount,428833);assert.equal(flow(s).fieldEvidence!.amount.source,'calculation');assert.equal(s.receipts.length,0);
 s=confirm(s);assert.equal(flow(s).status,'authenticate');assert.equal(s.receipts.length,0);
 s=authenticate(s);assert.equal(s.plan!.status,'complete');assert.equal(s.receipts.length,1);assert.equal(s.accounts[0].balance,857667);
});
test('ambiguous later purposes are retained and stop the entire chain before a debit',()=>{
 let s=create('我要从日常账户先给室友张三转500元，然后再拿剩下的500，整理一下材料。');
 assert.equal(s.plan!.status,'collecting');assert.equal(s.plan!.steps.length,2);assert.equal(s.plan!.steps[1].kind,'clarify');assert.equal(s.task,null);assert.equal(s.receipts.length,0);
 const step=s.plan!.steps[1];s=plan(s,{operation:'amend',planId:s.plan!.id,stepId:step.id,utterance:'把500元存入旅行目标，用日常账户'});
 assert.equal(flow(s).functionId,'TR03');assert.equal(flow(s).params.amount,500);assert.equal(s.plan!.steps[1].functionId,'IN02');
 s=authenticate(confirm(s));assert.equal(flow(s).functionId,'IN02');assert.equal(s.receipts.length,1);assert.equal(s.accounts[0].balance,1236500);
 s=authenticate(confirm(s));assert.equal(s.plan!.status,'complete');assert.equal(s.accounts[0].balance,1186500);assert.equal(s.workflows!.records.goals[0].balance,50000);
});
test('dependencies stop a second transfer until the first has passed its own authentication',()=>{
 let s=create('先从日常账户给室友转500元，然后从储蓄账户给同学李四转300元');
 assert.equal(s.workflows!.tasks.find(t=>t.id===s.plan!.steps[1].taskId)!.status,'queued');
 assert.throws(()=>act(s,{type:'workflow',command:{operation:'run',functionId:'TR03',params:{recipientId:'li-friend',accountId:'savings',amount:300},source:'card'}}));
 s=confirm(s);assert.equal(s.plan!.steps[1].status,'pending');s=authenticate(s);assert.equal(s.plan!.steps[0].status,'complete');assert.equal(flow(s).params.amount,300);
 assert.equal(flow(s).status,'review');assert.equal(s.receipts.length,1);assert.equal(s.accounts[1].balance,3000000);
});
test('failure, pause and reload retain completed checkmarks and never skip to later business',()=>{
 let s=create('先查余额，然后从日常账户给室友转20000元，然后查账单');
 assert.equal(s.plan!.status,'blocked');assert.equal(s.plan!.steps[0].status,'complete');assert.equal(s.workflows!.tasks.find(t=>t.id===s.plan!.steps[2].taskId)!.status,'queued');
 const readId=s.plan!.steps[0].taskId;
 s=plan(s,{operation:'pause',planId:s.plan!.id});assert.throws(()=>confirm(s));
 s=JSON.parse(JSON.stringify(s));s=plan(s,{operation:'resume',planId:s.plan!.id});assert.equal(s.plan!.status,'blocked');assert.equal(s.plan!.steps[0].taskId,readId);
 s=plan(s,{operation:'amend',planId:s.plan!.id,stepId:s.plan!.steps[1].id,utterance:'改成500元'});assert.equal(flow(s).status,'review');assert.equal(s.plan!.steps[0].taskId,readId);
});
test('changed balances recompute a fraction, revoke prior auth and require a new summary',()=>{
 let s=create(fraction);s=confirm(s);const t=flow(s),oldAuth=t.verificationId!,oldToken=t.reviewToken!;
 s.accounts[0].balance=900000;
 s=act(s,{type:'workflow',command:{operation:'authenticate',taskId:t.id,token:oldAuth,code:'123456',source:'card'}});
 assert.equal(flow(s).status,'review');assert.equal(s.task!.amount,300000);assert.equal(flow(s).verificationId,null);assert.notEqual(flow(s).reviewToken,oldToken);assert.equal(s.receipts.length,0);
 assert.equal(flow(s).fieldEvidence!.amount.source,'calculation');assert.equal(flow(s).fieldEvidence!.accountId.source,'calculation');
 assert.throws(()=>act(s,{type:'workflow',command:{operation:'authenticate',taskId:t.id,token:oldAuth,code:'123456',source:'card'}}));
 s=authenticate(confirm(s));assert.equal(s.receipts[0].amount,300000);
});
test('ties require an explicit account and model computed amounts are not trusted',()=>{
 const start=initialState();start.accounts[1].balance=start.accounts[0].balance;
 let s=create(fraction,start);assert.equal(currentPlanStep(s)!.kind,'calculation');assert.equal(currentPlanStep(s)!.status,'collecting');assert.equal(s.task,null);
 s=plan(s,{operation:'amend',planId:s.plan!.id,stepId:currentPlanStep(s)!.id,params:{accountId:'savings'},utterance:'用储蓄账户'});assert.equal(s.task!.accountId,'savings');
 assert.throws(()=>createWithProposal());
 function createWithProposal(){return plan(initialState(),{operation:'create',utterance:'从日常账户给室友转余额的一半',steps:[{quote:'从日常账户给室友转余额的一半',functionId:'TR03',params:{amount:1}}]});}
});
test('plan schemas cannot forge completion, skip authentication, omit clauses or ground arbitrary amounts',()=>{
 assert.equal(planToolArguments.safeParse({operation:'create',status:'complete'}).success,false);
 assert.throws(()=>decompose('先查余额，然后整理材料',initialState(),[{quote:'先查余额',functionId:'TR02'}]));
 assert.throws(()=>plan(initialState(),{operation:'create',utterance:'先查余额，然后给张三转500元',steps:[{quote:'先查余额',functionId:'TR02'},{quote:'给张三转500元',functionId:'TR03',params:{recipientId:'zhang-roommate',accountId:'daily',amount:50}}]}));
});
test('completed writes are not replayed on resume, duplicate requests or cancellation',()=>{
 let s=create('先从日常账户给室友转500元，然后从储蓄账户给李四转300元');const id=s.plan!.id,step0=s.plan!.steps[0].id;
 s=confirm(s);s=authenticate(s,'unique-plan-auth');const after=structuredClone(s);
 s=act(s,{type:'workflow',command:{operation:'authenticate',taskId:'ignored',code:'123456',source:'card'}},'unique-plan-auth');assert.deepEqual(s,after);
 assert.throws(()=>plan(s,{operation:'amend',planId:id,stepId:step0,params:{amount:1},source:'card'}));
 s=plan(s,{operation:'cancel',planId:id,utterance:'取消剩余任务'});assert.equal(s.plan!.steps[0].status,'complete');assert.equal(s.plan!.steps[1].status,'cancelled');assert.equal(s.receipts.length,1);assert.equal(s.accounts[0].balance,1236500);
});
test('public facts report outer dependencies, inner task IDs and explicit currency units',()=>{
 const s=create(fraction),out=bankToolResult(s);assert.ok(out.plan!.taskIds);assert.equal(out.plan!.nextAction,'review_current_task');assert.equal(out.plan!.tasks[1].calculation!.amount,4288.33);
 assert.equal(JSON.stringify(out.plan).includes('verificationId'),false);assert.ok(out.plan!.tasks[2].taskId);assert.equal(out.plan!.tasks[2].taskId,s.plan!.steps[2].id);assert.equal('currentStepId' in out.plan!,false);assert.equal('savedPlans' in out.plan!,false);
});
test('text replies fill only the current step and confirmations do not authorize future steps',()=>{
 let s=create('先从日常账户给室友转账，然后查余额');
 s=act(s,planTextAction(s,'500元')!);assert.equal(flow(s).params.amount,500);
 s=act(s,planTextAction(s,'确认')!);assert.equal(flow(s).status,'authenticate');assert.equal(s.workflows!.tasks.find(t=>t.id===s.plan!.steps[1].taskId)!.status,'queued');
});
test('one spoken confirmation cannot authorize the next step or a newly amended summary',()=>{
 const utterance='先从日常账户给室友转500元，然后从储蓄账户给李四转300元';
 let s=plan(initialState(),{operation:'create',utterance,turnId:'request-turn'});let t=flow(s);
 assert.throws(()=>act(s,{type:'workflow',command:{operation:'confirm',taskId:t.id,token:t.reviewToken!,source:'voice',utterance:'确认',turnId:'request-turn'}}));
 s=act(s,{type:'workflow',command:{operation:'confirm',taskId:t.id,token:t.reviewToken!,source:'voice',utterance:'确认',turnId:'confirm-first'}});s=authenticate(s);t=flow(s);
 assert.throws(()=>act(s,{type:'workflow',command:{operation:'confirm',taskId:t.id,token:t.reviewToken!,source:'voice',utterance:'确认',turnId:'confirm-first'}}));
 s=act(s,{type:'workflow',command:{operation:'amend',taskId:t.id,params:{amount:200},source:'voice',utterance:'改成200元',turnId:'edit-turn'}});t=flow(s);
 assert.throws(()=>act(s,{type:'workflow',command:{operation:'confirm',taskId:t.id,token:t.reviewToken!,source:'voice',utterance:'确认',turnId:'edit-turn'}}));
 s=confirm(s);assert.equal(flow(s).status,'authenticate');assert.equal(s.receipts.length,1);
});
test('ambiguous proportions, contradictory proposed purposes and negated transfers fail closed',()=>{
 for(const text of ['给室友转日常账户余额的1/3或者1/2','给室友转日常账户大概一半余额','给室友转日常账户一半余额美元','不要从日常给室友转500元，然后查余额','给室友转日常账户余额的-1/3','给室友转日常账户余额的1.2/3','给室友转日常账户余额的1/3.2','给室友转日常账户余额的0/0','给室友转日常账户余额一半和三分之一'])assert.throws(()=>create(text));
 assert.throws(()=>plan(initialState(),{operation:'create',utterance:'先查询视频会员，然后查余额',steps:[{quote:'先查询视频会员',functionId:'SU04',params:{subscriptionId:'sub-video'}},{quote:'查余额',functionId:'TR02'}]}));
});
test('accepted investment orders pause dependencies until actual sandbox settlement',()=>{
 const start=initialState();start.workflows!.riskProfile={level:1,validUntil:'2027-12-31',answers:[1,1,1]};
 let s=plan(start,{operation:'create',utterance:'先从日常账户申购演示现金基金100元，然后查余额',steps:[{quote:'先从日常账户申购演示现金基金100元',functionId:'IN08',params:{productId:'fund-cash',accountId:'daily',amount:100}},{quote:'查余额',functionId:'TR02'}]});
 s=authenticate(confirm(s));assert.equal(s.plan!.status,'blocked');assert.equal(s.plan!.steps[0].status,'external');assert.equal(s.workflows!.tasks.find(t=>t.id===s.plan!.steps[1].taskId)!.status,'queued');assert.equal(s.workflows!.records.orders[0].status,'pending');
 s=plan(s,{operation:'resume',planId:s.plan!.id});assert.equal(s.workflows!.tasks.find(t=>t.id===s.plan!.steps[1].taskId)!.status,'queued');
 s=act(s,{type:'workflow',command:{operation:'settle',source:'card'}});assert.equal(s.workflows!.records.orders[0].status,'settled');assert.equal(s.plan!.status,'complete');
});
test('unsupported steps do not run subsequent queries or claim completion',()=>{
 const s=plan(initialState(),{operation:'create',utterance:'先导入微信流水.csv，然后查余额',steps:[{quote:'先导入微信流水.csv',functionId:'BI07',params:{source:'微信',file:'流水.csv'}},{quote:'查余额',functionId:'TR02'}]});
 assert.equal(s.plan!.status,'blocked');assert.equal(s.plan!.steps[0].status,'blocked');assert.equal(s.workflows!.tasks.find(t=>t.id===s.plan!.steps[1].taskId)!.status,'queued');assert.equal(s.receipts.length,0);
});
test('a model cannot turn a purpose-free clause into a checked business step',()=>{
 const s=plan(initialState(),{operation:'create',utterance:'先从日常给室友转500元，然后整理材料',steps:[{quote:'先从日常给室友转500元',functionId:'TR03'},{quote:'整理材料',functionId:'BI04'}]});
 assert.equal(s.plan!.status,'collecting');assert.equal(s.plan!.steps[1].kind,'clarify');assert.equal(s.task,null);
 const amended=plan(s,{operation:'amend',planId:s.plan!.id,stepId:s.plan!.steps[1].id,functionId:'BI04',utterance:'就是整理一下材料'});assert.equal(amended.plan!.steps[1].kind,'clarify');assert.equal(amended.task,null);
});
test('separate ratio steps are parsed independently and read balances only when reached',()=>{
 const text='先从日常账户给室友转余额的一半，然后从储蓄账户给李四转余额的1/3';assert.equal(isComplexRequest(text,initialState()),true);
 let s=create(text);assert.equal(s.plan!.steps.length,6);assert.equal(s.plan!.steps[4].calculation,undefined);
 s=authenticate(confirm(s));assert.equal(s.plan!.steps[4].calculation!.amountCents,1000000);assert.equal(s.receipts.length,1);assert.equal(currentPlanStep(s)!.functionId,'TR03');
});
test('model clause punctuation does not prevent valid grounded plans',()=>{
 const s=plan(initialState(),{operation:'create',utterance:'先查余额，然后从日常账户给室友转500元。',steps:[{quote:'查余额，',functionId:'TR02'},{quote:'从日常账户给室友转500元。',functionId:'TR03'}]});assert.equal(flow(s).status,'review');
});
test('precreated tasks can activate at capacity without replaying the authenticated debit',()=>{
 let s=create('先从日常账户给室友转500元，然后查余额');s=confirm(s);
 const template=flow(s);
 for(let i=0;i<20;i++)s.workflows!.tasks.push({...structuredClone(template),id:crypto.randomUUID(),functionId:'IN01',legacyTaskId:undefined,status:'collecting'});
 s=authenticate(s);assert.equal(s.receipts.length,1);assert.equal(s.accounts[0].balance,1236500);assert.equal(s.plan!.steps[0].status,'complete');assert.equal(s.plan!.steps[1].status,'complete');assert.equal(s.plan!.status,'complete');
 assert.throws(()=>plan(s,{operation:'resume'}));assert.equal(s.receipts.length,1);assert.equal(s.accounts[0].balance,1236500);
});

test('amending a paused plan preserves the pause until an explicit resume',()=>{
 let s=create('先从日常账户给室友转500元，然后从储蓄账户给李四转300元');
 s=plan(s,{operation:'pause',planId:s.plan!.id,source:'card'});
 s=plan(s,{operation:'amend',planId:s.plan!.id,stepId:s.plan!.steps[1].id,params:{amount:200},source:'card'});
 assert.equal(s.plan!.status,'paused');assert.equal(s.workflows!.tasks.find(t=>t.id===s.plan!.steps[1].taskId)!.status,'queued');assert.throws(()=>confirm(s));
 s=plan(s,{operation:'resume',planId:s.plan!.id,source:'card'});s=authenticate(confirm(s));assert.equal(flow(s).params.amount,200);
});

test('restating a derived amount while changing a note retains its balance binding',()=>{
 let s=create(fraction);const step=currentPlanStep(s)!,binding=step.binding;
 s=plan(s,{operation:'amend',planId:s.plan!.id,stepId:step.id,params:{amount:4288.33,note:'饭钱'},source:'card'});
 assert.equal(currentPlanStep(s)!.binding,binding);
 s.accounts[0].balance=900000;s=confirm(s);assert.equal(flow(s).params.amount,3000);assert.equal(flow(s).status,'review');assert.equal(flow(s).params.note,'饭钱');
});

test('a previously used confirmation turn cannot authorize a third step or a later edit',()=>{
 let s=plan(initialState(),{operation:'create',utterance:'先从日常账户给室友转500元，然后从储蓄账户给李四转300元，然后从日常账户给室友转200元',turnId:'create-turn'});
 const voiceConfirm=(state:BankState,turnId:string)=>act(state,{type:'workflow',command:{operation:'confirm',taskId:flow(state).id,token:flow(state).reviewToken!,source:'voice',utterance:'确认',turnId}});
 s=plan(s,{operation:'amend',planId:s.plan!.id,stepId:currentPlanStep(s)!.id,params:{amount:400},utterance:'改成400元',turnId:'edit-first'});
 s=voiceConfirm(s,'confirm-1');const auth=flow(s).verificationId;s=voiceConfirm(s,'confirm-1');assert.equal(flow(s).verificationId,auth);
 s=authenticate(s);s=voiceConfirm(s,'confirm-2');s=authenticate(s);s=JSON.parse(JSON.stringify(s));
 for(const oldTurn of ['confirm-1','create-turn','edit-first'])assert.throws(()=>voiceConfirm(s,oldTurn),oldTurn);assert.equal(s.receipts.length,2);
 s=voiceConfirm(s,'confirm-3');s=plan(s,{operation:'amend',planId:s.plan!.id,stepId:currentPlanStep(s)!.id,params:{amount:100},utterance:'改成100元',turnId:'edit-3'});
 assert.throws(()=>voiceConfirm(s,'confirm-3'));assert.equal(flow(s).status,'review');
});

test('a now unpayable proportion revokes authorization, persists the stop and can recover',()=>{
 let s=confirm(create(fraction));const oldId=flow(s).id,oldAuth=flow(s).verificationId;
 s.accounts[0].balance=1;s=authenticate(s);
 assert.equal(s.plan!.status,'blocked');assert.equal(currentPlanStep(s)!.kind,'calculation');assert.equal(currentPlanStep(s)!.status,'blocked');
 assert.equal(s.workflows!.tasks.find(t=>t.id===oldId)!.verificationId,null);assert.equal(s.task!.verificationId,null);assert.equal(s.receipts.length,0);
 s=JSON.parse(JSON.stringify(s));s.accounts[0].balance=900000;s=plan(s,{operation:'resume',planId:s.plan!.id,source:'card'});
 assert.equal(flow(s).status,'review');assert.equal(flow(s).params.amount,3000);
 assert.throws(()=>act(s,{type:'workflow',command:{operation:'authenticate',taskId:oldId,token:oldAuth!,code:'123456',source:'card'}}));
 s=authenticate(confirm(s));assert.equal(s.receipts.length,1);
});

test('negated cancellations cannot cancel an outer checklist',()=>{
 const s=create('先从日常账户给室友转500元，然后查余额');
 for(const utterance of ['不用取消','不必取消','先不要取消','不要不办了','先别取消任务'])assert.throws(()=>plan(s,{operation:'cancel',planId:s.plan!.id,utterance}));
 const cancelled=plan(s,{operation:'cancel',planId:s.plan!.id,utterance:'取消剩余步骤'});assert.equal(cancelled.plan!.status,'cancelled');
});

test('a balance tie appearing after confirmation returns to account selection without retaining authorization',()=>{
 let s=confirm(create(fraction));const readId=s.plan!.steps[0].taskId,oldId=flow(s).id;
 s.accounts[1].balance=s.accounts[0].balance;s=authenticate(s);
 assert.equal(currentPlanStep(s)!.kind,'calculation');assert.equal(currentPlanStep(s)!.status,'collecting');assert.equal(currentPlanStep(s)!.calculation,undefined);
 assert.equal(s.workflows!.tasks.find(t=>t.id===oldId)!.verificationId,null);assert.equal(s.task!.verificationId,null);
 s=plan(s,{operation:'amend',planId:s.plan!.id,stepId:currentPlanStep(s)!.id,params:{accountId:'savings'},source:'card'});
 assert.equal(flow(s).status,'review');assert.equal(flow(s).params.accountId,'savings');assert.equal(s.plan!.steps[0].taskId,readId);
 s=authenticate(confirm(s));assert.equal(s.receipts.length,1);assert.equal(s.accounts[0].balance,1286500);assert.equal(s.accounts[1].balance,857667);
});

test('proportions reject truncated precision, signs and unsupported numeric notation',()=>{
 for(const ratio of ['0.001%','100.001%','.5%','-三分之一','负三分之一','三分之负一','-一半','负一半','1e-2%','1e0%','1/3e2','1.三分之一','3.1分之一','三分之一点五','0%'])assert.throws(()=>create('从日常账户给室友转余额的'+ratio),ratio);
 for(const ratio of ['0.01%','12.34%','100%','1/3','三分之一'])assert.equal(create('从日常账户给室友转余额的'+ratio).plan!.steps[1].status,'complete',ratio);
});


// Application dispatch is shared by card, typed and native-tool starts.
import {dispatchAction,resumeAction} from '../lib/plans/dispatch.ts';
import {recoverDraft,recoveryAction} from '../lib/workflows/recovery.ts';
const app=(s:BankState,a:BankAction,text='',id:string=crypto.randomUUID())=>reduceBank(s,dispatchAction(s,a,text),id);
const startApp=(s:BankState,functionId:string,text:string,params:Record<string,unknown>={})=>app(s,{type:'workflow',command:{operation:'run',functionId,params,source:'voice',utterance:text,turnId:crypto.randomUUID()}});
const amendApp=(s:BankState,params:Record<string,unknown>,text:string)=>app(s,{type:'workflow',command:{operation:'amend',taskId:flow(s).id,params,source:'voice',utterance:text,turnId:crypto.randomUUID()}});

test('single business starts persist an outer plan and never bypass its inner checklist',()=>{
 let s=startApp(initialState(),'IN05','开始做风险测评');const p=s.plan!.id,id=flow(s).id;
 assert.equal(s.plan!.steps.length,1);assert.equal(flow(s).status,'collecting');
 s=amendApp(s,{answers:[3,0,0]},'第一题选三');s=JSON.parse(JSON.stringify(s));
 assert.equal(s.plan!.id,p);assert.equal(flow(s).id,id);assert.deepEqual(flow(s).params.answers,[3,0,0]);assert.equal(s.plan!.status,'running');
});
test('a temporary query completes and returns to the exact saved checklist without rewriting its answers',()=>{
 let s=startApp(initialState(),'IN05','开始做风险测评');s=amendApp(s,{answers:[3,0,0]},'第一题选三');
 const p=s.plan!.id,id=flow(s).id,evidence=structuredClone(flow(s).fieldEvidence);
 s=startApp(s,'SU01','先查询订阅清单');
 assert.equal(s.plan!.id,p);assert.equal(s.workflows!.currentTaskId,id);assert.deepEqual(flow(s).params.answers,[3,0,0]);assert.deepEqual(flow(s).fieldEvidence,evidence);
 assert.match(s.lastReply,/查看订阅清单和详情”：查询完成/);assert.equal(s.plan!.steps.filter(x=>x.functionId==='SU01'&&x.status==='complete').length,1);assert.equal(s.plan!.returnTo,undefined);
 assert.equal(s.workflows!.records.questionnaires.length,0);
});
test('unfinished inserted work can be selected, restored and cancelled across reloads',()=>{
 let s=startApp(initialState(),'IN05','开始做风险测评');s=amendApp(s,{answers:[3,0,0]},'第一题选三');const root=s.plan!.id,risk=flow(s).id;
 s=startApp(s,'IN01','创建储蓄目标读书计划2000元',{name:'读书计划',target:2000});const temporary=s.plan!.id,goal=flow(s).id;
 s=app(s,resumeAction(s,'继续原来的风险测评')!);assert.equal(s.plan!.id,root);assert.equal(flow(s).id,risk);assert.equal(temporary,root);assert.ok(s.plan!.taskIds!.includes(goal));
 s=JSON.parse(JSON.stringify(s));s=app(s,{type:'workflow',command:{operation:'resume',taskId:goal,source:'card'}});
 assert.equal(s.plan!.id,temporary);assert.equal(flow(s).id,goal);assert.equal(flow(s).params.target,2000);assert.equal(s.plan!.returnTo,undefined);assert.equal(s.plan!.id,root);
 s=app(s,{type:'workflow',command:{operation:'cancel',taskId:goal,source:'card'}});assert.equal(s.plan!.id,root);assert.equal(flow(s).id,risk);assert.deepEqual(flow(s).params.answers,[3,0,0]);
 assert.equal(s.workflows!.tasks.find(t=>t.id===goal)!.status,'cancelled');
});
test('inserted tasks finish in queue order and an explicitly paused original stays paused',()=>{
 let s=startApp(initialState(),'IN05','开始做风险测评');const root=s.plan!.id;
 s=plan(s,{operation:'pause',planId:root});s=startApp(s,'IN01','创建储蓄目标读书计划',{name:'读书计划'});const middle=s.plan!.id,goal=flow(s).id;
 s=startApp(s,'CA01','先查看银行卡列表');assert.equal(s.plan!.id,middle);assert.equal(flow(s).id,goal);
 s=app(s,{type:'workflow',command:{operation:'cancel',taskId:goal,source:'card'}});assert.equal(s.plan!.id,root);assert.equal(s.plan!.status,'paused');assert.match(s.lastReply,/仍暂停/);
});
test('inner completion checks the plan and opens the next task, but collection and review cannot advance',()=>{
 let s=create('先做风险测评，然后查订阅');const p=s.plan!.id,risk=flow(s).id;
 s=amendApp(s,{answers:[3,0,0]},'第一题选三');assert.equal(s.workflows!.tasks.find(t=>t.id===s.plan!.steps[1].taskId)!.status,'queued');
 s=amendApp(s,{answers:[3,2,1]},'三题答案是3、2、1');assert.equal(flow(s).status,'review');assert.equal(s.workflows!.tasks.find(t=>t.id===s.plan!.steps[1].taskId)!.status,'queued');
 s=confirm(s);assert.equal(s.plan!.id,p);assert.equal(s.plan!.status,'complete');assert.equal(s.plan!.steps[0].taskId,risk);assert.equal(s.plan!.steps[1].status,'complete');
 assert.equal(s.workflows!.records.questionnaires.length,1);const next=s.plan!.steps[1].taskId;
 assert.ok(next);assert.notEqual(next,risk);
});
test('automatic task switching does not reuse a confirmation for another write and blocks authentication interruption',()=>{
 let s=create('先做风险测评，然后创建储蓄目标');s=amendApp(s,{answers:[3,2,1]},'三题答案是3、2、1');
 const old=flow(s),turn=crypto.randomUUID();s=act(s,{type:'workflow',command:{operation:'confirm',taskId:old.id,token:old.reviewToken!,source:'voice',utterance:'确认',turnId:turn}});
 const goal=flow(s);assert.equal(goal.functionId,'IN01');assert.equal(s.workflows!.records.goals.length,1);
 s=act(s,{type:'workflow',command:{operation:'amend',taskId:goal.id,params:{name:'读书计划',target:2000,deadline:'2027-06-01'},source:'card'}});
 assert.throws(()=>app(s,{type:'workflow',command:{operation:'confirm',taskId:goal.id,token:flow(s).reviewToken!,source:'voice',utterance:'确认',turnId:turn}}));
 assert.throws(()=>app(s,{type:'workflow',command:{operation:'confirm',taskId:goal.id,token:old.reviewToken!,source:'voice',utterance:'确认',turnId:turn}}));
 s=create('先从日常账户给室友转500元，然后查订阅');s=confirm(s);assert.throws(()=>startApp(s,'SU01','先查询订阅清单'));
});
test('explicit task recovery bypasses model draft repair and never writes preserved answers',async()=>{
 let s=startApp(initialState(),'IN05','开始做风险测评');s=amendApp(s,{answers:[3,0,0]},'第一题选三');const root=s.plan!.id;
 s=startApp(s,'IN01','创建储蓄目标读书计划',{name:'读书计划'});
 const a=await recoverDraft(s,{utterance:'继续原来的风险测评',reason:'no_call',turnId:'return-turn'}, {base:'invalid',planner:'x'},undefined,async()=>{throw Error('must not need Flash for an unambiguous saved task');});
 s=app(s,a!);assert.equal(s.plan!.id,root);assert.deepEqual(flow(s).params.answers,[3,0,0]);
 const noop=recoveryAction(s,{utterance:'保留第一题答案',reason:'no_call',turnId:'noop'}, {operation:'amend',taskId:flow(s).id,params:{answers:[3,0,0]}})!;
 s=app(s,noop);assert.deepEqual(flow(s).params.answers,[3,0,0]);
});
test('incorrect cross-domain routes cannot replace a plan or create a financial draft',()=>{
 const s=startApp(initialState(),'IN05','开始做风险测评');
 for(const id of ['IN08','CA05'])assert.throws(()=>startApp(s,id,'查2026年10月餐饮支出，只查询。',{period:'2026-10'}));
 assert.equal(s.plan!.steps.length,1);assert.equal(s.workflows!.tasks.length,1);
});
test('one-item plan validates fields against the right function and cannot treat proposed values as saved evidence',()=>{
 let s=startApp(initialState(),'IN05','我有没有做过风险测评？',{action:'status'});
 assert.equal(s.plan!.status,'complete');assert.equal(s.plan!.steps[0].result&& (s.plan!.steps[0].result as any).assessmentState,'not_found');
 assert.throws(()=>startApp(initialState(),'IN01','创建储蓄目标',{name:'模型编造的名字',target:9876}));
 assert.throws(()=>startApp(initialState(),'IN05','开始做风险测评',{answers:[5,5,5]}));
});
test('one hundred query interruptions and serialized reloads retain the same questionnaire and never submit it',()=>{
 let s=startApp(initialState(),'IN05','开始做风险测评');s=amendApp(s,{answers:[3,0,0]},'第一题选三');const p=s.plan!.id,id=flow(s).id;
 for(let i=0;i<100;i++){
  s=startApp(s,i%2?'CA01':'SU01',i%2?'先查看银行卡列表':'先查询订阅清单');s=JSON.parse(JSON.stringify(s));
  assert.equal(s.plan!.id,p);assert.equal(s.workflows!.currentTaskId,id);assert.deepEqual(flow(s).params.answers,[3,0,0]);assert.equal(s.plan!.status,'running');assert.equal(s.workflows!.records.questionnaires.length,0);
 }
 assert.ok(s.workflows!.tasks.length<=32);assert.ok(s.plan!.steps.length<=31);assert.equal(s.plan!.returnTo,undefined);
 s=amendApp(s,{answers:[3,2,0]},'第二题选二');s=amendApp(s,{answers:[3,2,1]},'第三题选一');s=confirm(s);
 assert.equal(s.plan!.status,'complete');assert.equal(s.workflows!.records.questionnaires.length,1);
});
test('plan decomposition distinguishes querying a risk record from starting a questionnaire',()=>{
 const s=create('我有没有做过风险测评？');assert.equal(s.plan!.status,'complete');assert.equal(s.plan!.steps[0].params.action,'status');
 const t=create('开始做风险测评');assert.equal(t.plan!.steps[0].status,'collecting');assert.equal(t.plan!.steps[0].params.action,undefined);
});
test('a run continuing the same business cannot replace the original partially filled checklist',()=>{
 let s=startApp(initialState(),'IN05','开始做风险测评');s=amendApp(s,{answers:[3,0,0]},'第一题选三');const id=flow(s).id;
 s=startApp(s,'IN05','好，开始做风险测评');assert.equal(flow(s).id,id);assert.deepEqual(flow(s).params.answers,[3,0,0]);assert.equal(s.plan!.returnTo,undefined);
});
test('a grounded edit selects its saved task atomically while another draft is active',()=>{
 let s=startApp(initialState(),'IN05','开始做风险测评');s=amendApp(s,{answers:[3,0,0]},'第一题选三');const id=flow(s).id;
 s=startApp(s,'IN01','创建储蓄目标读书计划',{name:'读书计划'});const goal=flow(s).id;
 s=app(s,{type:'workflow',command:{operation:'amend',taskId:id,params:{answers:[3,2,0]},source:'voice',utterance:'第二题选二'}});
 assert.equal(flow(s).id,id);assert.deepEqual(flow(s).params.answers,[3,2,0]);assert.ok(s.plan!.taskIds!.includes(goal));
});
test('unfinished inserted work runs next after completion and survives another query',()=>{
 let s=startApp(initialState(),'IN05','开始做风险测评');const root=s.plan!.id;
 s=startApp(s,'IN01','创建储蓄目标读书计划',{name:'读书计划'});const goal=flow(s).id;
 s=app(s,resumeAction(s,'继续原来的风险测评')!);s=amendApp(s,{answers:[3,2,1]},'三题答案是3、2、1');s=confirm(s);assert.equal(s.plan!.status,'running');assert.equal(flow(s).id,goal);
 s=startApp(s,'CA01','查看银行卡列表');assert.equal(s.plan!.id,root);s=app(s,{type:'workflow',command:{operation:'resume',taskId:goal,source:'card'}});
 assert.equal(flow(s).id,goal);assert.equal(flow(s).params.name,'读书计划');assert.equal(s.workflows!.records.questionnaires.length,1);
});
test('restoring a pre-plan saved draft adopts its task ID and evidence without asking for old answers again',()=>{
 let s=act(initialState(),{type:'workflow',command:{operation:'run',functionId:'IN05',params:{answers:[3,0,0]},source:'card'}});const id=s.workflows!.currentTaskId!;
 assert.equal(s.plan,undefined);s=app(s,{type:'workflow',command:{operation:'resume',taskId:id,source:'voice',utterance:'继续风险测评'}});
 assert.ok(s.plan);assert.equal(flow(s).id,id);assert.deepEqual(flow(s).params.answers,[3,0,0]);assert.equal(s.workflows!.tasks.length,1);
});
test('public model and card schemas cannot forge adoption of saved fields',()=>{
 assert.equal(planToolArguments.safeParse({operation:'create',adoptTaskId:crypto.randomUUID()}).success,false);
});
test('an inserted goal uses its deadline as a deadline, never an unsupported billing period',()=>{
 let s=startApp(initialState(),'IN05','开始做风险测评');const root=s.plan!.id;
 const text='创建一个储蓄目标，名称读书计划，目标2000元，截止2027-06-01，不要自动存钱。先给我看草稿，不确认。';
 s=plan(s,{operation:'interrupt',planId:root,utterance:text,steps:[{quote:text,functionId:'IN01'}]});
 assert.equal(flow(s).functionId,'IN01');assert.equal(flow(s).status,'review');assert.deepEqual(flow(s).params,{name:'读书计划',target:2000,deadline:'2027-06-01',autoSave:false});assert.equal(s.plan!.returnTo,undefined);assert.equal(s.plan!.id,root);
});
test('multiple inserted tasks stay in one queue and are selectable across reloads',()=>{
 let s=startApp(initialState(),'IN05','开始做风险测评');const root=s.plan!.id,risk=flow(s).id;
 s=startApp(s,'IN01','创建储蓄目标读书计划',{name:'读书计划'});const goal=flow(s).id;
 s=startApp(s,'CA06','准备冻结日常借记卡',{action:'freeze',cardId:'card-daily'});const card=flow(s).id;
 for(const taskId of [goal,risk,card]){s=JSON.parse(JSON.stringify(s));s=app(s,{type:'workflow',command:{operation:'resume',taskId,source:'card'}});assert.equal(flow(s).id,taskId);assert.equal(s.plan!.id,root);}
 s=app(s,{type:'workflow',command:{operation:'cancel',taskId:card,source:'card'}});assert.equal(flow(s).id,risk);
 assert.equal(s.workflows!.records.cards.find(c=>c.id==='card-daily')!.status,'active');assert.equal(s.plan!.returnTo,undefined);
});

test('all business instances exist before activation, queued edits save evidence and keep identity',()=>{
 let s=create('先做风险测评，然后创建储蓄目标');const ids=[...s.plan!.taskIds!],future=s.plan!.steps[1].taskId!,before=structuredClone(s.workflows!.records);
 assert.equal(ids.length,2);assert.equal(future,s.plan!.steps[1].id);let task=s.workflows!.tasks.find(t=>t.id===future)!;
 assert.equal(task.status,'queued');assert.equal(task.reviewToken,null);assert.equal(task.result,null);assert.ok(task.steps.every(x=>x.status==='pending'));
 s=app(s,{type:'workflow',command:{operation:'amend',taskId:future,params:{name:'读书计划',target:2000,deadline:'2027-06-01'},source:'card'}});
 task=s.workflows!.tasks.find(t=>t.id===future)!;assert.equal(task.status,'queued');assert.equal(task.fieldEvidence!.target.source,'user-card');assert.equal(task.reviewToken,null);assert.deepEqual(s.workflows!.records,before);assert.equal(flow(s).functionId,'IN05');
 s=amendApp(s,{answers:[3,2,1]},'三题答案是3、2、1');s=confirm(s);assert.equal(flow(s).id,future);assert.equal(flow(s).status,'review');assert.deepEqual(s.plan!.taskIds,ids);assert.equal(s.workflows!.records.goals.some(g=>g.name==='读书计划'),false);
});
test('omitted Plan and current Task IDs work while wrong IDs and dependency skipping are rejected',()=>{
 let s=create('先做风险测评，然后查订阅');
 s=app(s,{type:'workflow',command:{operation:'amend',params:{answers:[3,0,0]},source:'voice',utterance:'第一题选三'}});assert.deepEqual(flow(s).params.answers,[3,0,0]);
 s=plan(s,{operation:'interrupt',functionId:'CA01',utterance:'查看银行卡列表'});assert.equal(flow(s).functionId,'IN05');
 assert.throws(()=>plan(s,{operation:'resume',planId:crypto.randomUUID()}));assert.throws(()=>plan(s,{operation:'resume',taskId:crypto.randomUUID()}));
 assert.throws(()=>plan(s,{operation:'resume',taskId:s.plan!.steps.find(x=>x.functionId==='SU01')!.taskId}));
 s=app(s,recoveryAction(s,{utterance:'第二题选二',turnId:'fallback',reason:'tool_error'},{operation:'amend',params:{answers:[3,2,0]}})!);assert.deepEqual(flow(s).params.answers,[3,2,0]);
});
test('legacy nested plans flatten once without replaying completed business or losing drafts',()=>{
 let root=create('开始做风险测评');root=amendApp(root,{answers:[3,0,0]},'第一题选三');const risk=flow(root).id,old=structuredClone(root.plan!);delete old.version;
 let temporary=create('创建储蓄目标');const goal=flow(temporary).id;temporary.workflows!.tasks.push(...root.workflows!.tasks);delete temporary.plan!.version;temporary.plan!.returnTo=old;
 const legacyRead={...structuredClone(old.steps[0]),id:crypto.randomUUID(),taskId:crypto.randomUUID(),functionId:'TR02',status:'complete' as const,params:{},result:[]};temporary.plan!.steps.unshift(legacyRead);
 temporary=plan(temporary,{operation:'resume',taskId:risk,source:'card'});assert.equal(flow(temporary).id,risk);assert.deepEqual(flow(temporary).params.answers,[3,0,0]);assert.ok(temporary.plan!.taskIds!.includes(goal));assert.equal(temporary.plan!.returnTo,undefined);assert.equal(temporary.workflows!.tasks.some(t=>t.id===legacyRead.taskId),false);
});

test('verbatim model clauses may include original ordering words',()=>{
 const s=plan(initialState(),{operation:'create',utterance:'先查询理财产品，然后做风险测评，最后查询订阅清单。',tasks:[{quote:'先查询理财产品',functionId:'IN06'},{quote:'然后做风险测评',functionId:'IN05'},{quote:'最后查询订阅清单',functionId:'SU01'}]});
 assert.deepEqual(s.plan!.steps.map(x=>x.functionId),['IN06','IN05','SU01']);assert.equal(flow(s).functionId,'IN05');assert.equal(s.workflows!.tasks.find(t=>t.functionId==='SU01')!.status,'queued');
});

test('cancelling one task through Plan cannot silently cancel the entire queue',()=>{
 let s=startApp(initialState(),'IN05','开始做风险测评');const risk=flow(s).id;
 s=startApp(s,'IN01','创建储蓄目标读书计划',{name:'读书计划'});const goal=flow(s).id;
 s=plan(s,{operation:'cancel',taskId:goal,utterance:'取消这份读书计划草稿'});assert.equal(flow(s).id,risk);assert.equal(s.workflows!.tasks.find(t=>t.id===goal)!.status,'cancelled');assert.equal(flow(s).status,'collecting');
 assert.throws(()=>plan(s,{operation:'cancel',taskId:crypto.randomUUID(),utterance:'取消这项'}));
});

test('editing a queued ratio task saves a fixed override without changing identity or running the calculation early',()=>{
 let s=create('先做风险测评，然后从日常账户给室友转余额的一半');const transfer=s.plan!.steps.find(x=>x.functionId==='TR03')!,id=transfer.taskId!,calc=transfer.binding!;
 s=plan(s,{operation:'amend',taskId:id,params:{amount:500,accountId:'daily'},source:'card'});
 assert.equal(s.workflows!.tasks.find(t=>t.id===id)!.status,'queued');assert.equal(s.plan!.steps.find(x=>x.id===calc)!.calculation,undefined);assert.equal(s.task,null);
 s=amendApp(s,{answers:[3,2,1]},'三题答案是3、2、1');s=confirm(s);assert.equal(flow(s).id,id);assert.equal(flow(s).status,'review');assert.equal(flow(s).params.amount,500);assert.equal(s.receipts.length,0);
});

test('a targeted answer uses that task saved answers while another draft is current',()=>{
 let s=startApp(initialState(),'IN05','开始做风险测评');s=amendApp(s,{answers:[3,0,0]},'第一题选三');const risk=flow(s).id;
 s=startApp(s,'IN01','创建储蓄目标读书计划',{name:'读书计划'});const goal=flow(s).id;
 s=plan(s,{operation:'amend',taskId:risk,utterance:'第二题选二'});assert.equal(flow(s).id,risk);assert.deepEqual(flow(s).params.answers,[3,2,0]);assert.equal(s.workflows!.tasks.find(t=>t.id===goal)!.status,'collecting');
});

test('a checklist untouched for a while does not absorb a new request',()=>{
 let s=startApp(initialState(),'IN01','创建储蓄目标读书计划',{name:'读书计划'});const old=s.plan!.id,oldTask=flow(s).id;
 s=structuredClone(s);for(const e of s.plan!.log)e.at=new Date(Date.now()-11*60*1000).toISOString();s.plan!.createdAt=s.plan!.log[0].at;
 s=startApp(s,'CA01','先查看银行卡列表');
 assert.notEqual(s.plan!.id,old);assert.equal(s.plan!.steps.length,1);assert.equal(s.plan!.steps[0].functionId,'CA01');
 assert.ok(['collecting','queued'].includes(s.workflows!.tasks.find(t=>t.id===oldTask)!.status));
});

test('a new request does not join a checklist whose card is blocked, so the blocked card never comes back by itself',()=>{
 let s=app(initialState(),{type:'workflow',command:{operation:'run',functionId:'IN08',params:{productId:'fund-cash',accountId:'daily',amount:5000000},source:'card'}});const old=s.plan!.id;
 const blocked=s.workflows!.tasks.find(t=>t.functionId==='IN08')!;assert.equal(blocked.status,'blocked');
 s=startApp(s,'CA01','先查看银行卡列表');
 assert.notEqual(s.plan!.id,old);assert.deepEqual(s.plan!.steps.map(x=>x.functionId),['CA01']);assert.equal(s.plan!.status,'complete');
});

test('money into one\'s own savings goal becomes the goal\'s rule, never a transfer that asks for a payee',()=>{
 const s=initialState(),route=(functionId:string,params:Record<string,unknown>,text:string)=>{const a=dispatchAction(s,{type:'workflow',command:{operation:'run',functionId,params,source:'card',utterance:text}},text);assert.ok(a.type==='workflow'||a.type==='plan');return a.command as {functionId?:string;params?:Record<string,unknown>};};
 const recurring=route('TR04',{action:'create',accountId:'daily',amount:1000,schedule:'每月10号'},'每月10号发工资后，自动转1000进旅游储蓄');
 assert.equal(recurring.functionId,'IN04');assert.deepEqual(recurring.params,{action:'update',goalId:'goal-travel',accountId:'daily',amount:1000,schedule:'每月10号'});
 assert.equal(route('TR03',{amount:500},'把500存进旅行目标').functionId,'IN02');
 for(const text of ['从日常账户转500到储蓄账户','给张三转1000'])assert.equal(route('TR03',{amount:500},text).functionId,'TR03');
 // A model that already picked the goal business but filed the sum as the goal's total.
 assert.deepEqual(route('IN04',{target:1000,schedule:'每月10号'},'每月10号发工资后，自动转1000进旅游储蓄').params,{action:'update',goalId:'goal-travel',amount:1000,schedule:'每月10号'});
 // No goal yet: open one carrying the rule instead of a goal picker with nothing in it.
 const empty=structuredClone(s);empty.workflows!.records.goals=[];
 const a=dispatchAction(empty,{type:'workflow',command:{operation:'run',functionId:'TR04',params:{amount:1000,schedule:'每月10号'},source:'card',utterance:'每月10号自动转1000进旅游储蓄'}},'每月10号自动转1000进旅游储蓄');
 assert.ok(a.type==='workflow'||a.type==='plan');assert.equal(a.command.functionId,'IN01');assert.deepEqual(a.command.params,{name:'旅游储蓄',autoSave:true,amount:1000,schedule:'每月10号'});
});
