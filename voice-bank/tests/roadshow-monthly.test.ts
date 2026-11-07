import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduceBank } from '../lib/bank/engine.ts';
import type { BankState } from '../lib/bank/types.ts';
import { currentWorkflow } from '../lib/workflows/engine.ts';
import { availableBalance } from '../lib/bank/accounts.ts';
import {dispatchAction} from '../lib/plans/dispatch.ts';
import {planToolResult} from '../lib/plans/realtime.ts';
import {monthlyBudgetTotal} from '../lib/plans/monthly.ts';
import {mascotCue} from '../lib/mascot/scenario.ts';
import {operationToolResult} from '../lib/bank/tool-result.ts';

const act=(s:BankState,a:any)=>reduceBank(s,a,crypto.randomUUID());
const scene=(id='S08')=>act(initialState(),{type:'load_scene',sceneId:id});
const plan=(s:BankState,command:any)=>act(s,{type:'plan',command:{source:'card',...command}});
const open=(s:BankState)=>act(s,{type:'plan',command:{operation:'create',source:'voice',utterance:'工资到了，老规矩'}});
const card=(s:BankState,command:any)=>act(s,{type:'workflow',command:{source:'card',...command}});
function confirm(s:BankState){let t=currentWorkflow(s)!;assert.equal(t.status,'review',t.message);s=card(s,{operation:'confirm',taskId:t.id,token:t.reviewToken});t=currentWorkflow(s)!;if(t.status==='authenticate')s=card(s,{operation:'authenticate',taskId:t.id,token:t.verificationId,code:'123456'});return s;}

