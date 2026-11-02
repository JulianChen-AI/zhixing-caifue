import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduceBank } from '../lib/bank/engine.ts';
import type { BankState } from '../lib/bank/types.ts';
import { USER_FUNCTIONS, LOGICAL_TOOLS } from '../lib/workflows/catalog.ts';
import { currentWorkflow } from '../lib/workflows/engine.ts';
import { workflowToolArguments, workflowToolResult } from '../lib/workflows/realtime.ts';
import { normalizedParams } from '../lib/workflows/fields.ts';
import { workflowReview } from '../lib/workflows/review.ts';
import type { Params, WorkflowCommand } from '../lib/workflows/types.ts';
import { readTool } from '../lib/workflows/adapters.ts';
import { bankToolResult } from '../lib/bank/realtime-tools.ts';
import { offlineWorkflow, workflowTextAction, explicitWorkflowConfirmation, explicitLiveCommand, explicitWorkflowCancellation } from '../lib/workflows/offline.ts';
const act=(s:BankState,command:Omit<WorkflowCommand,'source'> & {source?:'card'|'voice'},requestId:string=crypto.randomUUID())=>reduceBank(s,{type:'workflow',command:{source:'card',...command}},requestId);
const run=(s:BankState,id:string,params:Params={})=>act(s,{operation:'run',functionId:id,params});
function finish(s:BankState){let t=currentWorkflow(s)!;assert.equal(t.status,'review',t.message);s=act(s,{operation:'confirm',taskId:t.id,token:t.reviewToken!});t=currentWorkflow(s)!;if(t.status==='authenticate')s=act(s,{operation:'authenticate',taskId:t.id,token:t.verificationId!,code:'123456'});return s;}
const row=(s:BankState,kind:string,id:string)=>s.workflows!.records[kind].find(r=>r.id===id)!;

test('direct voice confirmation uses only a literal acknowledgement and the current visible review token',()=>{
 let s=run(initialState(),'CA06',{action:'freeze',cardId:'card-daily'}),task=currentWorkflow(s)!;
 for(const text of ['确认','确认冻结。','好的'])assert.deepEqual(explicitWorkflowConfirmation(s,text),{operation:'confirm',taskId:task.id,token:task.reviewToken});
 for(const text of ['确认解冻','不确认','确认吗？','确认，但改成储蓄卡','继续','123456'])assert.equal(explicitWorkflowConfirmation(s,text),undefined);
 assert.equal(explicitWorkflowConfirmation({...s,view:'home'},'确认'),undefined);
 s=act(s,{operation:'confirm',taskId:task.id,token:task.reviewToken!});assert.equal(explicitWorkflowConfirmation(s,'确认冻结'),undefined);
 const changed=act(s,{operation:'amend',taskId:task.id,params:{cardId:'card-risk'}});assert.notEqual(explicitWorkflowConfirmation(changed,'确认')!.token,task.reviewToken);
});

test('literal transfer confirmations and cancellations bind the visible draft and reject edits or negation',()=>{
 const s=run(initialState(),'TR03',{accountId:'daily',recipientId:'zhang-roommate',amount:500}),task=currentWorkflow(s)!;
 for(const text of ['确认转账','确认这笔转账','确认当前这笔转账','确认当前这项'])assert.deepEqual(explicitLiveCommand(s,text),{operation:'confirm',taskId:task.id,token:task.reviewToken});
 for(const text of ['不确认转账','确认这笔转账吗？','确认这笔转账，改成300元','如果确认这笔转账'])assert.equal(explicitLiveCommand(s,text),undefined,text);
 assert.deepEqual(explicitWorkflowCancellation(s,'不转了，取消这笔'),{operation:'cancel',taskId:task.id});
 for(const text of ['不要取消这笔转账','如果不转了','不转了，取消这笔，改转300元'])assert.equal(explicitWorkflowCancellation(s,text),undefined,text);
 assert.equal(explicitWorkflowCancellation(s,'不转了，取消这笔','another-task'),undefined);
 assert.equal(explicitLiveCommand({...s,view:'home'},'确认这笔转账'),undefined);
});

test('literal card queries are read-only shortcuts and cannot absorb negations or a compound write request',()=>{
 const s=initialState();for(const text of ['查看银行卡列表和当前状态。','我有哪些银行卡？','查银行卡'])assert.deepEqual(explicitLiveCommand(s,text),{operation:'run',functionId:'CA01',params:{}});
 for(const text of ['不要查银行卡','查银行卡并冻结','看看卡片，先转500','确认冻结','继续'])assert.equal(explicitLiveCommand(s,text),undefined);
});

