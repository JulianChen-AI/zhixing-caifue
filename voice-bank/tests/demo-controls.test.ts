import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,reduceBank} from '../lib/bank/engine.ts';
import {assertSceneEpoch,demoControlReplay} from '../lib/demo/control.ts';
import type {BankAction,BankState} from '../lib/bank/types.ts';
import type {FlowTask} from '../lib/workflows/types.ts';

const load=(state:BankState,id='S05',requestId=crypto.randomUUID())=>reduceBank(state,{type:'load_scene',sceneId:id},requestId);
const advance=(state:BankState,to='2031-05-01T04:00:00.000Z',id=crypto.randomUUID())=>reduceBank(state,{type:'advance_clock',to},id);
const fake=(functionId:string,status:FlowTask['status'],params:Record<string,unknown>={}):FlowTask=>({id:crypto.randomUUID(),functionId,title:'合成测试',params,status,missing:[],steps:[],reviewToken:null,verificationId:null,confirmedToken:null,result:null,message:'',createdAt:'2031-04-01T04:00:00.000Z'});
const code=(fn:()=>unknown)=>assert.throws(fn,(e:any)=>e.status===409&&e.field==='sceneEpoch');

test('scene controls replay only matching id, fingerprint, source and current epoch',()=>{
 const original=initialState(),action:BankAction={type:'load_scene',sceneId:'S05'},next=reduceBank(original,action,'control-id-01');
 assert.equal(next.revision,1);assert.ok(next.sceneEpoch);assert.equal(demoControlReplay(next,action,'control-id-01',undefined),true);
 assert.equal(reduceBank(next,action,'control-id-01'),next);assert.equal(demoControlReplay(next,action,'other-id',undefined),false);
 code(()=>demoControlReplay(next,action,'control-id-01','different'));code(()=>demoControlReplay(next,{type:'load_scene',sceneId:'S01'},'control-id-01',undefined));
 code(()=>reduceBank(next,{type:'load_scene',sceneId:'S01'},'control-id-01'));code(()=>assertSceneEpoch(next,undefined));assertSceneEpoch(next,next.sceneEpoch);
});
test('scene ABA and old ids remain fenced after reset',()=>{
 const first=load(initialState(),'S01','control-id-01'),second=load(first,'S02-A','control-id-02');
 const reset=reduceBank(second,{type:'reset'},'control-id-03');assert.equal(reset.sceneId,'default');assert.ok(reset.sceneEpoch);assert.notEqual(reset.sceneEpoch,first.sceneEpoch);assert.equal(reset.revision,3);
 code(()=>assertSceneEpoch(reset,first.sceneEpoch));code(()=>reduceBank(reset,{type:'load_scene',sceneId:'S01'},'control-id-01'));
 assert.equal(reset.accounts.length,initialState().accounts.length);assert.equal(reset.task,null);assert.equal(reset.receipts.length,0);
});
test('load and reset block authentication but discard ordinary drafts',()=>{
 const state=load(initialState(),'S02-A');state.task={policyVersion:state.policyVersion,id:'draft',step:'authenticate',recipientId:'C02',amount:10000,accountId:'daily',riskSignals:[],note:'',confirmedRevision:state.revision,verificationId:crypto.randomUUID()};
 assert.throws(()=>load(state,'S01'),(e:any)=>e.status===409);assert.throws(()=>reduceBank(state,{type:'reset'},crypto.randomUUID()),(e:any)=>e.status===409);
 state.task.step='review';const next=load(state,'S01');assert.equal(next.task,null);
 const other=load(initialState(),'S05');other.workflows!.tasks.push(fake('IN08','authenticate'));
 assert.throws(()=>load(other,'S01'),(e:any)=>e.status===409);assert.throws(()=>reduceBank(other,{type:'reset'},crypto.randomUUID()),(e:any)=>e.status===409);
});
test('advance requires a valid forward ISO instant and blocks write review or authentication',()=>{
 const base=initialState();assert.throws(()=>advance(base));const s=load(base,'S05');assert.ok(s.demoClock);
 for(const to of ['2031-02-30T04:00:00.000Z','2031-03-25T04:00:00.000Z','2030-01-01T00:00:00.000Z','2031-05-01'])assert.throws(()=>advance(s,to));
 for(const status of ['review','authenticate'] as const){const blocked=structuredClone(s);blocked.workflows!.tasks.push(fake('IN08',status));assert.throws(()=>advance(blocked),(e:any)=>e.status===409);}
 const legacy=structuredClone(s);legacy.task={policyVersion:legacy.policyVersion,id:'x',step:'review',recipientId:null,amount:null,accountId:null,riskSignals:[],note:'',confirmedRevision:null,verificationId:null};assert.throws(()=>advance(legacy),(e:any)=>e.status===409);
});
// Stage 5: advancing time runs only due saved goal deposits (and due delayed transfers); orders and AA stay untouched.
test('forward clock runs only due goal deposits, never settles orders or executes AA',()=>{
 const s=load(initialState(),'S05');s.workflows!.records.orders.push({id:'pending-order',status:'pending'});s.workflows!.records.aa.push({id:'pending-aa',status:'awaiting_participants'});
 const before=structuredClone(s.workflows!.records);const next=advance(s);
 assert.equal(next.demoClock,'2031-05-01T04:00:00.000Z');assert.notEqual(next.sceneEpoch,s.sceneEpoch);assert.equal(next.revision,s.revision+1);
 assert.deepEqual(next.workflows!.records.orders,before.orders);assert.deepEqual(next.workflows!.records.aa,before.aa);assert.deepEqual(next.receipts,s.receipts);
 assert.equal(next.accounts[0].balance,s.accounts[0].balance-20000);assert.equal(next.workflows!.records.goals[0].balance,20000);
 assert.deepEqual((next.workflows!.records.rules[0].executions as {date:string}[]).map(x=>x.date),['2031-04-01','2031-05-01']);
});
test('legacy transfer uses simulated receipt time and China calendar day',()=>{
 let s=load(initialState(),'S02-A');s.demoClock='2027-10-25T16:30:00.000Z';
 s=reduceBank(s,{type:'intent',intent:{kind:'transfer',recipientId:'C02',amount:1000,accountId:'daily'}},crypto.randomUUID());
 s=reduceBank(s,{type:'confirm'},crypto.randomUUID());const verificationId=s.task!.verificationId!;
 s=reduceBank(s,{type:'authenticate',code:'123456',verificationId},crypto.randomUUID());
 assert.equal(s.receipts[0].createdAt,'2027-10-25T16:30:00.000Z');assert.equal(s.workflows!.records.transactions.at(-1)?.date,'2027-10-26');
});
test('reset replay requires exact source epoch and cannot survive another scene change',()=>{
 const first=load(initialState(),'S01','reset-source-1');const resetAction:BankAction={type:'reset'};
 const reset=reduceBank(first,resetAction,'reset-request-1');assert.equal(demoControlReplay(reset,resetAction,'reset-request-1',first.sceneEpoch),true);
 code(()=>demoControlReplay(reset,resetAction,'reset-request-1',undefined));assert.equal(reduceBank(reset,resetAction,'reset-request-1'),reset);
 const changed=load(reset,'S02-A','reset-source-2');assert.equal(demoControlReplay(changed,resetAction,'reset-request-1',first.sceneEpoch),false);
 code(()=>reduceBank(changed,resetAction,'reset-request-1'));code(()=>assertSceneEpoch(changed,first.sceneEpoch));
 const stale={...changed,lastDemoControl:reset.lastDemoControl};code(()=>demoControlReplay(stale,resetAction,'reset-request-1',first.sceneEpoch));
});
test('control audit uses real time, replaces loaded history and never claims financial execution',()=>{
 const before=Date.now(),loaded=load(initialState(),'S05'),entry=loaded.audit.at(-1)!;
 assert.equal(loaded.audit.length,1);assert.equal(entry.workflowId,'DEMO-CONTROL');assert.equal(entry.action,'load_scene');assert.match(entry.reason||'',/合成.*S05/);assert.match(entry.reason||'',/未执行业务/);
 assert.ok(Date.parse(entry.at)>=before&&Date.parse(entry.at)<=Date.now());
 const changed=advance(loaded),audit=changed.audit.at(-1)!;assert.equal(changed.audit.length,2);assert.equal(audit.workflowId,'DEMO-CONTROL');assert.match(audit.reason||'',/S05.*2031-05-01T04:00:00.000Z/);assert.match(audit.reason||'',/模拟调度：.*目标存入/);assert.ok(Date.parse(audit.at)>=before&&Date.parse(audit.at)<=Date.now());
 const fresh=load(changed,'S01');assert.equal(fresh.audit.length,1);assert.match(fresh.audit[0].reason||'',/合成.*S01/);
});
