import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,reduceBank} from '../lib/bank/engine.ts';
import {CONTACTS,type BankState} from '../lib/bank/types.ts';
import {currentWorkflow} from '../lib/workflows/engine.ts';
import {buildScene,SCENE_IDS,SCENE_MANIFEST} from '../lib/demo/scenes.ts';
const make=(id:string)=>buildScene(id,initialState());
const record=(s:BankState,k:string)=>s.workflows!.records[k];
const balance=(s:BankState)=>s.accounts.find(a=>a.id==='daily')!.balance;
test('fixtures are independent and do not mutate default data',()=>{
 const base=initialState(),before=structuredClone(base),defaultContacts=structuredClone(CONTACTS);
 assert.equal(SCENE_IDS.length,15);assert.equal(new Set(SCENE_IDS).size,15);
 for(const id of SCENE_IDS){const s=buildScene(id,base);assert.notEqual(s,base);assert.ok(SCENE_MANIFEST.some(item=>item.id===id));if(id!=='default'){assert.equal(s.task,null);assert.equal(s.plan,null);assert.deepEqual(s.workflows!.tasks,[]);assert.deepEqual(record(s,'orders'),[]);assert.deepEqual(record(s,'reminders'),[]);}}
 assert.deepEqual(base,before);assert.deepEqual(CONTACTS,defaultContacts);assert.throws(()=>buildScene('unknown',base));
});
test('S01 totals, individual coffee and subscription history',()=>{
 const s=make('S01'),month=record(s,'transactions').filter(x=>String(x.date).startsWith('2026-10'));
 assert.equal(balance(s),28660);assert.equal(month.filter(x=>x.kind==='income').reduce((a,x)=>a+Number(x.amount),0),200000);assert.equal(month.filter(x=>x.kind==='expense').reduce((a,x)=>a+Number(x.amount),0),171340);
 assert.equal(month.length,67);assert.equal(record(s,'transactions').length,71);
 for(const [category,count,total] of [['餐饮',20,82000],['交通',12,12000],['日用品',4,26000],['书籍',2,20000],['咖啡',26,25740]] as const){const items=month.filter(x=>x.category===category);assert.equal(items.length,count);assert.equal(items.reduce((sum,x)=>sum+Number(x.amount),0),total);}
 assert.equal(month.filter(x=>x.merchant==='咖啡').length,26);assert.ok(month.filter(x=>x.merchant==='咖啡').every(x=>x.amount===990));
 for(const n of ['视频A','视频B'])assert.equal(record(s,'transactions').filter(x=>x.merchant===n).length,3);assert.deepEqual(record(s,'subscriptions').map(x=>x.amount),[2500,3100]);
});
test('S02 snapshots and confirmed C02 transfer have equivalent projection',()=>{
 const load=(sceneId:string)=>reduceBank(initialState(),{type:'load_scene',sceneId},crypto.randomUUID());
 const a=load('S02-A'),direct=load('S02-B');assert.equal(balance(a),114000);assert.deepEqual(a.contacts!.map(c=>c.id),['C01','C02','C03']);assert.ok(a.contacts!.every(c=>c.previouslyUsed));assert.deepEqual(record(a,'aa'),[]);assert.deepEqual(record(direct,'aa'),[]);
 const act=(s:BankState,command:any)=>reduceBank(s,{type:'workflow',command:{source:'card',...command}},crypto.randomUUID());
 let s=act(a,{operation:'run',functionId:'TR03',params:{recipientId:'C02',accountId:'daily',amount:120,note:'球场费'}});let t=currentWorkflow(s)!;assert.equal(t.status,'review',t.message);
 s=act(s,{operation:'confirm',taskId:t.id,token:t.reviewToken});t=currentWorkflow(s)!;assert.equal(t.status,'authenticate');s=act(s,{operation:'authenticate',taskId:t.id,token:t.verificationId,code:'123456'});
 const projection=(x:BankState)=>({balance:balance(x),receipts:x.receipts.length,recipient:x.receipts[0]?.recipientId,amount:x.receipts[0]?.amount,aa:record(x,'aa')});assert.deepEqual(projection(s),projection(direct));
 for(const [id,value,received,outstanding] of [['S02-C',121000,19000,12000],['S02-D',133000,31000,0]] as const){const x=make(id);assert.equal(balance(x),value);assert.equal(record(x,'aa')[0].received,received);assert.equal(record(x,'aa')[0].outstanding,outstanding);}
});
test('later fixtures distinguish synthetic facts from execution',()=>{
 const s03=make('S03');assert.equal(balance(s03),300000);assert.equal(record(s03,'orders').length,0);assert.equal(record(s03,'holdings').length,0);assert.equal(s03.workflows!.riskProfile!.level,3);
 const s04=make('S04');assert.equal(s04.demoClock,'2030-06-25T04:00:00.000Z');assert.equal(balance(s04),150000);assert.deepEqual(record(s04,'transactions').map(x=>x.date),['2030-04-03','2030-05-03','2030-06-03']);assert.equal(record(s04,'cards').length,2);assert.ok(record(s04,'transactions').every(x=>x.amount===1200&&x.cardId==='card-cloud'));assert.ok(record(s04,'subscriptions').every(x=>x.status==='cancelled'));
 const s05=make('S05');assert.equal(record(s05,'goals')[0].balance,0);assert.equal(record(s05,'transactions').length,0);assert.equal(record(s05,'rules')[0].amount,10000);
 const s06=make('S06');assert.equal(s06.demoClock,'2032-03-25T04:00:00.000Z');assert.equal(record(s06,'budgets').length,0);assert.equal(balance(s05),400000);assert.equal(balance(s06),300000);for(const id of ['S04','S05','S06'])assert.ok(SCENE_MANIFEST.find(x=>x.id===id)!.assumptions.some(x=>x.includes('工程设定')));
 const s07=make('S07'),history=record(s07,'transactions');assert.equal(balance(s07),510000);assert.equal(record(s07,'goals')[0].balance,240000);assert.equal(history.length,24);assert.equal(new Set(history.map(x=>x.id)).size,24);assert.ok(history.every(x=>x.amount===10000&&x.synthetic===true));assert.equal(s07.contacts![0].previouslyUsed,false);assert.equal(record(s07,'contacts').length,0);
 const s08=make('S08');assert.equal(s08.demoClock,'2033-07-25T04:00:00.000Z');assert.equal(record(s08,'transactions')[0].date,'2033-07-01');assert.equal(balance(s08),800000);assert.equal(s08.plan,null);assert.equal(record(s08,'orders').length,0);assert.equal(record(s08,'rules')[0].status,'template');
});