test('card aliases select one card and conflicting tails or negated freeze instructions cannot authorize a draft',()=>{
 const s=act(initialState(),{operation:'run',functionId:'CA06',params:{action:'freeze',cardId:'card-daily'},source:'voice',utterance:'冻结日常卡'});assert.equal(currentWorkflow(s)!.status,'review');
 for(const utterance of ['冻结日常卡尾号3609','冻结日常卡尾号802','不要冻结日常借记卡','别冻住日常借记卡'])assert.throws(()=>act(initialState(),{operation:'run',functionId:'CA06',params:{action:'freeze',cardId:'card-daily'},source:'voice',utterance}),utterance);
});

test('fund and card reviews return exact confirmation requests and action choices rather than transfer instructions',()=>{
 let s=finish(run(initialState(),'IN05',{answers:[3,3,3]}));s=run(s,'IN08',{productId:'fund-bond',accountId:'daily',amount:100});
 const t=currentWorkflow(s)!,facts=bankToolResult(s),workflow=workflowToolResult(s)!;
 assert.equal(facts.instruction,workflow.instruction);assert.equal(workflow.nextAction,'review_current_summary');assert.deepEqual(workflow.confirmationRequest,{name:'bank_function',arguments:{operation:'confirm',taskId:t.id,token:t.reviewToken}});
 const card=workflowToolResult(run(initialState(),'CA06'))!;assert.deepEqual(card.fields.find(f=>f.key==='action')!.choices.map(c=>c.value),['freeze','unfreeze']);
 assert.deepEqual(facts.cards!.map(c=>[c.id,c.tail]),[['card-daily','8021'],['card-risk','3609'],['card-judicial','9012']]);
});

test('a read-only side query retains enough pending fund facts to resume the original summary',()=>{
 let s=finish(run(initialState(),'IN05',{answers:[3,3,3]}));s=run(s,'IN08',{productId:'fund-bond',accountId:'daily',amount:100});const t=currentWorkflow(s)!;
 s=run(s,'IN06');const pending=workflowToolResult(s)!.pendingTasks.find(p=>p.taskId===t.id)!;
 assert.equal(pending.params.productId,'fund-bond');assert.equal(pending.confirmationRequest!.arguments.token,t.reviewToken);assert.equal(pending.nextAction,'review_current_summary');
});

test('plain confirmations continue the current bond task and never submit without page authentication',()=>{
 let s=finish(run(initialState(),'IN05',{answers:[3,3,3]}));s=run(s,'IN08',{productId:'fund-bond',accountId:'daily',amount:100});const id=currentWorkflow(s)!.id;
 assert.equal(workflowTextAction(s,'不要确认'),null);s=act(s,workflowTextAction(s,'确认')!);
 assert.equal(currentWorkflow(s)!.id,id);assert.equal(currentWorkflow(s)!.status,'authenticate');assert.equal(s.workflows!.records.orders.length,0);
 s=act(s,workflowTextAction(s,'确认')!);assert.equal(currentWorkflow(s)!.status,'authenticate');assert.throws(()=>workflowTextAction(s,'123456'),/专门卡片/);
 s=act(s,{operation:'authenticate',taskId:id,token:currentWorkflow(s)!.verificationId!,code:'123456'});assert.equal(s.workflows!.records.orders.length,1);assert.equal(s.workflows!.records.orders[0].status,'pending');
});

test('card selection and fund product replies amend the existing checklist instead of creating another task',()=>{
 let s=act(initialState(),offlineWorkflow('冻结银行卡',initialState())!);const id=currentWorkflow(s)!.id;
 s=act(s,workflowTextAction(s,'日常卡')!);assert.equal(currentWorkflow(s)!.id,id);assert.equal(currentWorkflow(s)!.params.cardId,'card-daily');assert.equal(currentWorkflow(s)!.status,'review');
 assert.throws(()=>workflowTextAction(s,'确认解冻'));s=act(s,workflowTextAction(s,'确认冻结')!);assert.equal(currentWorkflow(s)!.status,'authenticate');
 let fund=run(initialState(),'IN08');const fundId=currentWorkflow(fund)!.id;fund=act(fund,workflowTextAction(fund,'演示债券基金')!);assert.equal(currentWorkflow(fund)!.id,fundId);assert.equal(currentWorkflow(fund)!.params.productId,'fund-bond');assert.ok(currentWorkflow(fund)!.missing.includes('amount'));
});

