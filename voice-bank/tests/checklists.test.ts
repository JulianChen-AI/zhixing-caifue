import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { WORKFLOWS, POLICY_VERSION, DEMO_POLICY } from '../lib/checklists/catalog.ts';
import { MAX_TRANSFER_CENTS } from '../lib/checklists/limits.ts';
import { evaluateChecklist } from '../lib/checklists/evaluate.ts';
import { routeRequest, amountFromText } from '../lib/checklists/routing.ts';
import { initialState, reduceBank, normalizeState } from '../lib/bank/engine.ts';
import type { BankAction, BankState, Intent } from '../lib/bank/types.ts';
const act = (s: BankState,a: BankAction,id: string=crypto.randomUUID())=>reduceBank(s,a,id);
const say = (s: BankState,text: string,proposal?: Intent)=>act(s,{type:'route',decision:routeRequest(text,s,proposal)});
const ready = ()=>say(initialState(),'给室友张三转五十元，用日常账户');

test('four source snapshots retain hashes and valid rule line references',()=>{
  const manifest=JSON.parse(fs.readFileSync(new URL('../docs/checklists/sources/manifest.json',import.meta.url),'utf8'));
  assert.equal(manifest.documents.length,4);
  for(const doc of manifest.documents){const data=fs.readFileSync(new URL('../'+doc.file,import.meta.url));assert.equal(crypto.createHash('sha256').update(data).digest('hex'),doc.sha256);}
  for(const flow of WORKFLOWS)for(const step of flow.steps)for(const ref of step.sources){const doc=manifest.documents.find((d:any)=>d.id===ref.document);assert.ok(doc);assert.ok(ref.lines[0]>0&&ref.lines[1]<=doc.lines);}
});
test('catalog has unique IDs, bounded predicates and no implicit empty-context success',()=>{
  assert.equal(WORKFLOWS.length,62);assert.equal(new Set(WORKFLOWS.map(w=>w.id)).size,62);
  const ruleIds=WORKFLOWS.flatMap(w=>w.steps.map(s=>s.id));assert.equal(new Set(ruleIds).size,ruleIds.length);
  for(const flow of WORKFLOWS){assert.ok(flow.steps.length>0);assert.notEqual(evaluateChecklist(flow.id,{}).outcome,'proceed');for(const step of flow.steps)assert.ok(['present','eq','gte','lte'].includes(step.op));}
  assert.equal(evaluateChecklist('made-up',{}).outcome,'unsupported');
});
test('sequential checks stop at the first unresolved condition',()=>{
  const run=evaluateChecklist('TF-T01',{'recipient.unique':true});
  assert.equal(run.checks[0].status,'passed');assert.equal(run.checks[1].status,'clarify');assert.equal(run.checks[2].status,'pending');
});
test('model cannot resolve an ambiguous name or silently select a funding account',()=>{
  const d=routeRequest('给张三转五十元',initialState(),{kind:'transfer',amount:5000,recipientId:'zhang-roommate',accountId:'daily',note:null});
  assert.equal(d.outcome,'clarify');assert.equal(d.draft!.recipientId,null);assert.equal(d.draft!.accountId,null);
  const s=act(initialState(),{type:'route',decision:d});assert.equal(s.task!.recipientId,null);assert.equal(s.task!.accountId,null);assert.throws(()=>act(s,{type:'confirm'}));
});
test('every required payment field must come from speech or an explicit card choice',()=>{
  let s=say(initialState(),'给张三转五十元');
  s=act(s,{type:'select_recipient',recipientId:'zhang-roommate'});assert.equal(s.task!.step,'details');assert.throws(()=>act(s,{type:'confirm'}));
  s=act(s,{type:'edit',accountId:'daily'});assert.equal(s.task!.step,'review');assert.equal(s.routing!.outcome,'proceed');
  assert.ok(s.audit.some(e=>e.evidence.some(x=>x.field==='account'&&x.source==='user-card')));
  assert.equal(act(s,{type:'confirm'}).task!.step,'authenticate');
});
test('model amount mismatch and imprecise money requests require clarification',()=>{
  const d=routeRequest('给室友转五十元，用日常账户',initialState(),{kind:'transfer',amount:50000,recipientId:'zhang-roommate',accountId:'daily'});
  assert.equal(d.outcome,'clarify');assert.ok(d.unresolved.includes('amount'));
  let s=ready();s=say(s,'改成大概一百元');assert.equal(s.task!.amount,null);assert.throws(()=>act(s,{type:'confirm'}));
});
test('multiple unrelated actions cannot silently run as a transfer',()=>{
  const s=say(ready(),'取消会员，然后给李四转五十元');assert.equal(s.routing!.outcome,'clarify');assert.equal(s.receipts.length,0);assert.throws(()=>act(s,{type:'confirm'}));
});
test('subscription cancellation cannot cancel the current transfer',()=>{
  const previous=ready();const s=say(previous,'帮我取消爱奇艺会员');assert.equal(s.routing!.workflowId,'SD-S05');assert.equal(s.routing!.outcome,'unsupported');assert.deepEqual(s.task,previous.task);assert.equal(s.receipts.length,0);
});
test('protected mandates and external channels are distinct routes',()=>{
  assert.equal(routeRequest('取消助学贷款代扣',initialState()).workflowId,'SD-S08');
  assert.equal(routeRequest('取消苹果商店会员',initialState()).workflowId,'SD-S06');
});
test('billing and investment requests report the selected checklist without fabricating results',()=>{
  for(const[text,id]of [['查这个月奶茶花了多少','BA-B01'],['分析这个月账单','BA-B07'],['每周定投五十元基金','TF-09'],['我赚了还是亏了，看看持仓','TF-14']]){
    const s=say(initialState(),text);assert.equal(s.routing!.workflowId,id);assert.equal(s.routing!.outcome,'unsupported');assert.equal(s.task,null);assert.equal(s.receipts.length,0);
  }
});
test('unknown utterances and uncertain cancel targets cannot authorize an action',()=>{
  for(const text of ['帮我处理一下','取消贷款','不要取消会员']){const s=say(ready(),text);assert.equal(s.routing!.outcome,'clarify');assert.throws(()=>act(s,{type:'confirm'}));}
});
test('sensitive fields are stopped before entering business drafts or audit evidence',()=>{
  const s=say(initialState(),'我的验证码是123456，给张三转账');assert.equal(s.task,null);assert.ok(!JSON.stringify(s.audit).includes('123456'));
  assert.throws(()=>act(ready(),{type:'edit',note:'密码123456'}));
});
test('risk-sensitive requests cannot bypass unavailable upgraded verification',()=>{
  const s=say(initialState(),'给室友转五十元，用日常账户，备注解冻费');assert.equal(s.checklist!.outcome,'blocked');assert.ok(s.task!.riskSignals.includes('解冻费'));assert.throws(()=>act(s,{type:'confirm'}));
});
test('explicit sandbox policy accepts 500 yuan while risk and missing adapters still fail closed',()=>{
  assert.equal(DEMO_POLICY.immediateTransferCents,DEMO_POLICY.maxTransferCents);
  const s=say(initialState(),'给室友转五百元，用日常账户');assert.equal(act(s,{type:'confirm'}).task!.step,'authenticate');
  assert.equal(say(s,'对方说这是刷单保证金').checklist!.outcome,'blocked');
  const flow=WORKFLOWS.find(w=>w.id==='TF-T04')!;assert.equal(flow.capability,'planned');
});

