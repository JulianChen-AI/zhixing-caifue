import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,reduceBank} from '../lib/bank/engine.ts';
import type {BankState} from '../lib/bank/types.ts';
import {currentWorkflow} from '../lib/workflows/engine.ts';
import {dispatchAction} from '../lib/plans/dispatch.ts';

const scene=(sceneId:string)=>reduceBank(initialState(),{type:'load_scene',sceneId},crypto.randomUUID());
const balance=(s:BankState)=>s.accounts.find(a=>a.id==='daily')!.balance;
function say(s:BankState,command:Record<string,unknown>,utterance:string){
 return reduceBank(s,dispatchAction(s,{type:'workflow',command:{source:'voice',utterance,turnId:crypto.randomUUID(),...command} as never},utterance),crypto.randomUUID());
}
const card=(s:BankState,command:Record<string,unknown>,requestId=crypto.randomUUID())=>reduceBank(s,{type:'workflow',command:{source:'card',...command} as never},requestId);
const ask=(guess?:string)=>say(scene('S02-A'),{operation:'run',functionId:'TR03',params:{amount:120,note:'球场费',...(guess?{recipientId:guess}:{})}},'给张三转120，昨天球场费');

test('X01 a shared name lists all three candidates and moves no money, even when the model guesses',()=>{
 for(const guess of [undefined,'C01','C02']){
  const s=ask(guess),t=currentWorkflow(s)!;
  assert.equal(t.status,'collecting');assert.deepEqual(t.missing,['recipientId']);assert.equal(t.params.recipientId,undefined);
  assert.deepEqual(t.recipientChoices,['C01','C02','C03']);assert.match(t.message,/三位.*同班张三.*羽毛球社张三.*社团学长张三/);
  assert.equal(balance(s),114000);assert.equal(s.receipts.length,0);
 }
});

test('X02 the badminton description and an ordinal both resolve only against the listed candidates',()=>{
 let s=ask();s=say(s,{operation:'amend',taskId:currentWorkflow(s)!.id,params:{recipientId:'C02'}},'打羽毛球那个');
 let t=currentWorkflow(s)!;assert.equal(t.status,'review');assert.equal(t.params.recipientId,'C02');assert.equal(t.recipientChoices,undefined);assert.match(t.message,/羽毛球社张三.*120\.00/);
 s=ask();s=say(s,{operation:'amend',taskId:currentWorkflow(s)!.id,params:{recipientId:'C02'}},'第二个');
 assert.equal(currentWorkflow(s)!.params.recipientId,'C02');
 s=ask();const before=currentWorkflow(s)!.id;
 assert.throws(()=>say(s,{operation:'amend',taskId:before,params:{recipientId:'C03'}},'第二个'));
 // Without a shown list an ordinal is not evidence.
 s=scene('S02-A');assert.throws(()=>say(s,{operation:'run',functionId:'TR03',params:{amount:120,recipientId:'C02'}},'转给第二个120'));
});

test('X03 X04 X05 only one confirmed transfer debits the account once',()=>{
 let s=ask();s=say(s,{operation:'amend',taskId:currentWorkflow(s)!.id,params:{recipientId:'C02'}},'打羽毛球那个');
 assert.equal(balance(s),114000);assert.equal(s.receipts.length,0);
 const review=currentWorkflow(s)!;s=say(s,{operation:'confirm',taskId:review.id,token:review.reviewToken},'对，确认转120');
 const auth=currentWorkflow(s)!;assert.equal(auth.status,'authenticate');
 const requestId=crypto.randomUUID();s=card(s,{operation:'authenticate',taskId:auth.id,token:auth.verificationId,code:'123456'},requestId);
 assert.equal(currentWorkflow(s)!.status,'complete');assert.equal(balance(s),102000);assert.equal(s.receipts.length,1);assert.equal(s.receipts[0].recipientId,'C02');assert.match(currentWorkflow(s)!.message,/羽毛球社张三/);
 assert.equal(card(s,{operation:'authenticate',taskId:auth.id,token:auth.verificationId,code:'123456'},requestId),s);
 assert.throws(()=>card(s,{operation:'confirm',taskId:review.id,token:review.reviewToken}));
 assert.equal(s.receipts.length,1);
});

test('X08 changing the amount invalidates the earlier review and cancelling leaves the balance unchanged',()=>{
 let s=say(scene('S02-A'),{operation:'run',functionId:'TR03',params:{amount:120,recipientId:'C02'}},'给打羽毛球的张三转120');
 const first=currentWorkflow(s)!;assert.equal(first.status,'review');
 s=say(s,{operation:'amend',taskId:first.id,params:{amount:130}},'改成130');
 const second=currentWorkflow(s)!;assert.equal(second.params.amount,130);assert.notEqual(second.reviewToken,first.reviewToken);
 assert.throws(()=>card(s,{operation:'confirm',taskId:first.id,token:first.reviewToken}));
 s=say(s,{operation:'cancel',taskId:second.id},'算了，不转了');
 assert.equal(currentWorkflow(s)!.status,'cancelled');assert.equal(balance(s),114000);assert.equal(s.receipts.length,0);
});

test('T10 a deposit to a stranger is stopped before any field collection',()=>{
 const s=say(scene('S06'),{operation:'run',functionId:'TR03',params:{amount:200,note:'保证金'}},'有人说能帮我留票，先给他个人账户转200保证金。帮我看看这笔。');
 const t=currentWorkflow(s)!;assert.equal(t.status,'blocked');assert.deepEqual(t.riskSignals,['保证金']);
 assert.match(t.message,/没有提交，也没有扣款/);assert.equal(balance(s),300000);assert.equal(s.receipts.length,0);
});

test('the single-account shortcut does not apply when the user has a choice',()=>{
 const s=say(initialState(),{operation:'run',functionId:'TR03',params:{amount:500,recipientId:'zhang-roommate'}},'给室友张三转500');
 assert.ok(currentWorkflow(s)!.missing.includes('accountId'));
});