test('four-layer catalog covers 54 unique functions and 85 unique logical tools; every reference resolves',()=>{
 assert.equal(USER_FUNCTIONS.length,54);assert.equal(new Set(USER_FUNCTIONS.map(f=>f.id)).size,54);assert.equal(LOGICAL_TOOLS.length,85);assert.equal(new Set(USER_FUNCTIONS.map(f=>f.moduleId)).size,5);
 for(const f of USER_FUNCTIONS)for(const id of f.tools)assert.ok(LOGICAL_TOOLS.some(t=>t.id===id),id);
});
test('shared concrete readers are reusable without mutating state; catalog write IDs cannot bypass checklists',()=>{
 const s=initialState(),before=structuredClone(s);assert.equal((readTool(s,'T02',{accountId:'daily'})as {balance:number}[])[0].balance,1286500);assert.equal((readTool(s,'C01')as unknown[]).length,3);assert.deepEqual(s,before);assert.throws(()=>readTool(s,'T07',{amount:100}));
});
test('draft previews cannot be mistaken for committed business results in model facts',()=>{
 const s=run(initialState(),'IN01',{name:'旅行',target:3000,deadline:'2027-06-01'});const r=workflowToolResult(s)!;assert.equal(r.result,undefined);assert.ok(r.preview);assert.equal(r.effectCommitted,false);assert.equal(r.needsUserConfirmation,true);
 assert.deepEqual(r.missing,[]);assert.equal(r.fields.find(f=>f.key==='accountId')!.required,false);assert.ok(!r.requiredFields.includes('accountId'));
});
test('every catalog entry opens a real sandbox query, collecting draft or explicit unavailable result',()=>{
 for(const f of USER_FUNCTIONS){const s=run(initialState(),f.id);assert.ok(['collecting','complete','unsupported','review'].includes(currentWorkflow(s)!.status),f.id+': '+currentWorkflow(s)!.message);}
});
test('optional note is skipped; a supplied note persists across omitted patches and null explicitly clears',()=>{
 let s=run(initialState(),'TR03',{recipientId:'zhang-roommate',accountId:'daily',amount:500});let t=currentWorkflow(s)!;assert.equal(t.status,'review');assert.equal(t.steps.find(x=>x.toolId==='T16')!.status,'skipped');assert.equal(s.task!.note,'');
 s=act(s,{operation:'amend',taskId:t.id,params:{note:'饭钱'}});assert.equal(s.task!.note,'饭钱');
 s=act(s,{operation:'amend',taskId:t.id,params:{amount:300}});assert.equal(s.task!.note,'饭钱');
 s=act(s,{operation:'amend',taskId:t.id,params:{note:null}});assert.equal(s.task!.note,'');
 s=finish(s);assert.equal(s.receipts.length,1);assert.equal(s.accounts[0].balance,1256500);
 assert.equal(s.workflows!.records.contacts.length,0);assert.equal(s.workflows!.records.transactions.filter(r=>r.relatedId===s.task!.id).length,1);
});
test('edits invalidate current summary and old authentication, duplicate requests only debit once',()=>{
 let s=run(initialState(),'TR03',{recipientId:'li-friend',accountId:'savings',amount:50});const t=currentWorkflow(s)!,old=t.reviewToken!;
 s=act(s,{operation:'confirm',taskId:t.id,token:old});const auth=currentWorkflow(s)!.verificationId!;
 s=act(s,{operation:'amend',taskId:t.id,params:{amount:30}});
 assert.throws(()=>act(s,{operation:'confirm',taskId:t.id,token:old}));assert.throws(()=>act(s,{operation:'authenticate',taskId:t.id,token:auth,code:'123456'}));
 s=act(s,{operation:'confirm',taskId:t.id,token:currentWorkflow(s)!.reviewToken!});const cmd={operation:'authenticate' as const,taskId:t.id,token:currentWorkflow(s)!.verificationId!,code:'123456'};const done=act(s,cmd,'duplicate-flow-request');assert.deepEqual(act(done,cmd,'duplicate-flow-request'),done);assert.equal(done.accounts[1].balance,2997000);
});

test('unchanged voice amendments and repeated confirmation preserve workflow authorization but card back still edits',()=>{
 for(const [id,params]of [['IN02',{direction:'deposit',goalId:'goal-travel',accountId:'daily',amount:100}],['TR03',{recipientId:'zhang-roommate',accountId:'daily',amount:100}]]as [string,Params][]){
  let s=run(initialState(),id,params);const taskId=currentWorkflow(s)!.id,token=currentWorkflow(s)!.reviewToken!;
  s=act(s,{operation:'amend',taskId,params:{amount:100},source:'voice',utterance:'100元'});
  assert.equal(currentWorkflow(s)!.reviewToken,token);
  s=act(s,{operation:'confirm',taskId,token,source:'voice',utterance:'确认'});const auth=currentWorkflow(s)!.verificationId!;
  for(const utterance of ['改成100美元','改成余额三分之一'])assert.throws(()=>act(s,{operation:'amend',taskId,params:{amount:100},source:'voice',utterance}));
  s=act(s,{operation:'amend',taskId,params:{amount:100},source:'voice',utterance:'还是100元'});
  assert.equal(currentWorkflow(s)!.status,'authenticate');assert.equal(currentWorkflow(s)!.verificationId,auth);
  s=act(s,{operation:'confirm',taskId,token,source:'voice',utterance:'确认'});assert.equal(currentWorkflow(s)!.verificationId,auth);
  s=act(s,{operation:'resume',taskId});assert.equal(currentWorkflow(s)!.verificationId,auth);
  s=act(s,{operation:'amend',taskId,params:{}});assert.equal(currentWorkflow(s)!.status,'review');assert.equal(currentWorkflow(s)!.verificationId,null);
  assert.equal(s.receipts.length,0);assert.equal(s.accounts[0].balance,1286500);
 }
});