test('月度模板只创建待修改计划，重复打开（包括结束后）保持同一份',()=>{
 let s=open(scene());const id=s.plan!.id;assert.equal(s.plan!.status,'paused');assert.equal(s.accounts[0].balance,800000);assert.equal(s.receipts.length,0);assert.equal(s.plan!.steps.length,4);
 s=open(s);assert.equal(s.plan!.id,id);assert.equal(s.accounts[0].balance,800000);
 const missing=open(initialState());assert.match(missing.lastReply,/没找到已保存的月度计划/);assert.equal(missing.plan,undefined);
});
test('逐项核对：房租、内部储蓄、受理占用与报告',()=>{
 let s=open(scene());s=plan(s,{operation:'resume'});s=confirm(s);assert.equal(s.accounts[0].balance,620000);assert.equal(s.receipts.length,1);
 s=confirm(s);assert.equal(s.accounts[0].balance,580000);assert.equal(s.workflows!.records.goals.find(x=>x.id==='EMERGENCY-01')!.balance,40000);assert.equal(s.workflows!.records.transactions.filter(x=>x.kind==='internal_transfer').length,1);
 s=confirm(s);assert.equal(s.accounts[0].balance,580000);assert.equal(s.accounts[0].held,20000);assert.equal(availableBalance(s.accounts[0]),560000);assert.equal(s.workflows!.records.holdings.length,0);assert.equal(s.workflows!.records.orders[0].status,'pending');assert.equal(s.plan!.status,'complete');assert.equal(s.plan!.steps.find(x=>x.functionId==='BI06')?.status,'complete');
 const id=s.plan!.id;s=open(s);assert.equal(s.plan!.id,id);assert.equal(s.receipts.length,1);
});
test('修改金额后确认令牌失效，不能使用旧令牌付款',()=>{
 let s=plan(open(scene()),{operation:'resume'}),t=currentWorkflow(s)!,old=t.reviewToken;
 s=card(s,{operation:'amend',taskId:t.id,params:{amount:1900}});t=currentWorkflow(s)!;assert.notEqual(t.reviewToken,old);
 assert.throws(()=>card(s,{operation:'confirm',taskId:t.id,token:old}));assert.equal(s.accounts[0].balance,800000);
});
test('储蓄失败保留房租，报告可独立完成，重试不重复房租',()=>{
 let s=plan(open(scene('S08-F')),{operation:'resume'});s=confirm(s);s=confirm(s);
 assert.equal(s.plan!.status,'blocked');assert.match(s.lastReply,/储蓄失败/);assert.equal(s.accounts[0].balance,620000);assert.equal(s.receipts.length,1);assert.equal(s.workflows!.records.orders.length,0);assert.equal(s.workflows!.tasks.find(x=>x.functionId==='IN08')!.status,'queued');
 s=act(s,{type:'plan',command:{operation:'interrupt',source:'voice',utterance:'聚餐预算400'}});const budget=s.plan!.steps.find(x=>x.functionId==='BI08')!;s=plan(s,{operation:'resume',taskId:budget.id});s=confirm(s);assert.equal(s.accounts[0].balance,620000);assert.equal(s.accounts[0].held||0,0);assert.equal(s.workflows!.records.budgets[0].amount,40000);assert.equal(s.plan!.status,'blocked');
 const report=s.plan!.steps.find(x=>x.functionId==='BI06')!;s=plan(s,{operation:'resume',taskId:report.id});assert.equal(s.plan!.steps.find(x=>x.id===report.id)!.status,'complete');
 const save=s.plan!.steps.find(x=>x.functionId==='IN02')!;s=plan(s,{operation:'resume',taskId:save.id});s=confirm(s);assert.equal(s.receipts.length,1);assert.equal(s.accounts[0].balance,580000);
});
test('房租结果未知只保留原单，阻止重试与资金依赖',()=>{
 let s=plan(open(scene('S08-U')),{operation:'resume'});s=confirm(s);assert.equal(s.plan!.status,'blocked');assert.match(s.lastReply,/回查原订单/);assert.equal(s.receipts.length,0);assert.equal(s.accounts[0].balance,800000);
 const rent=s.plan!.steps.find(x=>x.functionId==='TR03')!,save=s.plan!.steps.find(x=>x.functionId==='IN02')!;assert.throws(()=>plan(s,{operation:'resume',taskId:rent.id}));assert.throws(()=>plan(s,{operation:'resume',taskId:save.id}));const id=s.plan!.id;s=open(s);assert.equal(s.plan!.id,id);assert.equal(s.receipts.length,0);
});
test('完成后处理其他计划，再说老规矩仍返回本月原计划',()=>{
 let s=plan(open(scene()),{operation:'resume'});s=confirm(s);s=confirm(s);s=confirm(s);const id=s.plan!.id;
 s=plan(s,{operation:'create',functionId:'TR02',params:{}});assert.notEqual(s.plan!.id,id);assert.equal(s.plan!.status,'complete');
 s=open(s);assert.equal(s.plan!.id,id);assert.equal(s.receipts.length,1);assert.equal(s.workflows!.records.orders.length,1);
});
test('追加聚餐只生成独立预算，核对后不扣款不占用',()=>{
 let s=open(scene());s=act(s,{type:'plan',command:{operation:'interrupt',source:'voice',utterance:'这周请爸妈吃饭，先留400'}});
 const entry=s.plan!.steps.find(x=>x.functionId==='BI08')!;assert.ok(entry);assert.deepEqual(entry.dependsOn,[]);assert.equal(s.accounts[0].balance,800000);assert.equal(s.accounts[0].held,undefined);
 s=plan(s,{operation:'resume',taskId:entry.id});s=confirm(s);assert.equal(s.accounts[0].balance,800000);assert.equal(s.accounts[0].held,undefined);assert.equal(s.workflows!.records.budgets[0].amount,40000);
});
test('每项认证前余额不变，账户或产品修改撤销原认证',()=>{
 let s=scene();s.accounts.push({id:'other',name:'备用账户',tail:'1122',balance:800000});s.workflows!.records.products.push({...s.workflows!.records.products[0],id:'product-b',name:'稳健产品B'});
 s=plan(open(s),{operation:'resume'});let t=currentWorkflow(s)!,balance=s.accounts[0].balance;
 s=card(s,{operation:'confirm',taskId:t.id,token:t.reviewToken});t=currentWorkflow(s)!;assert.equal(s.accounts[0].balance,balance);
 const old=t.verificationId;s=card(s,{operation:'amend',taskId:t.id,params:{accountId:'other'}});t=currentWorkflow(s)!;assert.notEqual(t.verificationId,old);assert.throws(()=>card(s,{operation:'authenticate',taskId:t.id,token:old,code:'123456'}));assert.equal(s.accounts[0].balance,balance);
 s=confirm(s);s=confirm(s);t=currentWorkflow(s)!;assert.equal(t.functionId,'IN08');balance=s.accounts[0].balance;s=card(s,{operation:'confirm',taskId:t.id,token:t.reviewToken});t=currentWorkflow(s)!;const oldProduct=t.verificationId;assert.equal(s.accounts[0].balance,balance);assert.equal(s.accounts[0].held,undefined);
 s=card(s,{operation:'amend',taskId:t.id,params:{productId:'product-b'}});t=currentWorkflow(s)!;assert.throws(()=>card(s,{operation:'authenticate',taskId:t.id,token:oldProduct,code:'123456'}));assert.equal(s.accounts[0].balance,balance);assert.equal(s.accounts[0].held,undefined);
});
test('未知原订单能回查，预算和报告独立于房租而不制造第二订单',()=>{
 let s=plan(open(scene('S08-U')),{operation:'resume'});s=confirm(s);const rent=s.plan!.steps.find(x=>x.functionId==='TR03')!,id=(rent.result as any).originalTransferId;
 s=plan(s,{operation:'status',taskId:rent.id});assert.equal((currentWorkflow(s)!.result as any).id,id);assert.match(s.lastReply,/回查原模拟订单/);assert.equal(s.workflows!.records.transfers.length,1);
 s=act(s,{type:'plan',command:{operation:'interrupt',source:'voice',utterance:'这周请爸妈吃饭，先留400'}});const b=s.plan!.steps.find(x=>x.functionId==='BI08')!;s=plan(s,{operation:'resume',taskId:b.id});s=confirm(s);assert.equal(s.workflows!.records.budgets[0].amount,40000);
 const report=s.plan!.steps.find(x=>x.functionId==='BI06')!;s=plan(s,{operation:'resume',taskId:report.id});assert.equal(s.plan!.steps.find(x=>x.id===report.id)!.status,'complete');assert.equal(s.accounts[0].balance,800000);assert.equal(s.receipts.length,0);assert.equal(s.workflows!.records.transfers.length,1);
});
test('场景切换清空月度历史，重复同一请求不创建第二计划',()=>{
 let s=scene(),id='monthly-idempotency';const a={type:'plan',command:{operation:'create',source:'voice',utterance:'老规矩'}} as const;s=reduceBank(s,a,id);assert.equal(reduceBank(s,a,id),s);
 s=plan(s,{operation:'resume'});s=confirm(s);s=confirm(s);s=confirm(s);s=plan(s,{operation:'create',functionId:'TR02',params:{}});assert.ok(s.monthlyHistory);s=act(s,{type:'load_scene',sceneId:'S01'});assert.equal(s.monthlyHistory,undefined);s=open(s);assert.match(s.lastReply,/没找到/);
});
test('未知房租期间不能通过插入或伪造故障参数另建转账',()=>{
 let s=plan(open(scene('S08-U')),{operation:'resume'});s=confirm(s);
 assert.throws(()=>plan(s,{operation:'interrupt',functionId:'TR03',params:{accountId:'daily',recipientId:'RENT-7742',amount:1800}}));assert.equal(s.workflows!.records.transfers.length,1);
 const ordinary=scene();assert.throws(()=>act(ordinary,{type:'plan',command:{operation:'create',source:'voice',utterance:'老规矩',params:{sceneId:'S08-F'}}}));assert.equal(ordinary.accounts[0].balance,800000);
});
test('未知房租禁止取消整份计划后另建转账',()=>{
 let s=plan(open(scene('S08-U')),{operation:'resume'});s=confirm(s);assert.throws(()=>plan(s,{operation:'cancel'}));assert.throws(()=>plan(s,{operation:'create',functionId:'TR03',params:{accountId:'daily',recipientId:'RENT-7742',amount:1800}}));assert.equal(s.workflows!.records.transfers.length,1);
});
test('新月份展开前归档原月，并可回查原计划',()=>{
 let s=plan(open(scene()),{operation:'resume'});s=confirm(s);s=confirm(s);s=confirm(s);const july=s.plan!.id;s.demoClock='2033-08-25T04:00:00.000Z';s=open(s);assert.notEqual(s.plan!.id,july);assert.equal(s.monthlyHistory?.['2033-07'].id,july);
 // Cancel this unexecuted August plan before reopening the July record.
 const august=s.plan!.id;s=plan(s,{operation:'cancel'});s.demoClock='2033-07-25T04:00:00.000Z';s=open(s);assert.equal(s.plan!.id,july);assert.equal(s.receipts.length,1);s.demoClock='2033-08-25T04:00:00.000Z';s=open(s);assert.equal(s.plan!.id,august);assert.equal(s.plan!.status,'cancelled');assert.equal(s.receipts.length,1);
});
test('完成后追加聚餐预算可确认；重复复用待确认项并更新同一预算',()=>{
 let s=plan(open(scene()),{operation:'resume'});s=confirm(s);s=confirm(s);s=confirm(s);
 const append=(state:BankState,text:string)=>act(state,{type:'plan',command:{operation:'interrupt',source:'voice',utterance:text}});
 s=append(s,'聚餐预算400');assert.equal(s.plan!.status,'paused');let entries=s.plan!.steps.filter(x=>x.functionId==='BI08');assert.equal(entries.length,1);s=append(s,'聚餐预算400');assert.equal(s.plan!.steps.filter(x=>x.functionId==='BI08').length,1);
 s=plan(s,{operation:'resume',taskId:entries[0].id});s=confirm(s);s=append(s,'聚餐预算500');entries=s.plan!.steps.filter(x=>x.functionId==='BI08');assert.equal(entries.length,2);s=plan(s,{operation:'resume',taskId:entries[1].id});s=confirm(s);assert.equal(s.workflows!.records.budgets.length,1);assert.equal(s.workflows!.records.budgets[0].amount,50000);assert.equal(s.receipts.length,1);assert.equal(s.workflows!.records.orders.length,1);
});
test('修改待确认聚餐预算沿用原任务且撤销旧摘要',()=>{
 let s=open(scene());const append=(state:BankState,text:string)=>act(state,{type:'plan',command:{operation:'interrupt',source:'voice',utterance:text}});s=append(s,'聚餐预算400');const entry=s.plan!.steps.find(x=>x.functionId==='BI08')!;s=plan(s,{operation:'resume',taskId:entry.id});const old=currentWorkflow(s)!.reviewToken;s=append(s,'聚餐预算500');const current=currentWorkflow(s)!;assert.equal(current.id,entry.id);assert.notEqual(current.reviewToken,old);assert.throws(()=>card(s,{operation:'confirm',taskId:current.id,token:old}));assert.equal(s.plan!.steps.filter(x=>x.functionId==='BI08').length,1);
});

