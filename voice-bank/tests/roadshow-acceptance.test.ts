import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,reduceBank,demoIntent} from '../lib/bank/engine.ts';
import type {BankState} from '../lib/bank/types.ts';
import {routeRequest} from '../lib/checklists/routing.ts';
import {currentWorkflow} from '../lib/workflows/engine.ts';
import {mascotCue} from '../lib/mascot/scenario.ts';

const act=(s:BankState,a:any)=>reduceBank(s,a,crypto.randomUUID());
const scene=(id:string)=>act(initialState(),{type:'load_scene',sceneId:id});
const card=(s:BankState,c:any)=>act(s,{type:'workflow',command:{source:'card',...c}});
const cue=(s:BankState)=>mascotCue({bank:s,phase:'idle',mode:'demo',muted:false,busy:false,connecting:false,closing:false,recovering:false,error:''}).action;
function confirm(s:BankState){let t=currentWorkflow(s)!;s=card(s,{operation:'confirm',taskId:t.id,token:t.reviewToken});t=currentWorkflow(s)!;if(t.status==='authenticate')s=card(s,{operation:'authenticate',taskId:t.id,token:t.verificationId,code:'123456'});return s;}

test('G01 无上下文验牌澄清且不产生资金写入',()=>{
 const s=scene('S01'),before=structuredClone(s),route=routeRequest('我要验牌',s);
 assert.equal(route.outcome,'clarify');assert.ok(route.question);assert.ok(route.unresolved.includes('intent'));assert.equal(route.draft,undefined);
 assert.equal(demoIntent('我要验牌',s).kind,'help');assert.deepEqual(s,before);
});

test('G02 更换收款人撤销旧核对令牌',()=>{
 let s=card(scene('S02-A'),{operation:'run',functionId:'TR03',params:{recipientId:'C02',accountId:'daily',amount:120}});
 const old=currentWorkflow(s)!;assert.equal(old.status,'review');
 s=card(s,{operation:'amend',taskId:old.id,params:{recipientId:'C01'}});const t=currentWorkflow(s)!;
 assert.equal(t.params.recipientId,'C01');assert.notEqual(t.reviewToken,old.reviewToken);
 assert.throws(()=>card(s,{operation:'confirm',taskId:t.id,token:old.reviewToken}));assert.equal(s.accounts[0].balance,114000);assert.equal(s.receipts.length,0);
});

test('G07 已有订单规则提醒切换S01不遗留旧记录',()=>{
 let s=scene('S08');s=act(s,{type:'plan',command:{operation:'create',source:'voice',utterance:'工资到了，老规矩'}});s=act(s,{type:'plan',command:{operation:'resume',source:'card'}});s=confirm(s);s=confirm(s);s=confirm(s);
 assert.ok(s.workflows!.records.orders.length);assert.ok(s.workflows!.records.rules.length);
 s.workflows!.records.aa=structuredClone(scene('S02-C').workflows!.records.aa);
 s=card(s,{operation:'run',functionId:'TR05',params:{action:'remind'}});s=confirm(s);
 const oldOrders=s.workflows!.records.orders.map(x=>x.id),oldRules=s.workflows!.records.rules.map(x=>x.id),oldReminders=s.workflows!.records.reminders.map(x=>x.id);
 assert.ok(oldReminders.length);s=act(s,{type:'load_scene',sceneId:'S01'});
 for(const [key,ids] of [['orders',oldOrders],['rules',oldRules],['reminders',oldReminders]] as const)assert.ok(s.workflows!.records[key].every(x=>!ids.includes(x.id)));
 assert.equal(s.receipts.length,0);assert.equal(s.plan,null);
});

test('G09 后台合成前提、用户卡片字段和确认令牌区分，不代表UI授权展示',()=>{
 let s=scene('S08');assert.equal(s.workflows!.records.questionnaires[0].label,'演示用合成测评');
 s=act(s,{type:'plan',command:{operation:'create',source:'voice',utterance:'工资到了，老规矩'}});s=act(s,{type:'plan',command:{operation:'resume',source:'card'}});
 let t=currentWorkflow(s)!;assert.equal(t.fieldEvidence!.amount.source,'saved-template');assert.equal(t.confirmedToken,null);
 s=card(s,{operation:'amend',taskId:t.id,params:{amount:1900}});t=currentWorkflow(s)!;assert.equal(t.fieldEvidence!.amount.source,'user-card');assert.equal(t.confirmedToken,null);
 const review=t.reviewToken;s=card(s,{operation:'confirm',taskId:t.id,token:review});t=currentWorkflow(s)!;assert.equal(t.confirmedToken,review);assert.equal(t.status,'authenticate');assert.equal(s.receipts.length,0);
});

test('G10 TRIP编号跨合成快照一致且取消的订阅后续未恢复',()=>{
 const a=scene('S05'),b=scene('S07');assert.equal(a.workflows!.records.goals[0].id,'TRIP-01');assert.equal(b.workflows!.records.goals[0].id,'TRIP-01');
 assert.equal(a.workflows!.records.rules[0].goalId,'TRIP-01');assert.equal(b.workflows!.records.rules[0].goalId,'TRIP-01');assert.equal(b.workflows!.records.transactions.length,24);assert.ok(b.workflows!.records.transactions.every(x=>x.goalId==='TRIP-01'&&x.synthetic===true));
 let s=scene('S01');for(const id of ['video-a','video-b']){s=card(s,{operation:'run',functionId:'SU04',params:{subscriptionId:id}});s=confirm(s);assert.equal(s.workflows!.records.subscriptions.find(x=>x.id===id)!.status,'cancelled');}
 s=act(s,{type:'load_scene',sceneId:'S04'});for(const id of ['video-a','video-b'])assert.equal(s.workflows!.records.subscriptions.find(x=>x.id===id)!.status,'cancelled');
});

test('G11 转账草稿与AA提醒预览等待且未发送',()=>{
 const draft=card(scene('S02-A'),{operation:'run',functionId:'TR03',params:{recipientId:'C02',accountId:'daily',amount:120}});
 assert.equal(currentWorkflow(draft)!.status,'review');assert.equal(cue(draft),'waiting');assert.equal(draft.receipts.length,0);
 const reminder=card(scene('S02-C'),{operation:'run',functionId:'TR05',params:{action:'remind'}});
 assert.equal(currentWorkflow(reminder)!.status,'review');assert.equal(cue(reminder),'waiting');assert.equal(reminder.workflows!.records.reminders.length,0);
});

test('G06 边界：AA手动核销不是支付回调，重复操作不伪造到账',()=>{
 let s=scene('S02-C');const before=s.accounts[0].balance,received=s.workflows!.records.aa[0].received;
 s=card(s,{operation:'run',functionId:'TR05',params:{action:'reconcile',sessionId:'AA-01'}});let t=currentWorkflow(s)!;
 s=card(s,{operation:'confirm',taskId:t.id,token:t.reviewToken});
 assert.equal(s.workflows!.records.aa[0].source,'用户手动核销，非支付通道回调');assert.equal(s.accounts[0].balance,before);assert.equal(s.workflows!.records.aa[0].received,received);
 const id='same-manual-aa-reconcile',action={type:'workflow',command:{operation:'status',source:'card',taskId:t.id}} as const;s=reduceBank(s,action,id);assert.equal(reduceBank(s,action,id),s);assert.equal(s.accounts[0].balance,before);
});
