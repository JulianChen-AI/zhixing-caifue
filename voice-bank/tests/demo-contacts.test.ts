import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,reduceBank,demoIntent} from '../lib/bank/engine.ts';
import {CONTACTS} from '../lib/bank/types.ts';
import {contactsOf,recipientCandidates,ambiguousRecipients} from '../lib/bank/recipients.ts';
import {parsedIntent,parsedIntentFor} from '../lib/bank/qwen.ts';
import {realtimeToolArguments,realtimeToolArgumentsFor,realtimeToolDecision,bankToolResult} from '../lib/bank/realtime-tools.ts';
import {routeRequest} from '../lib/checklists/routing.ts';
import {voiceSettings} from '../lib/voice/qwen-protocol.ts';
import {choices,assertVoiceEvidence} from '../lib/workflows/fields.ts';
import {extractParams} from '../lib/plans/decompose.ts';
import {readTool} from '../lib/workflows/adapters.ts';
import {currentWorkflow} from '../lib/workflows/engine.ts';
import {businessNow,businessDay} from '../lib/demo/clock.ts';
import {monthlyReport,goalPlan,assertCancellation,cancellationDeadline} from '../lib/workflows/business-lite.ts';
import {redemptionQuote} from '../lib/workflows/presentation-lite.ts';