test('S08 template has explicit synthetic prerequisites without executing it',()=>{
 const s=make('S08'),r=s.workflows!.records,contact=s.contacts![0],template=r.rules[0];
 assert.equal(contact.id,'RENT-7742');assert.equal(contact.previouslyUsed,true);assert.equal(make('S07').contacts![0].previouslyUsed,false);
 assert.equal(r.goals[0].id,'EMERGENCY-01');assert.equal(r.goals[0].target,1000000);assert.equal(r.goals[0].balance,0);
 assert.equal(r.products[0].id,'product-a');assert.equal(s.workflows!.riskProfile!.level,3);assert.ok(s.workflows!.riskProfile!.validUntil>s.demoClock!);
 assert.equal(r.questionnaires[0].label,'演示用合成测评');
 assert.deepEqual([template.accountId,template.recipientId,template.goalId,template.productId],['daily','RENT-7742','EMERGENCY-01','product-a']);
 assert.deepEqual([template.rent,template.savings,template.investment,template.report,template.status],[180000,40000,20000,true,'template']);
 assert.equal(balance(s),800000);assert.equal(s.accounts[0].held||0,0);assert.equal(s.plan,null);assert.equal(s.receipts.length,0);assert.deepEqual(r.orders,[]);assert.deepEqual(r.holdings,[]);assert.deepEqual(s.workflows!.tasks,[]);
 const assumptions=SCENE_MANIFEST.find(x=>x.id==='S08')!.assumptions;
 assert.ok(assumptions.includes('合成前提：研三押金已到账，属已往来收款人'));assert.ok(assumptions.some(x=>x.includes('工程设定')));
});
