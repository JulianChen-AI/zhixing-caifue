import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,reduceBank} from '../lib/bank/engine.ts';
import {dispatchAction} from '../lib/plans/dispatch.ts';
import {currentWorkflow} from '../lib/workflows/engine.ts';
import {offlineWorkflow} from '../lib/workflows/offline.ts';
import {parseBillingQuery} from '../lib/workflows/billing-query.ts';
import {workflowToolResult} from '../lib/workflows/realtime.ts';
import {billingReplyIssue,queryReplyIssue,queryReviewFacts} from '../lib/voice/query-review.ts';
import {superviseReply} from '../lib/voice/supervision.ts';
import type {BankState,BankAction} from '../lib/bank/types.ts';
const apply=(s:BankState,a:BankAction)=>reduceBank(s,dispatchAction(s,a),crypto.randomUUID());
const query=(s:BankState,text:string,params:Record<string,unknown>={})=>apply(s,{type:'workflow',command:{operation:'run',functionId:'BI02',params,source:'voice',utterance:text}});
const totals=(s:BankState)=>(currentWorkflow(s)!.result as {current:{netExpenses:number;count:number}}).current;
const amount=(s:BankState)=>totals(s).netExpenses;

test('billing dates use Shanghai time and handle month/year rollover',()=>{
 assert.equal(parseBillingQuery('本月账单',undefined,new Date('2026-10-31T16:30:00Z')).params.period,'2026-11');
 const jan=new Date('2027-01-01T00:30:00+08:00');
 assert.equal(parseBillingQuery('上月账单',undefined,jan).params.period,'2026-12');
 assert.equal(parseBillingQuery('去年账单',undefined,jan).params.period,'2026');
 assert.equal(parseBillingQuery('今年账单',undefined,jan).params.period,'2027');
 assert.equal(parseBillingQuery('2026年13月账单').clarification?.field,'period');
 assert.equal(parseBillingQuery('上月和本月一共花了多少').clarification?.field,'period');
});

test('an empty model proposal cannot discard this-month coffee conditions or turn coffee into all drinks',t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-31T10:00:00Z')});
 const before=initialState(),s=query(before,'看看我这个月的账单，咖啡一共花了多少？',{category:'饮品'}),task=currentWorkflow(s)!;
 assert.equal(task.status,'complete');assert.deepEqual(task.params,{period:'2026-10',merchant:'咖啡店'});assert.equal(amount(s),2600);
 assert.deepEqual(s.plan!.steps.find(step=>step.taskId===task.id)!.params,task.params);
 assert.deepEqual(s.workflows!.records,before.workflows!.records);assert.deepEqual(s.accounts,before.accounts);assert.equal(s.receipts.length,0);
});

test('coffee merchant and the whole drink category remain different queries',()=>{
 const s=initialState();s.workflows!.records.transactions.push({id:'tea',merchant:'奶茶店',category:'饮品',date:'2026-10-19',amount:1800,kind:'expense',accountId:'daily'});
 const coffee=query(s,'查看2026年10月咖啡一共花了多少'),drinks=query(s,'查看2026年10月全部饮品支出');
 assert.equal(amount(coffee),2600);assert.equal(amount(drinks),4400);assert.equal(currentWorkflow(drinks)!.params.merchant,undefined);assert.equal(currentWorkflow(drinks)!.params.category,'饮品');
});

test('last-month video membership spending routes to billing rather than the subscription list',t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-31T10:00:00Z')});
 const text='上个月视频会员一共花了多少？',initial=initialState();assert.equal(offlineWorkflow(text,initial)!.functionId,'BI02');
 const s=query(initial,text);assert.equal(amount(s),2500);assert.equal(currentWorkflow(s)!.params.period,'2026-09');assert.equal(currentWorkflow(s)!.params.merchant,'视频会员');
 assert.ok(queryReviewFacts(s,text,0));
});
test('ordinary statistics and explicit all-filter requests remain usable',()=>{
 for(const text of ['查一下2026年10月收支统计','查看2026年10月净支出','看看2026年10月账单明细和退款']){
  assert.ok(offlineWorkflow(text,initialState()));assert.equal(parseBillingQuery(text,initialState()).clarification,undefined,text);
 }
 assert.deepEqual(parseBillingQuery('查看全部期间全部商户全部类别全部账户的账单',initialState()).params,{period:'',accountId:'',category:'',merchant:''});
});

test('a specific unmatched merchant returns an honest scoped empty result',()=>{
 const s=query(initialState(),'查2026年10月商户“银河咖啡店”的支出'),task=currentWorkflow(s)!;
 assert.equal(task.status,'complete');assert.equal(totals(s).count,0);assert.equal(amount(s),0);
 const result=workflowToolResult(s)!.result as {scope:{merchant:string};spokenSummary:string};
 assert.equal(result.scope.merchant,'银河咖啡店');assert.match(result.spokenSummary,/没有匹配/);assert.equal(billingReplyIssue(result,result.spokenSummary),undefined);
});