test('a routed balance query preserves current confirmation and authorization',()=>{
  let s=act(ready(),{type:'confirm'});const id=s.task!.verificationId!;
  s=say(s,'看看余额');assert.equal(s.task!.verificationId,id);
  s=act(s,{type:'authenticate',code:'123456',verificationId:id});assert.equal(s.receipts.length,1);
});
test('changes invalidate old authorization and audit results share the executable rules',()=>{
  let s=act(ready(),{type:'confirm'});const old=s.task!.verificationId!;
  s=say(s,'改成三十元');assert.equal(s.task!.amount,3000);assert.equal(s.task!.verificationId,null);assert.throws(()=>act(s,{type:'authenticate',code:'123456',verificationId:old}));
  s=act(s,{type:'confirm'});s=act(s,{type:'authenticate',code:'123456',verificationId:s.task!.verificationId!});
  assert.equal(s.checklist!.outcome,'proceed');assert.ok(s.audit.at(-1)!.checks.every(c=>c.status==='passed'));assert.equal(s.audit.at(-1)!.policyVersion,POLICY_VERSION);assert.ok(!JSON.stringify(s.audit).includes('123456'));
});
test('legacy active drafts must reselect accounts while completed receipts survive normalization',()=>{
  const active=ready();delete (active as any).policyVersion;
  const migrated=normalizeState(active);assert.equal(migrated.task!.accountId,null);assert.equal(migrated.task!.verificationId,null);
  let done=act(ready(),{type:'confirm'});done=act(done,{type:'authenticate',code:'123456',verificationId:done.task!.verificationId!});delete(done as any).policyVersion;delete(done.task as any).policyVersion;
  assert.equal(normalizeState(done).receipts.length,1);assert.equal(normalizeState(done).task!.step,'complete');assert.equal(normalizeState(done).checklist!.outcome,'unsupported');assert.equal(normalizeState(done).checklist!.checks.some(c=>c.status==='passed'),false);
});
test('audit is bounded and duplicate request IDs do not create duplicate events',()=>{
  let s=ready();s=act(s,{type:'home'},'repeat');const count=s.audit.length;assert.equal(act(s,{type:'home'},'repeat').audit.length,count);
  for(let i=0;i<120;i++)s=act(s,{type:'home'});assert.equal(s.audit.length,100);
});
test('amount parsing respects correction, exact cents and ambiguity',()=>{
  assert.equal(amountFromText('转五十元，不对改成三十元').amount,3000);assert.equal(amountFromText('转0.01元').amount,1);assert.equal(amountFromText('五十元还是三十元').uncertain,true);
});

