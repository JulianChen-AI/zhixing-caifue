import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduceBank } from '../lib/bank/engine.ts';
import { dispatchAction } from '../lib/plans/dispatch.ts';
import { currentWorkflow } from '../lib/workflows/engine.ts';
import { currentSurface } from '../lib/ui/serial.ts';
import { changedFields, completedSideQuery, localDate, reviewEntries, taskIdentity } from '../lib/ui/business.ts';
import type { BankAction, BankState } from '../lib/bank/types.ts';

const apply = (state: BankState, action: BankAction) => reduceBank(state, dispatchAction(state, action), crypto.randomUUID());
const transfer = () => apply(initialState(), { type: 'workflow', command: { operation: 'run', functionId: 'TR03', params: { recipientId: 'zhang-roommate', accountId: 'daily', amount: 500 }, source: 'card' } });

test('collapsing a current task selects the welcome surface without rendering its plan as another card', () => {
  const before = transfer();
  assert.equal(currentSurface(before), 'workflow');
  const after = apply(before, { type: 'home' });
  assert.equal(currentSurface(after), 'welcome');
  assert.equal(currentWorkflow(after)!.id, currentWorkflow(before)!.id);
  assert.equal(currentWorkflow(after)!.status, 'review');
});

test('a paused plan replaces its editable business surface and resuming restores the same task', () => {
  const before = transfer(), id = currentWorkflow(before)!.id;
  const paused = apply(before, { type: 'plan', command: { operation: 'pause', source: 'card' } });
  assert.equal(currentSurface(paused), 'paused');
  const resumed = apply(paused, { type: 'plan', command: { operation: 'resume', source: 'card' } });
  assert.equal(currentSurface(resumed), 'workflow');
  assert.equal(currentWorkflow(resumed)!.id, id);
});

test('unresolved outer questions own the active surface instead of showing the background business card', () => {
  const state = apply(initialState(), { type: 'plan', command: { operation: 'create', source: 'voice', utterance: '先查询余额，然后帮我处理一下' } });
  assert.equal(state.plan!.status, 'collecting');
  assert.equal(currentSurface(state), 'question');
});

test('the same complete summary survives review, authentication and the saved receipt', () => {
  let bank=transfer(),task=currentWorkflow(bank)!;
  const entries=reviewEntries(bank,task);
  assert.match(JSON.stringify(entries),/6688/);
  assert.match(JSON.stringify(entries),/8021/);
  assert.match(JSON.stringify(entries),/¥500.00/);
  bank=apply(bank,{type:'workflow',command:{operation:'confirm',taskId:task.id,token:task.reviewToken!,source:'card'}});
  task=currentWorkflow(bank)!;assert.deepEqual(reviewEntries(bank,task),entries);
  bank=apply(bank,{type:'workflow',command:{operation:'authenticate',taskId:task.id,token:task.verificationId!,code:'123456',source:'card'}});
  assert.equal(bank.receipts.length,1);
  assert.deepEqual(reviewEntries(bank,currentWorkflow(bank)!),entries);
});

test('task navigation distinguishes two transfers using their actual recipient, amount and account', () => {
  const bank=apply(initialState(),{type:'plan',command:{operation:'create',source:'voice',utterance:'先从日常账户给室友转500元，然后从储蓄账户给李四转30元'}});
  const tasks=bank.plan!.steps.map(step=>bank.workflows!.tasks.find(task=>task.id===step.taskId)!);
  const labels=tasks.map(task=>taskIdentity(bank,task));
  assert.match(labels[0].title,/室友张三.*6688/);assert.match(labels[0].detail,/¥500.00.*8021/);
  assert.match(labels[1].title,/李四.*0826/);assert.match(labels[1].detail,/¥30.00.*3609/);
  assert.notDeepEqual(labels[0],labels[1]);
});

test('editing one field preserves untouched fields and requires a new confirmation', () => {
  const bank=transfer(),task=currentWorkflow(bank)!;
  const draft={...task.params,amount:'300'};
  const patch=changedFields(draft,task.params);
  assert.deepEqual(patch,{amount:'300'});
  const next=apply(bank,{type:'workflow',command:{operation:'amend',taskId:task.id,params:patch,source:'card'}});
  const updated=currentWorkflow(next)!;
  assert.equal(updated.params.accountId,task.params.accountId);assert.equal(updated.params.recipientId,task.params.recipientId);
  assert.notEqual(updated.reviewToken,task.reviewToken);
  assert.throws(()=>apply(next,{type:'workflow',command:{operation:'confirm',taskId:task.id,token:task.reviewToken!,source:'card'}}));
  assert.equal(next.receipts.length,0);
});

test('visible receipt dates use Shanghai time while date-only business fields are preserved', () => {
  assert.equal(localDate('2026-10-29T14:23:28.475Z'),'2026/10/29 22:23:28');
  assert.equal(localDate('2027-06-01'),'2027-06-01');
  assert.equal(localDate('not a date'),'not a date');
});

test('temporary query results can be presented without changing the original task or its review',()=>{
  const before=transfer(),original=currentWorkflow(before)!;
  const after=apply(before,{type:'workflow',command:{operation:'run',functionId:'TR02',params:{},source:'card'}});
  const snapshot=structuredClone(after),query=completedSideQuery(before,after);
  assert.equal(query?.functionId,'TR02');assert.equal(query?.status,'complete');
  assert.equal(currentWorkflow(after)!.id,original.id);assert.equal(currentWorkflow(after)!.reviewToken,original.reviewToken);
  assert.deepEqual(after,snapshot);assert.equal(completedSideQuery(null,after),undefined);
});
