import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduceBank } from '../lib/bank/engine.ts';
import { currentWorkflow } from '../lib/workflows/engine.ts';
import { runQuickReview } from '../lib/workflows/quick-review.ts';
import { assertCancellation, assertAaLimit, appendTransaction, monthlyReport } from '../lib/workflows/business-lite.ts';
import { workflowToolResult } from '../lib/workflows/realtime.ts';
import type { BankState } from '../lib/bank/types.ts';
import type { Params, WorkflowCommand } from '../lib/workflows/types.ts';
const act=(s:BankState,c:Omit<WorkflowCommand,'source'>,requestId=crypto.randomUUID())=>reduceBank(s,{type:'workflow',command:{...c,source:'card'}},requestId);
const run=(s:BankState,id:string,params:Params={})=>act(s,{operation:'run',functionId:id,params});
function finish(s:BankState){let t=currentWorkflow(s)!;assert.equal(t.status,'review',t.message);s=act(s,{operation:'confirm',taskId:t.id,token:t.reviewToken!});t=currentWorkflow(s)!;if(t.status==='authenticate')s=act(s,{operation:'authenticate',taskId:t.id,token:t.verificationId!,code:'123456'});assert.equal(currentWorkflow(s)!.status,'complete',currentWorkflow(s)!.message);return s;}
for(const c of runQuickReview().filter(c=>c.id!==20))test(`lite #${c.id} ${c.title}`,()=>assert.equal(c.pass,true,c.evidence));

test('cancellation follows Shanghai date boundary, rejects malformed dates and cannot cancel redemptions',()=>{
 const at=Date.parse('2026-10-27T00:00:00+08:00');
 assert.throws(()=>assertCancellation({id:'x',status:'pending',action:'subscribe',createdAt:'2026-10-26T23:59:59+08:00'},at));
 assert.doesNotThrow(()=>assertCancellation({id:'x',status:'pending',action:'subscribe',createdAt:'2026-10-27T00:00:00+08:00'},at));
 assert.throws(()=>assertCancellation({id:'x',status:'pending',action:'subscribe',createdAt:'unknown'},at));
 assert.throws(()=>assertCancellation({id:'x',status:'pending',action:'redeem',createdAt:new Date(at).toISOString()},at));
});

test('AA count is rechecked at confirmation; an old review cannot create a sixth entry',()=>{
 let s=initialState();for(let i=0;i<4;i++)s=finish(run(s,'TR05',{action:'create',total:1,participants:['甲','乙']}));
 s=run(s,'TR05',{action:'create',total:1,participants:['甲','乙']});const pending=currentWorkflow(s)!;
 s=finish(run(s,'TR05',{action:'create',total:1,participants:['甲','乙']}));
 s=act(s,{operation:'confirm',taskId:pending.id,token:pending.reviewToken!});assert.equal(currentWorkflow(s)!.status,'blocked');assert.equal(s.workflows!.records.aa.length,5);
});

test('AA day accounting uses Shanghai midnight rather than host timezone',()=>{
 const s=initialState(),at=Date.parse('2026-10-27T00:00:00+08:00');
 for(let i=0;i<5;i++)s.workflows!.records.aa.push({id:String(i),createdAt:'2026-10-26T23:59:59+08:00'});
 assert.doesNotThrow(()=>assertAaLimit(s,5000,at));
 for(const r of s.workflows!.records.aa)r.createdAt='2026-10-27T00:00:00+08:00';
 assert.throws(()=>assertAaLimit(s,1,at));
});

test('latest explicit future merchant correction wins, single correction does not silently make a future rule',()=>{
 let s=finish(run(initialState(),'BI03',{transactionId:'txn-coffee',category:'人情往来',scope:'future'}));
 s=finish(run(s,'BI03',{transactionId:'txn-coffee',category:'饮品',scope:'future'}));
 assert.equal(s.workflows!.records.categories.filter(r=>r.merchant==='咖啡店').length,1);
 let r=appendTransaction(s,{id:'new-coffee',merchant:'咖啡店',date:'2026-10-26',amount:100,kind:'expense'});assert.equal(r.category,'饮品');
 s=finish(run(s,'BI03',{transactionId:'new-coffee',category:'人情往来',scope:'single'}));
 r=appendTransaction(s,{id:'new-coffee-2',merchant:'咖啡店',date:'2026-10-26',amount:100,kind:'expense'});assert.equal(r.category,'饮品');
});

test('report preserves negative refund categories and uses matching summary for omitted period',()=>{
 const s=initialState();s.workflows!.records.transactions.push({id:'big-refund',date:'2026-10-26',merchant:'退货',category:'购物',kind:'refund',amount:20000});
 const report=monthlyReport(s,{period:'2026-10'},{}) as any;
 assert.equal(report.categoryBreakdown.find((r:any)=>r.category==='购物').netExpenses,-20000);
 assert.equal(report.categoryBreakdown.reduce((n:number,r:any)=>n+r.netExpenses,0),report.summary.netExpenses);
 const auto=monthlyReport(s,{}, {}) as any;assert.equal(auto.categoryBreakdown.reduce((n:number,r:any)=>n+r.netExpenses,0),auto.summary.netExpenses);
});

test('new money fields stay cents internally and yuan in model output',()=>{
 const s=run(initialState(),'IN09',{holdingId:'holding-cash',accountId:'daily',amount:40});
 const result=workflowToolResult(s)!.preview as any;assert.equal(result.netAmount,40);assert.equal(result.fee,0);
 const report=workflowToolResult(run(initialState(),'BI06',{period:'2026-10'}))!.result as any;
 assert.equal(report.comparison.baselineNetExpenses,25);assert.equal(report.comparison.changeAmount,78);
});

test('updated goal preview does not change saved rules until confirmation; duplicate confirm cannot mutate twice',()=>{
 let s=finish(run(initialState(),'IN01',{name:'目标',target:3000,deadline:new Date(Date.now()+240*86400000).toISOString().slice(0,10),autoSave:true,accountId:'daily',schedule:'每月1日'}));
 const g=s.workflows!.records.goals.at(-1)!,amount=s.workflows!.records.rules.at(-1)!.amount;
 s=run(s,'IN04',{action:'update',goalId:g.id,target:6000});assert.equal(s.workflows!.records.rules.at(-1)!.amount,amount);
 const t=currentWorkflow(s)!;assert.ok(Number((t.result as any).monthlyAmount)>Number(amount));
 s=finish(s);const after=s.workflows!.records.rules.at(-1)!.amount;assert.ok(Number(after)>Number(amount));
 assert.throws(()=>act(s,{operation:'confirm',taskId:t.id,token:t.reviewToken!}));assert.equal(s.accounts[0].balance,1286500);
});

test('comparison risk readings are not mistakenly serialized as monetary cents',()=>{
 const r=workflowToolResult(run(initialState(),'IN07',{productIds:['fund-cash','fund-bond']}))!.result as any;
 assert.deepEqual(r.differences.find((d:any)=>d.field==='risk').values.map((v:any)=>v.reading),[1,3]);
});

test('nonjudicial card query keeps its own restriction route and generic daily purpose selects debit',()=>{
 const risk=currentWorkflow(run(initialState(),'CA05',{action:'query',cardId:'card-risk'}))!.result as any;assert.equal(risk.canSelfUnlock,true);assert.equal(risk.materials,undefined);
 const guide=currentWorkflow(run(initialState(),'CA03',{action:'guide',purpose:'日常消费'}))!.result as any;assert.equal(guide.recommendedPath,'debit');
});
