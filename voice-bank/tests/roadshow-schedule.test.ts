import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,reduceBank} from '../lib/bank/engine.ts';
import type {BankState} from '../lib/bank/types.ts';
import {currentWorkflow} from '../lib/workflows/engine.ts';
import {dispatchAction} from '../lib/plans/dispatch.ts';

const scene=(sceneId:string)=>reduceBank(initialState(),{type:'load_scene',sceneId},crypto.randomUUID());
const advance=(s:BankState,to:string)=>reduceBank(s,{type:'advance_clock',to},crypto.randomUUID());
const card=(s:BankState,command:Record<string,unknown>)=>reduceBank(s,{type:'workflow',command:{source:'card',...command} as never},crypto.randomUUID());
const say=(s:BankState,command:Record<string,unknown>,utterance:string)=>reduceBank(s,dispatchAction(s,{type:'workflow',command:{source:'voice',utterance,turnId:crypto.randomUUID(),...command} as never},utterance),crypto.randomUUID());
const goal=(s:BankState)=>s.workflows!.records.goals[0];
function deposit(){
 let s=say(scene('S07'),{operation:'run',functionId:'TR03',params:{recipientId:'RENT-7742',amount:2000,note:'租房押金',archive:'租住'}},'给房东李明转2000租房押金，凭证归档到租住');
 let t=currentWorkflow(s)!;assert.equal(t.status,'review',t.message);
 s=say(s,{operation:'confirm',taskId:t.id,token:t.reviewToken},'账户信息核对过了，金额2000，确认提交');t=currentWorkflow(s)!;
 return card(s,{operation:'authenticate',taskId:t.id,token:t.verificationId,code:'123456'});
}

test('T18 a new payee is reviewed as new, held and only settled when its delay passes; T19 the receipt is archived',()=>{
 let s=deposit();const t=currentWorkflow(s)!,a=s.accounts[0];
 assert.equal(t.status,'complete');assert.equal((t.result as {status:string}).status,'pending');assert.match(t.message,/延迟到账.*到账前可以撤销/);
 assert.equal(a.balance,510000);assert.equal(a.held,200000);assert.equal(s.receipts.length,0);assert.equal(goal(s).balance,240000);
 s=advance(s,'2033-03-25T05:00:00.000Z');assert.equal(s.receipts.length,0,'not due yet');
 s=advance(s,'2033-03-25T07:00:00.000Z');
 assert.equal(s.accounts[0].balance,310000);assert.equal(s.accounts[0].held,0);assert.equal(goal(s).balance,240000,'the travel goal is not used');
 assert.equal(s.receipts.length,1);assert.equal(s.receipts[0].archive,'租住');assert.equal(s.receipts[0].recipientId,'RENT-7742');
 assert.equal(s.workflows!.records.transfers[0].status,'settled');
 s=advance(s,'2033-03-26T07:00:00.000Z');assert.equal(s.receipts.length,1,'settles only once');
});

test('T22 a delayed transfer can be revoked before it arrives, never after',()=>{
 let s=deposit();const id=s.workflows!.records.transfers[0].id;
 let r=card(s,{operation:'run',functionId:'TR07',params:{transferId:id}});let t=currentWorkflow(r)!;
 r=card(r,{operation:'confirm',taskId:t.id,token:t.reviewToken});t=currentWorkflow(r)!;
 if(t.status==='authenticate')r=card(r,{operation:'authenticate',taskId:t.id,token:t.verificationId,code:'123456'});
 assert.equal(currentWorkflow(r)!.status,'complete');assert.equal(r.accounts[0].held,0);assert.equal(r.accounts[0].balance,510000);
 r=advance(r,'2033-03-26T07:00:00.000Z');assert.equal(r.receipts.length,0,'a revoked transfer never settles');
 s=advance(s,'2033-03-26T07:00:00.000Z');
 assert.equal(currentWorkflow(card(s,{operation:'run',functionId:'TR07',params:{transferId:id}}))!.status,'blocked');
});

test('T16 monthly goal deposits run once per period, stop at the target and skip a short month without overdrawing',()=>{
 let s=scene('S05');s.accounts[0].balance=15000;
 s=advance(s,'2031-06-02T04:00:00.000Z');
 const runs=s.workflows!.records.rules[0].executions as {date:string;status:string;reason?:string}[];
 assert.deepEqual(runs.map(x=>[x.date,x.status]),[['2031-04-01','executed'],['2031-05-01','not_executed'],['2031-06-01','not_executed']]);
 assert.match(runs[1].reason!,/余额不足/);assert.equal(s.accounts[0].balance,5000);assert.equal(goal(s).balance,10000);
 s=advance(s,'2031-06-03T04:00:00.000Z');assert.equal((s.workflows!.records.rules[0].executions as unknown[]).length,3,'no catch-up');
 let full=scene('S05');full.workflows!.records.goals[0].balance=230000;
 full=advance(full,'2031-07-02T04:00:00.000Z');
 assert.equal(goal(full).balance,240000);assert.equal(full.workflows!.records.rules[0].status,'completed');
 assert.equal((full.workflows!.records.rules[0].executions as unknown[]).length,1);
});

test('T15 the funds calendar labels every future item by source and keeps planned money separate from the balance',()=>{
 const s=scene('S05'),t=currentWorkflow(card(s,{operation:'run',functionId:'SU08',params:{}}))!;
 const r=t.result as {calendar:{date:string;name:string;amount:number;source:string;status:string}[];balance:number;available:number;assumption:string};
 assert.deepEqual(r.calendar.map(x=>[x.date,x.name,x.amount,x.source]),[['2031-04-01','房租',150000,'用户登记'],['2031-04-01','存入下次一定去',10000,'已建规则']]);
 assert.equal(r.balance,400000);assert.equal(r.available,400000);assert.match(r.assumption,/预计收入不算可用余额；预算标记不等于冻结/);
});

test('T25 the concert budget sums user estimates, recalculates on change and never charges',()=>{
 const items=[{label:'门票',amount:680},{label:'往返车票',amount:300},{label:'住宿',amount:400},{label:'市内交通',amount:100}];
 let s=say(scene('S06'),{operation:'run',functionId:'BI08',params:{action:'estimate',category:'演出',items}},'票680，往返车票300、住宿400、市内交通100，帮我算一下预算');
 let t=currentWorkflow(s)!;assert.equal(t.status,'review');assert.match(t.message,/4项合计1,480元.*不是实时价格；不订房、不扣款/);
 s=say(s,{operation:'amend',taskId:t.id,params:{items:items.map(i=>i.label==='住宿'?{...i,amount:500}:i)}},'住宿改成500');
 t=currentWorkflow(s)!;assert.match(t.message,/合计1,580元/);
 assert.throws(()=>say(s,{operation:'amend',taskId:t.id,params:{items:items.map(i=>i.label==='住宿'?{...i,amount:450}:i)}},'住宿再看看'),/金额需要用户明确说出/);
 s=card(s,{operation:'confirm',taskId:t.id,token:t.reviewToken});
 const saved=s.workflows!.records.budgets.at(-1)!;assert.equal(saved.total,158000);assert.match(String(saved.basis),/用户估算/);
 assert.equal(s.accounts[0].balance,300000);assert.equal(s.accounts[0].held,undefined);assert.equal(s.receipts.length,0);
});
