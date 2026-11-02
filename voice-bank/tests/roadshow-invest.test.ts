import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,reduceBank} from '../lib/bank/engine.ts';
import type {BankState} from '../lib/bank/types.ts';
import {currentWorkflow} from '../lib/workflows/engine.ts';
import {workflowMessage} from '../lib/ui/presentation.ts';
import {publicValue} from '../lib/workflows/realtime.ts';

const scene=(sceneId:string)=>reduceBank(initialState(),{type:'load_scene',sceneId},crypto.randomUUID());
function card(s:BankState,command:Record<string,unknown>){return reduceBank(s,{type:'workflow',command:{source:'card',...command} as never},crypto.randomUUID());}
function buy(s:BankState,amount=300){
 s=card(s,{operation:'run',functionId:'IN08',params:{productId:'product-a',amount}});let t=currentWorkflow(s)!;
 s=card(s,{operation:'confirm',taskId:t.id,token:t.reviewToken});t=currentWorkflow(s)!;
 return card(s,{operation:'authenticate',taskId:t.id,token:t.verificationId,code:'123456'});
}

test('T12 an accepted purchase holds money: book 3000, held 300, available 2700, no holding yet',()=>{
 const s=buy(scene('S03')),t=currentWorkflow(s)!,a=s.accounts[0];
 assert.equal(t.status,'complete');assert.equal(a.balance,300000);assert.equal(a.held,30000);
 assert.equal(s.workflows!.records.holdings.length,0);assert.equal(s.workflows!.records.orders[0].status,'pending');
 assert.match(workflowMessage(t),/已占用、尚未扣款，等待份额确认/);
 const query=currentWorkflow(card(s,{operation:'run',functionId:'TR02',params:{}}))!;
 assert.match(workflowMessage(query),/余额 ¥3,000\.00，其中 ¥300\.00 已被理财申购占用，可用 ¥2,700\.00/);
 assert.deepEqual(publicValue({available:270000,held:30000}),{available:2700,held:300});
});

test('held money cannot be spent twice, is released on cancel and leaves only at settlement',()=>{
 let s=buy(scene('S03'),2800);
 const second=currentWorkflow(card(s,{operation:'run',functionId:'IN08',params:{productId:'product-a',amount:300}}))!;
 assert.equal(second.status,'blocked');assert.match(second.message,/可用余额不足/);
 const order=s.workflows!.records.orders[0];
 let c=card(s,{operation:'run',functionId:'IN12',params:{orderId:order.id}});const t=currentWorkflow(c)!;
 c=card(c,{operation:'confirm',taskId:t.id,token:t.reviewToken});const auth=currentWorkflow(c)!;
 c=card(c,{operation:'authenticate',taskId:auth.id,token:auth.verificationId,code:'123456'});
 assert.equal(c.accounts[0].balance,300000);assert.equal(c.accounts[0].held,0);
 s=card(s,{operation:'settle'});
 assert.equal(s.accounts[0].balance,20000);assert.equal(s.accounts[0].held,0);assert.equal(s.workflows!.records.holdings[0].value,280000);
});

test('T11 an expired synthetic assessment stops a purchase; T13 a plan is authorised without an immediate debit',()=>{
 let s=scene('S03');
 s=card(s,{operation:'run',functionId:'IN13',params:{action:'create',productId:'product-a',amount:200,schedule:'每月10日'}});let t=currentWorkflow(s)!;
 assert.match(t.message,/每月10日从日常账户投200元到模拟产品A。这只是授权规则，现在不会扣款/);
 s=card(s,{operation:'confirm',taskId:t.id,token:t.reviewToken});t=currentWorkflow(s)!;s=card(s,{operation:'authenticate',taskId:t.id,token:t.verificationId,code:'123456'});
 assert.equal(currentWorkflow(s)!.status,'complete');assert.equal(s.workflows!.records.orders.length,0);assert.equal(s.accounts[0].balance,300000);assert.equal(s.accounts[0].held,undefined);
 s=reduceBank(s,{type:'advance_clock',to:'2029-11-01T04:00:00.000Z'},crypto.randomUUID());
 const guided=card(s,{operation:'run',functionId:'IN08',params:{productId:'product-a',amount:100}});t=guided.workflows!.tasks.findLast(x=>x.functionId==='IN08')!;
 assert.equal(t.status,'blocked');assert.match(t.message,/有效的演示风险测评/);assert.equal(currentWorkflow(guided)!.functionId,'IN05');
});