test('an unchanged amendment must recheck current balance before retaining authorization',()=>{
 for(const [id,params]of [['IN02',{direction:'deposit',goalId:'goal-travel',accountId:'daily',amount:100}],['TR03',{recipientId:'zhang-roommate',accountId:'daily',amount:100}]]as [string,Params][]){
 let s=run(initialState(),id,params);const t=currentWorkflow(s)!;
 s=act(s,{operation:'confirm',taskId:t.id,token:t.reviewToken!});const auth=currentWorkflow(s)!.verificationId!;
 s.accounts[0].balance=100;
 s=act(s,{operation:'amend',taskId:t.id,params:{amount:100},source:'voice',utterance:'100元'});
 assert.equal(currentWorkflow(s)!.status,'blocked');assert.equal(currentWorkflow(s)!.verificationId,null);
 assert.throws(()=>act(s,{operation:'authenticate',taskId:t.id,token:auth,code:'123456'}));
 }
});

test('explicit monetary conflicts cannot become a different amount',()=>{
 for(const [amount,utterance]of [[50,'从日常账户给室友转500元'],[100,'从日常账户给室友转100美元']]as const){
  assert.throws(()=>act(initialState(),{operation:'run',functionId:'TR03',params:{recipientId:'zhang-roommate',accountId:'daily',amount},source:'voice',utterance}));
 }
});

test('workflow recipient identity uses all stated constraints rather than the first matching label',()=>{
 assert.throws(()=>act(initialState(),{operation:'run',functionId:'TR03',params:{recipientId:'zhang-roommate',accountId:'daily',amount:100},source:'voice',utterance:'从日常账户给室友张三尾号2910转100元'}));
 const s=act(initialState(),{operation:'run',functionId:'TR03',params:{recipientId:'zhang-roommate',accountId:'daily',amount:500},source:'voice',utterance:'从尾号8021的账户给尾号6688的张三转500元'});assert.equal(currentWorkflow(s)!.status,'review');assert.equal(s.task!.amount,50000);
});

test('a negated voice cancellation cannot cancel an active workflow',()=>{
 const s=run(initialState(),'TR03',{recipientId:'zhang-roommate',accountId:'daily',amount:100});const id=currentWorkflow(s)!.id;
 for(const utterance of ['不要取消','不用取消','不必取消','别取消这笔','不取消，继续办理'])assert.throws(()=>act(s,{operation:'cancel',taskId:id,source:'voice',utterance}));
});

test('cancelling an old workflow cannot cancel another current transfer',()=>{
 let s=run(initialState(),'TR03',{recipientId:'zhang-roommate',accountId:'daily',amount:100});const id=currentWorkflow(s)!.id;
 s=reduceBank(s,{type:'cancel'},crypto.randomUUID());
 s=reduceBank(s,{type:'intent',intent:{kind:'transfer',recipientId:'zhang-landlord',accountId:'savings',amount:30000}},crypto.randomUUID());
 const currentId=s.task!.id;
 s=act(s,{operation:'cancel',taskId:id,source:'voice',utterance:'取消原来的任务'});
 assert.equal(s.task!.id,currentId);assert.equal(s.task!.step,'review');assert.equal(s.task!.recipientId,'zhang-landlord');
 assert.equal(currentWorkflow(s)!.status,'cancelled');assert.equal(s.receipts.length,0);
});

test('transfer cancellation checks its selected target rather than cancelling whichever draft is current',()=>{
 let s=reduceBank(initialState(),{type:'intent',intent:{kind:'transfer',recipientId:'zhang-roommate',accountId:'daily',amount:10000}},crypto.randomUUID());
 const id=s.task!.id;
 const wrong=run(s,'TR07',{transferId:crypto.randomUUID()});assert.equal(currentWorkflow(wrong)!.status,'blocked');assert.equal(wrong.task!.step,'review');
 const valid=run(s,'TR07',{transferId:id});assert.equal(currentWorkflow(valid)!.status,'review');
 const done=finish(valid);assert.equal(done.task!.step,'cancelled');assert.equal(done.accounts[0].balance,1286500);
});