test('unsupported money formats never silently turn into a different amount',()=>{for(const text of ['转1.234元','转-50元','转1,000元','转五十点五元']){assert.equal(amountFromText(text).amount,null);assert.equal(amountFromText(text).uncertain,true);}});
test('one stated amount cannot silently become transfers to several people',()=>{const r=routeRequest('给张三和李四各转五十元，用日常账户',initialState());assert.equal(r.outcome,'clarify');assert.equal(r.draft,undefined);});

test('document example utterances map to their intended checklists',()=>{for(const [text,id]of [['帮我看看这个月支出有没有问题','BA-B07'],['我想学理财','TF-05'],['每周帮我投50块债基','TF-09'],['这个月订阅报告','SD-S09']])assert.equal(routeRequest(text,initialState()).workflowId,id);});

test('zero, oversized and relative amounts stay unresolved instead of keeping an old amount',()=>{for(const text of ['改成零元','改成100001元','改成一半']){const s=say(ready(),text);assert.equal(s.task!.amount,null);assert.throws(()=>act(s,{type:'confirm'}));}});
test('negated edits are not executed as positive instructions',()=>{const s=say(ready(),'不要改成三十元');assert.equal(s.task!.amount,5000);assert.equal(s.routing!.outcome,'clarify');assert.throws(()=>act(s,{type:'confirm'}));});

test('planned adapters never become executable just because business facts are filled',()=>{for(const flow of WORKFLOWS.filter(w=>w.capability==='planned')){const facts:Record<string,any>={};for(const step of flow.steps)facts[step.field]=step.op==='present'?'provided':step.value;assert.equal(evaluateChecklist(flow.id,facts).outcome,'unsupported');}});
test('risk mentioned in a separate turn remains attached to the active transfer',()=>{let s=say(ready(),'对方说这是刷单保证金');s=say(s,'继续这笔');assert.ok(s.task!.riskSignals.includes('刷单'));assert.equal(s.checklist!.outcome,'blocked');assert.throws(()=>act(s,{type:'confirm'}));});

test('viewing an annual report does not request sharing authorization',()=>{const report=WORKFLOWS.find(w=>w.id==='BA-B08')!,share=WORKFLOWS.find(w=>w.id==='BA-B08-share')!;assert.equal(report.effect,'read');assert.equal(report.steps.some(s=>s.field==='consent.share'),false);assert.equal(share.steps.some(s=>s.field==='consent.share'),true);assert.equal(routeRequest('年度账单生成海报发朋友圈',initialState()).workflowId,'BA-B08-share');});