test('an ambiguous merchant stops before reading and a card choice resumes the same task',()=>{
 const before=initialState();before.workflows!.records.transactions.push({id:'other-coffee',merchant:'咖啡工坊',category:'饮品',date:'2026-10-19',amount:1800,kind:'expense',accountId:'daily'});
 let s=query(before,'查看2026年10月咖啡花了多少',{category:'饮品',merchant:'咖啡店'});const id=currentWorkflow(s)!.id;
 assert.equal(currentWorkflow(s)!.status,'collecting');assert.deepEqual(currentWorkflow(s)!.missing,['merchant']);assert.equal(currentWorkflow(s)!.result,null);assert.equal(currentWorkflow(s)!.params.category,undefined);
 s=apply(s,{type:'workflow',command:{operation:'amend',taskId:id,params:{merchant:'咖啡店'},source:'card'}});
 assert.equal(currentWorkflow(s)!.id,id);assert.equal(currentWorkflow(s)!.status,'complete');assert.equal(amount(s),2600);
});

test('separate unresolved conditions survive one clarification without broadening the other',()=>{
 const before=initialState();before.workflows!.records.transactions.push({id:'other-coffee',merchant:'咖啡工坊',category:'饮品',date:'2026-10-19',amount:1800,kind:'expense',accountId:'daily'});
 let s=query(before,'最近咖啡花了多少？');const id=currentWorkflow(s)!.id;
 assert.equal(currentWorkflow(s)!.queryClarifications!.length,2);
 s=apply(s,{type:'workflow',command:{operation:'amend',taskId:id,params:{period:'2026-10'},source:'card'}});
 assert.equal(currentWorkflow(s)!.status,'collecting');assert.deepEqual(currentWorkflow(s)!.missing,['merchant']);assert.equal(currentWorkflow(s)!.result,null);
 s=apply(s,{type:'workflow',command:{operation:'amend',taskId:id,params:{category:'饮品'},source:'card'}});
 assert.equal(currentWorkflow(s)!.status,'complete');assert.equal(amount(s),4400);
});

test('card-supplied account and merchant filters use the same reader and reject unknown accounts',()=>{
 let s=apply(initialState(),{type:'workflow',command:{operation:'run',functionId:'BI02',params:{period:'2026-10',accountId:'savings',merchant:'咖啡店'},source:'card'}});
 assert.equal(totals(s).count,0);assert.match((currentWorkflow(s)!.result as any).scope.label,/储蓄账户/);
 s=apply(initialState(),{type:'workflow',command:{operation:'run',functionId:'BI02',params:{accountId:'not-an-account'},source:'card'}});
 assert.equal(currentWorkflow(s)!.status,'blocked');assert.equal(currentWorkflow(s)!.result,null);
 assert.throws(()=>apply(initialState(),{type:'workflow',command:{operation:'run',functionId:'BI02',params:{period:'2026-13'},source:'card'}}),/有效年份或月份/);
 assert.throws(()=>apply(initialState(),{type:'workflow',command:{operation:'run',functionId:'BI02',params:{merchant:true},source:'card'}}),/查询条件需填写文本/);
});

test('the card and public tool share one scoped receipt and deterministic spoken summary',()=>{
 const s=query(initialState(),'查2026年10月咖啡花了多少'),task=currentWorkflow(s)!,result=workflowToolResult(s)!.result as any;
 assert.equal(result.current.netExpenses,26);assert.equal(result.scope.merchant,'咖啡店');assert.match(result.scope.label,/2026年10月/);assert.match(result.spokenSummary,/26.00元/);assert.equal(task.message,result.spokenSummary);
 for(const wrong of ['咖啡花了128元。','咖啡店净支出26元，外卖999元。','咖啡店退款26元，净支出0元。','2026年9月咖啡店净支出26元。','咖啡店净支出26元，共9笔。','饮品净支出26元。'])assert.ok(billingReplyIssue(result,wrong),wrong);
 assert.equal(billingReplyIssue(result,result.spokenSummary),undefined);
 assert.equal(billingReplyIssue(result,'咖啡店净支出二十六元。'),undefined);
 const facts=queryReviewFacts(s,'查2026年10月咖啡花了多少',0);assert.ok(facts);assert.equal(queryReplyIssue(facts,result.spokenSummary),undefined);
});

test('billing contradictions pause supervision without waiting for a model to agree',async()=>{
 const utterance='查2026年10月咖啡花了多少',s=query(initialState(),utterance);let calls=0;
 const result=await superviseReply(s,{utterance,reply:'咖啡店净支出128元。',reason:'completed',turnId:'billing-test',startRevision:0,repairAttempt:0,checkpoint:'speaking'}, {base:'https://example.invalid',planner:'stub'},undefined,async()=>{calls++;throw new Error('must not call reviewer');});
 assert.equal(result.decision,'pause');assert.equal(calls,0);
});
test('bill details can report a grounded individual transaction without confusing it with the aggregate',()=>{
 const s=apply(initialState(),{type:'workflow',command:{operation:'run',functionId:'BI01',params:{period:'2026-10'},source:'card'}}),result=workflowToolResult(s)!.result;
 assert.equal(billingReplyIssue(result,'咖啡店支出26元。'),undefined);
 assert.equal(billingReplyIssue(result,'校园食堂有一笔支出32元。'),undefined);
 assert.ok(billingReplyIssue(result,'咖啡店净支出128元。'));
});