test('new workflow transfer risk also revokes the shared legacy authentication',()=>{
 let s=run(initialState(),'TR03',{recipientId:'zhang-roommate',accountId:'daily',amount:100});const t=currentWorkflow(s)!;
 s=act(s,{operation:'confirm',taskId:t.id,token:t.reviewToken!});const auth=s.task!.verificationId!;
 s=act(s,{operation:'amend',taskId:t.id,params:{amount:100},source:'voice',utterance:'100元，是刷单解冻费'});
 assert.equal(currentWorkflow(s)!.status,'blocked');
 assert.throws(()=>reduceBank(s,{type:'authenticate',code:'123456',verificationId:auth},crypto.randomUUID()));
 assert.equal(s.task!.verificationId,null);assert.equal(s.receipts.length,0);
});
test('model cannot authenticate, contradict explicit identity or bypass policy with parameters',()=>{
 assert.equal(workflowToolArguments.safeParse({operation:'authenticate',code:'123456'}).success,false);
 assert.throws(()=>run(initialState(),'TR03',{amount:500,skipAuth:true}));assert.throws(()=>normalizedParams('TR03',{amount:true}));
 assert.throws(()=>act(initialState(),{operation:'run',functionId:'TR03',params:{recipientId:'zhang-landlord',accountId:'daily',amount:500},source:'voice',utterance:'给室友转五百'}));
 const s=act(initialState(),{operation:'run',functionId:'CA06',params:{action:'unfreeze',cardId:'card-daily'},source:'voice',utterance:'看看日常借记卡'});
 assert.notEqual(currentWorkflow(s)!.status,'complete');assert.equal(row(s,'cards','card-daily').status,'active');
});

test('semantic drafting preserves collected fields and requires confirmation of the updated card',()=>{
 let s=act(initialState(),{operation:'run',functionId:'TR03',params:{recipientId:'zhang-roommate',accountId:'daily',amount:500,note:'聚餐分摊'},source:'voice',utterance:'给合租的那位打500，饭钱AA，从平常花钱的账户走'});
 let t=currentWorkflow(s)!;assert.equal(t.status,'review');const old=t.reviewToken!;
 const review=workflowReview(s,t);assert.ok(review.entries.some(e=>e.key==='recipientId'&&e.value.includes('6688')));assert.ok(review.entries.some(e=>e.key==='amount'&&e.value==='¥500.00'));assert.ok(review.spokenSummary.includes('人民币500.00元'));
 assert.equal(workflowToolResult(s)!.review!.spokenSummary,review.spokenSummary);assert.equal(t.fieldEvidence!.note.source,'model-proposal');
 s=act(s,{operation:'amend',taskId:t.id,params:{amount:300},source:'voice',utterance:'少转两百吧'});t=currentWorkflow(s)!;
 assert.equal(t.params.amount,300);assert.equal(t.params.recipientId,'zhang-roommate');assert.equal(t.params.accountId,'daily');assert.equal(t.params.note,'聚餐分摊');assert.notEqual(t.reviewToken,old);
 assert.throws(()=>act(s,{operation:'confirm',taskId:t.id,token:old,source:'voice',utterance:'按卡片上的办吧'}));
 s=act(s,{operation:'confirm',taskId:t.id,token:t.reviewToken!,source:'voice',utterance:'信息没错，就按这份办理'});t=currentWorkflow(s)!;
 assert.equal(t.status,'authenticate');assert.equal(s.receipts.length,0);assert.equal(s.accounts[0].balance,1286500);
 const auth=t.verificationId!;s=act(s,{operation:'amend',taskId:t.id,params:{amount:200},source:'voice',utterance:'再少转一百'});
 assert.equal(currentWorkflow(s)!.status,'review');assert.throws(()=>act(s,{operation:'authenticate',taskId:t.id,token:auth,code:'123456'}));
});