test('语音工具入口读取保存模板，追加预算不采用模型猜测金额',()=>{
 let s=scene();const text='工资到了，老规矩';
 const action=dispatchAction(s,{type:'workflow',command:{operation:'run',source:'voice',functionId:'TR03',params:{amount:99999},utterance:text}},text,'monthly-turn');
 s=act(s,action);assert.equal(s.plan!.steps[0].params.amount,1800);assert.equal(s.workflows!.tasks[0].fieldEvidence!.amount.source,'saved-template');
 const budget='这周请爸妈吃饭，先留400';s=act(s,dispatchAction(s,{type:'plan',command:{operation:'interrupt',source:'voice',functionId:'BI08',params:{amount:99999},utterance:budget}},budget));
 assert.equal(s.plan!.steps.find(x=>x.functionId==='BI08')!.params.amount,400);assert.equal(s.accounts[0].balance,800000);
});
test('月度金额汇总按元公开，不把计划未分配或占用重复计入资产',()=>{
 let s=plan(open(scene()),{operation:'resume'});s=confirm(s);s=confirm(s);s=confirm(s);
 s=act(s,{type:'plan',command:{operation:'interrupt',source:'voice',utterance:'聚餐预算400'}});let b=s.plan!.steps.find(x=>x.functionId==='BI08')!;
 s=plan(s,{operation:'resume',taskId:b.id});s=confirm(s);
 assert.equal(monthlyBudgetTotal(s.plan!),40000);const facts=planToolResult(s)!.monthly as any;
 assert.deepEqual([facts.balance,facts.available,facts.goalBalance,facts.assets,facts.budget,facts.unallocated],[5800,5600,400,6200,400,5200]);
 s=act(s,{type:'plan',command:{operation:'interrupt',source:'voice',utterance:'聚餐预算500'}});b=s.plan!.steps.filter(x=>x.functionId==='BI08').at(-1)!;
 assert.equal(monthlyBudgetTotal(s.plan!),50000);s=plan(s,{operation:'cancel',taskId:b.id});assert.equal(monthlyBudgetTotal(s.plan!),40000);
});
test('预算和只读报告不触发成功动作；投资受理仍等待',()=>{
 let s=plan(open(scene()),{operation:'resume'});s=confirm(s);s=confirm(s);s=confirm(s);
 const cue=(state:BankState)=>mascotCue({bank:state,phase:'idle',mode:'demo',muted:false,busy:false,connecting:false,closing:false,recovering:false,error:''}).action;
 const investment=s.workflows!.tasks.find(x=>x.functionId==='IN08')!;s.workflows!.currentTaskId=investment.id;assert.equal(cue(s),'waiting');
 const report=s.workflows!.tasks.find(x=>x.functionId==='BI06')!;s.workflows!.currentTaskId=report.id;assert.equal(cue(s),'idle');
 s=act(s,{type:'plan',command:{operation:'interrupt',source:'voice',utterance:'聚餐预算400'}});const b=s.plan!.steps.find(x=>x.functionId==='BI08')!;s=plan(s,{operation:'resume',taskId:b.id});s=confirm(s);s.workflows!.currentTaskId=b.id;assert.equal(cue(s),'idle');
});

test('重新打开月度记录回到自身任务，工具消息报告本月进度而非其他业务',()=>{
 let s=plan(open(scene()),{operation:'resume'});s=confirm(s);s=confirm(s);s=confirm(s);const monthlyId=s.plan!.id;
 s=plan(s,{operation:'create',functionId:'TR02',params:{}});const before=s;s=open(s);assert.equal(s.plan!.id,monthlyId);
 assert.ok(s.plan!.steps.some(x=>x.taskId===s.workflows!.currentTaskId));const result=operationToolResult(before,s,{name:'bank_plan',arguments:{operation:'create'}});assert.match(result.operationResult.message,/本月已有/);
});