const load=(id='S02-A')=>reduceBank(initialState(),{type:'load_scene',sceneId:id},crypto.randomUUID());
const ids=(contacts=CONTACTS)=>contacts.map(c=>c.id);
test('state contacts preserve default and deliberately empty directories',()=>{
 const before=structuredClone(initialState());assert.equal(contactsOf(before),CONTACTS);
 const empty={...before,contacts:[]};assert.deepEqual(contactsOf(empty),[]);assert.deepEqual(recipientCandidates('室友张三',[],contactsOf(empty)),[]);
 const scene=load();assert.deepEqual(ids(contactsOf(scene)),['C01','C02','C03']);assert.deepEqual(ids(contactsOf(initialState())),ids(CONTACTS));
});
test('four matching paths use the same names, aliases and conflict constraints',()=>{
 const s=load(),contacts=contactsOf(s),tails=s.accounts.map(a=>a.tail),text='从日常账户给打羽毛球的张三转120元';
 assert.deepEqual(ambiguousRecipients('给张三转120',tails,contacts).map(c=>c.id),['C01','C02','C03']);
 assert.deepEqual(recipientCandidates('zhang san 羽毛球',tails,contacts).map(c=>c.id),['C02']);
 assert.deepEqual(recipientCandidates('羽毛球张三尾号0186',tails,contacts),[]);
 assert.equal(routeRequest(text,s).draft?.recipientId,'C02');assert.equal(demoIntent(text,s).recipientId,'C02');
 assert.equal(realtimeToolDecision({operation:'update_transfer',recipientId:'C02',accountId:'daily',amount:120},s,text).draft?.recipientId,'C02');
 assert.equal(extractParams(text,'TR03',s).recipientId,'C02');
 assert.doesNotThrow(()=>assertVoiceEvidence(s,{functionId:'TR03',params:{}},{recipientId:'C02'},'打羽毛球那个'));
 assert.throws(()=>assertVoiceEvidence(s,{functionId:'TR03',params:{}},{recipientId:'C01'},'打羽毛球那个'));
});
test('current IDs constrain planner, realtime validation and model schemas without cache pollution',()=>{
 const contacts=contactsOf(load()),intent={kind:'transfer',amount:12000,recipientId:'C02',accountId:'daily',note:null};
 assert.equal(parsedIntentFor(contacts).safeParse(intent).success,true);assert.equal(parsedIntent.safeParse(intent).success,false);
 assert.equal(parsedIntentFor(contacts).safeParse({...intent,recipientId:'zhang-roommate'}).success,false);
 assert.equal(realtimeToolArgumentsFor(contacts).safeParse({operation:'update_transfer',recipientId:'C02'}).success,true);
 assert.equal(realtimeToolArguments.safeParse({operation:'update_transfer',recipientId:'C02'}).success,false);
 assert.equal(realtimeToolArgumentsFor([]).safeParse({operation:'update_transfer',recipientId:'C02'}).success,false);
 assert.equal(parsedIntentFor([]).safeParse({...intent,recipientId:null}).success,true);
 const toolIds=(list=CONTACTS)=>(voiceSettings('Tina','',list).tools[0].function.parameters.properties as any).recipientId.enum;
 assert.deepEqual(toolIds(contacts),['C01','C02','C03',null]);const settings=voiceSettings('Tina','',contacts);
 (settings.tools[0].function.parameters.properties as any).recipientId.enum.push('injected');
 assert.deepEqual(toolIds(contacts),['C01','C02','C03',null]);assert.deepEqual(toolIds(),[...ids(),null]);
});
test('UI choices and read tools do not promote personal notes into executable payees',()=>{
 const s=load(),before=ids(contactsOf(s));s.workflows!.records.contacts.push({id:'personal-note',name:'另一个人',source:'用户记录'});
 assert.deepEqual(choices(s,'recipientId').map(c=>c.value),before);assert.deepEqual((readTool(s,'T03') as {id:string}[]).map(c=>c.id),before);
 assert.deepEqual(bankToolResult(s).contacts?.map(c=>c.id),before);
 const blocked=reduceBank(s,{type:'workflow',command:{operation:'run',functionId:'TR03',params:{recipientId:'personal-note',accountId:'daily',amount:120},source:'card'}},crypto.randomUUID());
 assert.equal(currentWorkflow(blocked)!.status,'blocked');assert.equal(blocked.receipts.length,0);
});
// Stage 5: a new payee is no longer refused outright; it is reviewed as new and settled only through the delayed path.
test('Li Ming stays a new payee: reviewed as new and never settled immediately',()=>{
 const s=load('S07');assert.equal(contactsOf(s)[0].previouslyUsed,false);
 const next=reduceBank(s,{type:'workflow',command:{operation:'run',functionId:'TR03',params:{recipientId:'RENT-7742',accountId:'daily',amount:2000,note:'租房押金'},source:'card'}},crypto.randomUUID());
 assert.equal(currentWorkflow(next)!.status,'review');assert.match(currentWorkflow(next)!.message,/新收款人.*不能代替账户核验/);assert.equal(next.accounts[0].balance,510000);assert.equal(next.receipts.length,0);
});
test('scene recipient ordinals stay unresolved until a versioned displayed list is implemented',()=>{
 const state=reduceBank(load(),{type:'intent',intent:{kind:'transfer',amount:12000,accountId:'daily'}},crypto.randomUUID());
 assert.equal(state.task!.step,'recipient');
 const realtime=realtimeToolDecision({operation:'update_transfer',recipientId:'C02'},state,'第二个');
 assert.ok(realtime.unresolved.includes('recipient'));assert.notEqual(realtime.draft?.recipientId,'C02');
 const routed=routeRequest('第二个',state);assert.ok(routed.unresolved.includes('recipient'));assert.notEqual(routed.draft?.recipientId,'C02');
 assert.equal(state.receipts.length,0);
 const reset=reduceBank(state,{type:'reset'},crypto.randomUUID());
 const defaults=reduceBank(reset,{type:'intent',intent:{kind:'transfer',amount:12000,accountId:'daily'}},crypto.randomUUID());
 assert.equal(realtimeToolDecision({operation:'update_transfer',recipientId:'zhang-landlord'},defaults,'第二个').draft?.recipientId,'zhang-landlord');
});
test('business clock affects only scoped dates, goal deadlines and report fallback',()=>{
 const s=load('S05');s.demoClock='2031-12-31T16:30:00.000Z';assert.equal(businessDay(s),'2032-01-01');
 s.workflows!.records.transactions=[];assert.equal(monthlyReport(s,{},{}).period,'2032-01');
 assert.equal(monthlyReport(s,{period:'2026-10'},{}).period,'2026-10');
 assert.throws(()=>goalPlan(s,{target:2400,deadline:'2031-12-31'}));assert.equal(goalPlan(s,{target:2400,deadline:'2032-12-31'}).target,240000);
 const at=businessNow(s),order={id:'pending',action:'subscribe',status:'pending',createdAt:s.demoClock,cancelUntil:cancellationDeadline(at)};
 assert.doesNotThrow(()=>assertCancellation(order,at));assert.throws(()=>assertCancellation(order,at+86400000));
 const before=Date.now();assert.ok(businessNow(initialState())>=before);assert.ok(businessNow(initialState())<=Date.now());
});
test('redemption estimate uses simulated Beijing workday without claiming settlement',()=>{
 const s=load('S03');s.demoClock='2033-01-07T04:00:00.000Z';s.workflows!.records.holdings.push({id:'h',productId:'product-a',value:10000,cost:10000});
 const quote=redemptionQuote(s,{holdingId:'h',amount:10}) as {estimatedArrivalAt:string};assert.equal(quote.estimatedArrivalAt,'2033-01-10');
 assert.equal(s.workflows!.records.orders.length,0);assert.equal(s.accounts[0].balance,300000);
});