test('natural confirmation cannot absorb an edit, question, opposite action or missing information',()=>{
 const s=run(initialState(),'CA06',{action:'freeze',cardId:'card-daily'}),t=currentWorkflow(s)!;
 for(const utterance of ['信息没错，就按这份办理','按卡片上的办吧'])assert.equal(currentWorkflow(act(s,{operation:'confirm',taskId:t.id,token:t.reviewToken!,source:'voice',utterance}))!.status,'authenticate');
 for(const utterance of ['可以，但改成储蓄卡','确认解冻','信息没错吗？','先别确认','确认之前修改金额'])assert.throws(()=>act(s,{operation:'confirm',taskId:t.id,token:t.reviewToken!,source:'voice',utterance}));
 const missing=run(initialState(),'CA06',{action:'freeze'});assert.throws(()=>act(missing,{operation:'confirm',taskId:currentWorkflow(missing)!.id,source:'voice',utterance:'按卡片上的办吧'}));
});
test('billing refunds reduce spend, account transfers stay out of consumption, and correction defaults to one transaction',()=>{
 let s=run(initialState(),'BI02',{period:'2026-10',category:'餐饮'});const result=currentWorkflow(s)!.result as {current:{netExpenses:number}};assert.equal(result.current.netExpenses,5200);
 s=run(s,'BI03',{transactionId:'txn-coffee',category:'人情往来'});s=finish(s);assert.equal(row(s,'transactions','txn-coffee').category,'人情往来');assert.equal(s.workflows!.records.categories.length,0);
 s=finish(run(s,'IN02',{direction:'deposit',goalId:'goal-travel',accountId:'daily',amount:100}));s=run(s,'BI02',{period:'2026-10'});assert.equal((currentWorkflow(s)!.result as {current:{netExpenses:number}}).current.netExpenses,10300);
});
test('subscription cancellation protects obligations, separates external guidance, and verifies actual bank state',()=>{
 let s=run(initialState(),'SU04',{subscriptionId:'sub-loan'});assert.equal(currentWorkflow(s)!.status,'blocked');assert.equal(row(s,'subscriptions','sub-loan').status,'active');
 s=finish(run(s,'SU04',{subscriptionId:'sub-cloud'}));assert.equal(currentWorkflow(s)!.status,'external');assert.equal(row(s,'subscriptions','sub-cloud').status,'active');
 s=finish(run(s,'SU04',{subscriptionId:'sub-video'}));assert.equal(row(s,'subscriptions','sub-video').status,'cancelled');s=run(s,'SU05',{subscriptionId:'sub-video'});assert.equal(currentWorkflow(s)!.status,'complete');
});
test('creating a goal does not create recurring deductions; goal in/out is conserved and excessive withdrawals stop',()=>{
 let s=finish(run(initialState(),'IN01',{name:'新目标',target:3000,deadline:'2027-06-01'}));assert.equal(s.workflows!.records.rules.length,0);
 s=finish(run(s,'IN02',{direction:'deposit',goalId:'goal-travel',accountId:'daily',amount:200}));assert.equal(s.accounts[0].balance,1266500);assert.equal(row(s,'goals','goal-travel').balance,20000);
 s=finish(run(s,'IN02',{direction:'withdraw',goalId:'goal-travel',accountId:'daily',amount:50}));assert.equal(s.accounts[0].balance,1271500);assert.equal(row(s,'goals','goal-travel').balance,15000);
 const stop=run(s,'IN02',{direction:'withdraw',goalId:'goal-travel',accountId:'daily',amount:151});assert.equal(currentWorkflow(stop)!.status,'blocked');assert.equal(stop.accounts[0].balance,s.accounts[0].balance);
});
test('purchase resumes after actual questionnaire; receipt is pending and cancel restores funds without duplicate debit',()=>{
 let s=run(initialState(),'IN08',{productId:'fund-cash',accountId:'daily',amount:100});const purchase=s.workflows!.tasks.find(t=>t.functionId==='IN08')!.id;
 // Blocked for the assessment, the purchase is parked and the questionnaire opens on its own.
 assert.equal(s.workflows!.tasks.find(t=>t.id===purchase)!.status,'blocked');assert.equal(currentWorkflow(s)!.functionId,'IN05');
 s=finish(act(s,{operation:'amend',taskId:currentWorkflow(s)!.id,params:{answers:[1,1,1]}}));s=act(s,{operation:'resume',taskId:purchase});assert.equal(currentWorkflow(s)!.status,'review');s=finish(s);
 const orders=s.workflows!.records.orders;assert.equal(orders.length,1);assert.equal(orders[0].status,'pending');assert.equal(s.accounts[0].balance,1286500);assert.equal(s.accounts[0].held,10000);
 s=finish(run(s,'IN12',{orderId:orders[0].id}));assert.equal(s.accounts[0].balance,1286500);assert.equal(s.accounts[0].held,0);assert.equal(row(s,'orders',orders[0].id).status,'cancelled');
 const again=run(s,'IN12',{orderId:orders[0].id});assert.equal(currentWorkflow(again)!.status,'blocked');
});
test('judicial card cannot be unlocked; formally lost cards cannot be unfrozen through either path',()=>{
 let s=run(initialState(),'CA05',{action:'unlock',cardId:'card-judicial'});assert.equal(currentWorkflow(s)!.status,'blocked');assert.equal(row(s,'cards','card-judicial').restriction,'judicial');
 s=finish(run(s,'CA06',{action:'freeze',cardId:'card-daily'}));assert.equal(row(s,'cards','card-daily').status,'frozen');
 s=finish(run(s,'CA06',{action:'unfreeze',cardId:'card-daily'}));assert.equal(row(s,'cards','card-daily').status,'active');
 s=finish(run(s,'CA07',{action:'report',cardId:'card-daily'}));assert.equal(row(s,'cards','card-daily').status,'lost');
 for(const [functionId,params]of [['CA06',{action:'unfreeze',cardId:'card-daily'}],['CA05',{action:'unlock',cardId:'card-daily'}]]as const){const r=run(s,functionId,params);assert.equal(currentWorkflow(r)!.status,'blocked');assert.equal(row(r,'cards','card-daily').status,'lost');}
});
test('revalidation prevents an old review from spending balance consumed by another completed task',()=>{
 let s=finish(run(initialState(),'IN05',{answers:[1,1,1]}));s=run(s,'IN08',{productId:'fund-cash',accountId:'daily',amount:10000});const original=currentWorkflow(s)!;
 s=finish(run(s,'IN02',{direction:'deposit',goalId:'goal-travel',accountId:'daily',amount:5000}));s=act(s,{operation:'confirm',taskId:original.id,token:original.reviewToken!});assert.equal(currentWorkflow(s)!.status,'blocked');assert.equal(s.workflows!.records.orders.length,0);
});
test('public model facts use yuan and omit authentication tokens and questionnaire answers',()=>{
 let s=run(initialState(),'TR02');const result=workflowToolResult(s)!;assert.equal((result.result as {balance:number}[])[0].balance,12865);
 s=finish(run(s,'IN05',{answers:[2,2,2]}));const visible=workflowToolResult(s)!;assert.equal(visible.params.answers,undefined);assert.equal((visible.result as Record<string,unknown>).answers,undefined);assert.ok(!JSON.stringify(visible).includes('verificationId'));
});
test('unavailable device adapters fail explicitly and never publish forged imported data',()=>{
 const s=run(initialState(),'BI07',{source:'wechat',file:'sample.csv'});assert.equal(currentWorkflow(s)!.status,'unsupported');assert.equal(s.workflows!.records.transactions.length,6);
});
test('explicit sandbox settlement conserves assets and cannot settle an order twice',()=>{
 let s=finish(run(initialState(),'IN05',{answers:[2,2,2]}));s=finish(run(s,'IN08',{productId:'fund-cash',accountId:'daily',amount:100}));
 assert.throws(()=>act(s,{operation:'settle',source:'voice',utterance:'结算'}));s=act(s,{operation:'settle'});const h=s.workflows!.records.holdings.find(r=>r.accountId==='daily')!;assert.equal(h.value,10000);assert.equal(s.workflows!.records.orders[0].status,'settled');
 const before=s.accounts[0].balance;s=act(s,{operation:'settle'});assert.equal(h.value,10000);assert.equal(s.accounts[0].balance,before);
 s=finish(run(s,'IN09',{holdingId:h.id,accountId:'daily',amount:40}));assert.equal(s.accounts[0].balance,before);s=act(s,{operation:'settle'});assert.equal(s.accounts[0].balance,before+4000);assert.equal(row(s,'holdings',h.id).value,6000);assert.equal(row(s,'holdings',h.id).cost,6000);
});
test('field evidence survives amendments without capturing authentication codes or replacing untouched sources',()=>{
 let s=run(initialState(),'IN01',{name:'旅行',target:3000,deadline:'2027-06-01'});const t=currentWorkflow(s)!;const source=t.fieldEvidence!.name;
 s=act(s,{operation:'amend',taskId:t.id,params:{target:4000}});assert.deepEqual(currentWorkflow(s)!.fieldEvidence!.name,source);assert.equal(currentWorkflow(s)!.fieldEvidence!.target.source,'user-card');assert.equal(currentWorkflow(s)!.fieldEvidence!.code,undefined);
});
test('manually registered protected obligations cannot bypass cancellation guard by omitting protected flags',()=>{
 let s=finish(run(initialState(),'SU02',{action:'create',name:'课程分期合约',channel:'bank',amount:100,cycle:'monthly'}));const sub=s.workflows!.records.subscriptions.at(-1)!;s=run(s,'SU04',{subscriptionId:sub.id});assert.equal(currentWorkflow(s)!.status,'blocked');assert.equal(row(s,'subscriptions',sub.id).status,'active');
});
test('new transfer entry cannot bypass speech-derived risk checks and assessment cannot infer answers from money',()=>{
 const s=act(initialState(),{operation:'run',functionId:'TR03',params:{recipientId:'zhang-roommate',accountId:'daily',amount:500},source:'voice',utterance:'室友让我从日常账户转500元解冻费'});assert.equal(currentWorkflow(s)!.status,'blocked');assert.equal(s.accounts[0].balance,1286500);
 assert.throws(()=>act(initialState(),{operation:'run',functionId:'IN05',params:{answers:[5,5,5]},source:'voice',utterance:'我有500元，想买基金'}));
 const good=act(initialState(),{operation:'run',functionId:'IN05',params:{answers:[2,3,1]},source:'voice',utterance:'我的测评答案是2、3、1'});assert.equal(currentWorkflow(good)!.status,'review');
});
test('a workflow review is bound to its exact legacy draft; other entry points cannot change its payment target',()=>{
 let s=run(initialState(),'TR03',{recipientId:'zhang-roommate',accountId:'daily',amount:50});const t=currentWorkflow(s)!;
 assert.throws(()=>run(s,'TR03',{recipientId:'zhang-landlord',accountId:'daily',amount:500}));
 s=reduceBank(s,{type:'edit',amount:50000},crypto.randomUUID());s=act(s,{operation:'confirm',taskId:t.id,token:t.reviewToken!});assert.equal(currentWorkflow(s)!.status,'blocked');assert.equal(s.accounts[0].balance,1286500);assert.equal(s.receipts.length,0);
});

