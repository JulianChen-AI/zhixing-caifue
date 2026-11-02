import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,reduceBank} from '../lib/bank/engine.ts';
import type {BankState} from '../lib/bank/types.ts';
import {currentWorkflow} from '../lib/workflows/engine.ts';
import {dispatchAction} from '../lib/plans/dispatch.ts';
import {aaShares,reminderDrafts} from '../lib/workflows/aa.ts';
import {workflowReview} from '../lib/workflows/review.ts';

const scene=(sceneId:string)=>reduceBank(initialState(),{type:'load_scene',sceneId},crypto.randomUUID());
const say=(s:BankState,command:Record<string,unknown>,utterance:string)=>reduceBank(s,dispatchAction(s,{type:'workflow',command:{source:'voice',utterance,turnId:crypto.randomUUID(),...command} as never},utterance),crypto.randomUUID());
const six=['我','张三','林悦','周扬','陈宁','许然'];
const drinks=[{label:'饮料',amount:60,participants:['张三','林悦','周扬']}];
const amounts=(shares:{name:string;amount:number}[])=>Object.fromEntries(shares.map(x=>[x.name,x.amount]));
const create=()=>say(scene('S02-B'),{operation:'run',functionId:'TR05',params:{action:'create',total:360,participants:six}},'昨天聚餐我付了360，我、张三、林悦、周扬、陈宁、许然六个人，帮我AA一下。');

test('X09 equal split first, then the drinks carve-out gives 50/70 and 310 receivable',()=>{
 let s=create(),t=currentWorkflow(s)!;
 assert.equal(t.status,'review');assert.match(t.message,/6人均分，每人60元.*应收300元/);
 s=say(s,{operation:'amend',taskId:t.id,params:{adjustments:drinks}},'等一下，里面60块是饮料，只有张三、林悦、周扬喝了，我没喝。');
 t=currentWorkflow(s)!;const preview=t.result as {participants:{name:string;amount:number;status:string}[];receivable:number};
 assert.deepEqual(amounts(preview.participants),{我:5000,张三:7000,林悦:7000,周扬:7000,陈宁:5000,许然:5000});
 assert.equal(preview.receivable,31000);assert.equal(preview.participants.reduce((n,x)=>n+x.amount,0),36000);
 assert.equal(preview.participants[0].status,'self');assert.match(t.message,/你承担50元，向其他5人应收310元/);
 const before=s.accounts[0].balance;
 s=say(s,{operation:'confirm',taskId:t.id,token:t.reviewToken},'对，就这样，先让大家看一下。');
 const aa=s.workflows!.records.aa.at(-1)!;assert.equal(aa.status,'awaiting_participants');assert.equal(aa.receivable,31000);assert.equal(aa.received,0);
 assert.equal(s.accounts[0].balance,before,'creating the AA never charges the meal again');
});

test('X10 a head count is not a list of names for the carve-out',()=>{
 const s=create(),t=currentWorkflow(s)!;
 assert.throws(()=>say(s,{operation:'amend',taskId:t.id,params:{adjustments:drinks}},'里面60块是饮料，只有三个人喝了'),/具体是哪几位/);
 assert.throws(()=>aaShares(36000,six,[{label:'饮料',amount:60,participants:[]}]),/具体是哪几位/);
 assert.throws(()=>aaShares(36000,six,[{label:'饮料',amount:60,participants:['王五']}]),/不在 AA 名单/);
 assert.throws(()=>aaShares(36000,six,[{label:'饮料',amount:360,participants:['张三']}]),/小于 AA 总额/);
});

test('uneven totals keep every cent',()=>{
 const plan=aaShares(10000,['我','甲','乙'],[{label:'饮料',amount:10,participants:['甲','乙']}]);
 assert.equal(plan.shares.reduce((n,x)=>n+x.amount,0),10000);assert.match(plan.rule,/余下的分/);
});

test('X12 X13 reminders re-read payment state and only go to unpaid people',()=>{
 let s=scene('S02-C');const aa=s.workflows!.records.aa[0];
 assert.equal(aa.received,19000);assert.equal(aa.outstanding,12000);assert.equal(s.accounts[0].balance,121000);
 assert.deepEqual(reminderDrafts(aa).map(x=>[x.to,x.amount]),[['周扬',7000],['许然',5000]]);
 s=say(s,{operation:'run',functionId:'TR05',params:{action:'remind'}},'没付的帮我提醒一下，别写得像我特别着急。');
 let t=currentWorkflow(s)!;assert.equal(t.status,'review');assert.match(t.message,/周扬（70元）、许然（50元）/);assert.doesNotMatch(t.message,/不着急/);
 // 周扬 pays before the user confirms: he is dropped at send time.
 (s.workflows!.records.aa[0].participants as {name:string;status:string}[]).find(x=>x.name==='周扬')!.status='paid';
 s=say(s,{operation:'confirm',taskId:t.id,token:t.reviewToken},'可以，发吧。');
 t=currentWorkflow(s)!;assert.equal(t.status,'complete');
 const sent=s.workflows!.records.reminders;assert.deepEqual(sent.map(x=>x.to),['许然']);assert.ok(sent.every(x=>x.status==='simulated_sent'&&x.channel==='模拟通道'));
 assert.equal(s.workflows!.records.aa[0].received,19000,'sending a reminder does not change collection');
});

test('X14 cancelling the reminder sends nothing; X13 nobody left to remind',()=>{
 let s=say(scene('S02-C'),{operation:'run',functionId:'TR05',params:{action:'remind'}},'没付的帮我提醒一下');
 s=say(s,{operation:'cancel',taskId:currentWorkflow(s)!.id},'算了，先不提醒了，取消吧');
 assert.equal(currentWorkflow(s)!.status,'cancelled');assert.equal(s.workflows!.records.reminders.length,0);
 s=say(scene('S02-D'),{operation:'run',functionId:'TR05',params:{action:'remind'}},'没付的帮我提醒一下');
 assert.equal(currentWorkflow(s)!.status,'blocked');assert.equal(s.workflows!.records.reminders.length,0);
});

test('the review card and spoken review read the drinks carve-out as text, not an object',()=>{
 let s=create(),t=currentWorkflow(s)!;
 s=say(s,{operation:'amend',taskId:t.id,params:{adjustments:drinks}},'等一下，里面60块是饮料，只有张三、林悦、周扬喝了，我没喝。');
 const review=workflowReview(s,currentWorkflow(s)!);
 assert.equal(review.entries.find(e=>e.key==='adjustments')?.value,'饮料 ¥60.00：张三、林悦、周扬分摊');
 assert.doesNotMatch(review.spokenSummary,/object Object/);
});