test('omitted currency asks a contextual question and yes confirms only the amount',()=>{
  for(const text of ['我要转500','我要转五百']){
    let s=say(initialState(),text);assert.equal(s.task!.amount,50000);assert.equal(s.task!.amountNeedsConfirmation,true);assert.match(s.lastReply,/500.00.*对吗/);assert.throws(()=>act(s,{type:'confirm'}));
    s=say(s,'对');assert.equal(s.task!.amountNeedsConfirmation,false);assert.equal(s.task!.step,'recipient');assert.equal(s.task!.confirmedRevision,null);assert.equal(s.receipts.length,0);
  }
});
test('currency-only replies supplement the active transfer instead of starting a new intent',()=>{
  let s=say(initialState(),'我要转账');const id=s.task!.id;s=say(s,'500元');assert.equal(s.task!.amount,50000);assert.equal(s.task!.id,id);assert.equal(s.task!.amountNeedsConfirmation,false);
  s=say(s,'室友那个');assert.equal(s.task!.recipientId,'zhang-roommate');s=say(s,'我有哪些账户');assert.equal(s.view,'balance');assert.equal(s.task!.id,id);assert.match(s.lastReply,/8021/);assert.match(s.lastReply,/3609/);
  s=say(s,'用第二个');assert.equal(s.task!.accountId,'savings');assert.equal(s.task!.amount,50000);assert.equal(s.view,'transfer');
  s=say(s,'确认转账');assert.equal(s.task!.step,'authenticate');assert.equal(s.receipts.length,0);
  s=act(s,{type:'authenticate',code:'123456',verificationId:s.task!.verificationId!});assert.equal(s.receipts.length,1);assert.equal(s.receipts[0].amount,50000);assert.equal(s.checklist!.outcome,'proceed');
});
test('account queries preserve authorization and tail selection is not parsed as money',()=>{
  let s=act(ready(),{type:'confirm'});const id=s.task!.verificationId;s=say(s,'我有哪几个账户');assert.equal(s.task!.verificationId,id);
  s=say(s,'用尾号3609的');assert.equal(s.task!.accountId,'savings');assert.equal(s.task!.amount,5000);assert.equal(s.task!.verificationId,null);
});
test('ordinals depend on the visible list and cannot select an unseen account',()=>{
  let s=say(initialState(),'给张三转500元');s=say(s,'第一个');assert.equal(s.task!.recipientId,'zhang-roommate');assert.equal(s.task!.accountId,null);
  s=say(s,'第二个');assert.equal(s.task!.accountId,null);assert.equal(s.routing!.outcome,'clarify');
});
test('yes cannot skip missing data, perform authentication or override a risk stop',()=>{
  let s=say(initialState(),'我要转账');s=say(s,'确认');assert.equal(s.task!.step,'recipient');assert.equal(s.task!.verificationId,null);
  s=say(ready(),'确认转账');const id=s.task!.verificationId;s=say(s,'确认');assert.equal(s.task!.verificationId,id);assert.equal(s.receipts.length,0);
  const risky=say(ready(),'这笔是刷单保证金');const after=say(risky,'确认转账');assert.equal(after.task!.verificationId,null);assert.equal(after.receipts.length,0);assert.equal(after.checklist!.outcome,'blocked');
});
test('changing a draft after spoken confirmation revokes the old authentication',()=>{
  let s=say(ready(),'确认转账');const id=s.task!.verificationId!;s=say(s,'30元');assert.equal(s.task!.amount,3000);assert.equal(s.task!.verificationId,null);assert.throws(()=>act(s,{type:'authenticate',code:'123456',verificationId:id}));
});
test('relative and malformed quantities cannot become partial Chinese amounts',()=>{
  for(const text of ['改成一半','转五十点五元','转1.234元']){assert.equal(amountFromText(text).amount,null);assert.equal(amountFromText(text).uncertain,true);}
});

test('a side query cannot use an unrelated yes to acknowledge an earlier inferred amount',()=>{
 let s=say(initialState(),'我要转500');s=say(s,'我有哪些账户');s=say(s,'对');assert.equal(s.task!.amountNeedsConfirmation,true);assert.equal(s.task!.verificationId,null);
});
test('unclear speech keeps the current business question instead of restarting generic intent discovery',()=>{
 let s=say(initialState(),'我要转账');const id=s.task!.id;s=say(s,'是有那个');assert.equal(s.task!.id,id);assert.match(s.lastReply,/收款人没听清/);assert.equal(s.task!.recipientId,null);
});

test('a model repeating the known amount while filling a payee does not erase the draft',()=>{
 let s=say(initialState(),'我要转500元');s=say(s,'给室友张三转账',{kind:'amend',amount:50000,recipientId:'zhang-roommate',accountId:null,note:null});assert.equal(s.task!.amount,50000);assert.equal(s.task!.recipientId,'zhang-roommate');assert.equal(s.task!.accountId,null);
 assert.ok(s.routing!.evidence.some(e=>e.field==='amount'&&e.source==='existing-task'));
 const mismatch=say(s,'用日常账户',{kind:'amend',amount:60000,recipientId:'zhang-roommate',accountId:'daily',note:null});assert.equal(mismatch.task!.amount,null);assert.equal(mismatch.routing!.outcome,'clarify');
});

test('the page transfer ceiling equals the rule catalog', () => {
  assert.equal(MAX_TRANSFER_CENTS, DEMO_POLICY.maxTransferCents);
});