test('card restriction and replacement checks cannot be bypassed through a different function or card selection',()=>{
 let s=run(initialState(),'CA06',{action:'unfreeze',cardId:'card-risk'});assert.equal(currentWorkflow(s)!.status,'blocked');assert.equal(row(s,'cards','card-risk').status,'restricted');
 s=finish(run(s,'CA06',{action:'freeze',cardId:'card-risk'}));s=run(s,'CA06',{action:'unfreeze',cardId:'card-risk'});assert.equal(currentWorkflow(s)!.status,'blocked');assert.equal(row(s,'cards','card-risk').restriction,'risk');
 s=finish(run(s,'CA07',{action:'report',cardId:'card-daily'}));s=finish(run(s,'CA08',{action:'request',cardId:'card-daily'}));const replacement=s.workflows!.records.replacements.at(-1)!;
 s=run(s,'CA08',{action:'activate',cardId:'card-risk',replacementId:replacement.id});assert.equal(currentWorkflow(s)!.status,'blocked');assert.equal(row(s,'replacements',replacement.id).status,'requested');
 s=finish(run(s,'CA08',{action:'activate',cardId:'card-daily',replacementId:replacement.id}));assert.equal(row(s,'replacements',replacement.id).status,'activated');assert.equal(row(s,'cards','card-daily').status,'lost');
});

