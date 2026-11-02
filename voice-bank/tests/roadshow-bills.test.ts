import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,reduceBank} from '../lib/bank/engine.ts';
import type {BankState} from '../lib/bank/types.ts';
import {currentWorkflow} from '../lib/workflows/engine.ts';
import {workflowMessage} from '../lib/ui/presentation.ts';

const scene=(sceneId:string)=>reduceBank(initialState(),{type:'load_scene',sceneId},crypto.randomUUID());
const card=(s:BankState,command:Record<string,unknown>)=>reduceBank(s,{type:'workflow',command:{source:'card',...command} as never},crypto.randomUUID());
function cancel(s:BankState,subscriptionId:string){
 s=card(s,{operation:'run',functionId:'SU04',params:{subscriptionId}});let t=currentWorkflow(s)!;
 const review=t;if(t.status!=='review')return {s,t,review};
 s=card(s,{operation:'confirm',taskId:t.id,token:t.reviewToken});t=currentWorkflow(s)!;
 if(t.status==='authenticate'){s=card(s,{operation:'authenticate',taskId:t.id,token:t.verificationId,code:'123456'});t=currentWorkflow(s)!;}
 return {s,t,review};
}
const sub=(s:BankState,id:string)=>s.workflows!.records.subscriptions.find(x=>x.id===id)!;

test('T01 the coffee details are individual records with month, count and total',()=>{
 const t=currentWorkflow(card(scene('S01'),{operation:'run',functionId:'BI01',params:{period:'2026-10',category:'咖啡'}}))!;
 const result=t.result as {transactions:{amount:number}[];summary:{expenseCount:number;grossExpenses:number;period:string}};
 assert.equal(result.transactions.length,26);assert.ok(result.transactions.every(x=>x.amount===990));
 assert.equal(result.summary.expenseCount,26);assert.equal(result.summary.grossExpenses,25740);assert.equal(result.summary.period,'2026-10');
});

test('T02 T03 cancelling one service stops only its renewals, refunds nothing and leaves the other active',()=>{
 const before=scene('S01'),{s,t,review}=cancel(before,'video-a');
 assert.match(review.message,/将停止视频A（每月25元，下次2026-11-15续费）的后续续费。以前的扣款不会退还，本期权益到2026-11-15/);
 assert.equal(t.status,'complete');assert.equal(sub(s,'video-a').status,'cancelled');assert.equal(sub(s,'video-b').status,'active');
 assert.match(workflowMessage(t),/视频A后续续费已停止；以前的扣款不退还，本期权益到 2026-11-15/);
 assert.equal(s.accounts[0].balance,before.accounts[0].balance);
 assert.equal(s.workflows!.records.transactions.filter(x=>x.merchant==='视频A').length,3,'history stays');
});

test('T03 scripted outcomes: pending is not a success, a refusal changes nothing, a platform service needs the provider',()=>{
 const base=scene('S01-R');
 let r=cancel(base,'video-a');assert.equal(r.t.status,'complete');assert.equal((r.t.result as {status:string}).status,'pending');
 assert.equal(sub(r.s,'video-a').status,'active');assert.match(workflowMessage(r.t),/结果待核对/);
 r=cancel(base,'video-b');assert.equal(r.t.status,'blocked');assert.match(r.t.message,/被退回（模拟结果），后续续费仍然有效/);
 assert.equal(sub(r.s,'video-b').status,'active');assert.equal(r.s.accounts[0].balance,base.accounts[0].balance);
 r=cancel(base,'music-c');assert.match(r.review.message,/需要到服务方那里取消/);assert.equal(r.t.status,'external');assert.equal(sub(r.s,'music-c').status,'active');
});

test('T14 a card query shows only the transactions recorded for that card',()=>{
 const t=currentWorkflow(card(scene('S04'),{operation:'run',functionId:'CA02',params:{cardId:'card-cloud'}}))!;
 const result=t.result as {recentTransactions:{amount:number;merchant:string}[];coverage:string};
 assert.equal(result.recentTransactions.length,3);assert.ok(result.recentTransactions.every(x=>x.amount===1200&&x.merchant==='云空间'));
 assert.match(result.coverage,/不代表掌握全部绑定/);
});