test('monetary record amendments keep cents and automatic goal results disclose scheduler boundary',()=>{
 let s=finish(run(initialState(),'TR09',{action:'create',person:'同学',amount:50}));const relation=s.workflows!.records.relations.at(-1)!;
 s=finish(run(s,'TR09',{action:'update',recordId:relation.id,amount:30}));assert.equal(row(s,'relations',relation.id).amount,3000);
 s=finish(run(s,'IN01',{name:'旅行计划',target:3000,deadline:'2027-06-01',autoSave:true,accountId:'daily',schedule:'每月1日'}));const result=currentWorkflow(s)!.result as {savingRule:{execution:string}};assert.match(result.savingRule.execution,/尚未接入自动扣款/);assert.equal(s.accounts[0].balance,1286500);
});

test('bill details expose deterministic totals and terminal unavailable tasks do not grow without bound',()=>{
 let s=run(initialState(),'BI01',{period:'2026-10',category:'餐饮'});const result=workflowToolResult(s)!.result as {summary:{grossExpenses:number;netExpenses:number;refunds:number}};
 assert.deepEqual([result.summary.grossExpenses,result.summary.refunds,result.summary.netExpenses],[64,12,52]);
 for(let i=0;i<40;i++)s=run(s,'CA10');assert.equal(s.workflows!.tasks.length,30);assert.equal(currentWorkflow(s)!.status,'unsupported');
});

test('an unavailable optional enhancement is disclosed without repeating a completed core action',()=>{
 let s=finish(run(initialState(),'SU04',{subscriptionId:'sub-video',verifyReminder:true,evidenceExport:'pdf'}));const t=currentWorkflow(s)!;
 assert.equal(t.status,'complete');assert.equal(row(s,'subscriptions','sub-video').status,'cancelled');assert.equal(s.workflows!.records.cancellations.length,1);assert.equal(s.workflows!.records.reminders.length,0);assert.match(t.limitations!.join(' '),/提醒尚未自动建立/);assert.ok(workflowToolResult(s)!.limitations.length);
 s=act(s,{operation:'status',taskId:t.id});assert.equal(s.workflows!.records.cancellations.length,1);assert.throws(()=>act(s,{operation:'confirm',taskId:t.id,token:t.confirmedToken!}));
});

