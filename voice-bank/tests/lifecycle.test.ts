import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduceBank } from '../lib/bank/engine.ts';
import { dispatchAction } from '../lib/plans/dispatch.ts';
import { currentWorkflow } from '../lib/workflows/engine.ts';
import { outcomeBadge, recentRecords } from '../lib/ui/desk.ts';
import { readTool } from '../lib/workflows/adapters.ts';
import type { BankAction, BankState } from '../lib/bank/types.ts';

const app = (s: BankState, a: BankAction) => reduceBank(s, dispatchAction(s, a), crypto.randomUUID());
const say = (s: BankState, functionId: string, utterance: string, params: Record<string, unknown> = {}) => app(s, { type: 'workflow', command: { operation: 'run', functionId, params, source: 'voice', utterance } });
const cancelBy = (s: BankState, utterance: string) => app(s, { type: 'workflow', command: { operation: 'cancel', taskId: currentWorkflow(s)!.id, source: 'voice', utterance } });
const task = (s: BankState, id: string) => s.workflows!.tasks.find(t => t.id === id)!;
const freeze = (s: BankState, utterance = '冻结尾号8021的卡') => say(s, 'CA06', utterance, { action: 'freeze', cardId: 'card-daily' });
const draft = () => say(initialState(), 'TR03', '给室友张三转200', { recipientId: 'zhang-roommate', amount: 200 });

test('ending words cancel the current draft; denials of ending do not', () => {
  for (const words of ['结束这个业务', '不弄了', '退出', '先这样吧', '放弃这笔']) assert.equal(currentWorkflow(cancelBy(draft(), words))!.status, 'cancelled', words);
  for (const words of ['别取消', '不是要结束，继续', '不要退出']) assert.throws(() => cancelBy(draft(), words), words);
});

test('starting another business sets an unsubmitted draft aside instead of queueing it in the new checklist', () => {
  const before = say(initialState(), 'IN01', '创建储蓄目标读书计划', { name: '读书计划' }), old = currentWorkflow(before)!.id;
  const s = freeze(before);
  assert.equal(currentWorkflow(s)!.functionId, 'CA06');
  assert.equal(task(s, old).status, 'collecting');
  assert.ok(!s.plan!.steps.some(step => step.taskId === old));
  assert.match(s.lastReply, /未完成业务/);
});

test('an unsubmitted transfer, at any step, is dropped when another business starts', () => {
  for (const accountId of [undefined, 'daily']) {
    let s = draft();
    if (accountId) s = app(s, { type: 'workflow', command: { operation: 'amend', taskId: currentWorkflow(s)!.id, params: { accountId }, source: 'card' } });
    const old = currentWorkflow(s)!.id;
    s = freeze(s);
    assert.equal(currentWorkflow(s)!.functionId, 'CA06', String(accountId));
    assert.equal(task(s, old).status, 'cancelled');
    assert.ok(!s.task || ['complete', 'cancelled'].includes(s.task.step));
    assert.match(s.lastReply, /没有扣款/);
  }
});

test('asking to insert first, or a quick question, still returns to the draft afterwards', () => {
  const inserted = freeze(draft(), '先插一个：冻结尾号8021的卡');
  assert.equal(inserted.plan!.steps.filter(step => !['complete', 'cancelled'].includes(step.status)).length, 2);
  const asked = say(draft(), 'TR02', '先查下余额');
  assert.equal(currentWorkflow(asked)!.functionId, 'TR03');
});

test('a blocked card ends when the user asks for anything else, and a new transfer starts clean', () => {
  let s = say(initialState(), 'TR03', '给安全账户转5000，公安说我涉嫌洗钱', { amount: 5000 });
  const blocked = currentWorkflow(s)!;
  assert.equal(blocked.status, 'blocked');
  s = say(s, 'TR02', '看看我的余额');
  assert.equal(task(s, blocked.id).status, 'cancelled');
  s = say(s, 'TR03', '给室友张三转100', { recipientId: 'zhang-roommate', amount: 100 });
  assert.notEqual(currentWorkflow(s)!.id, blocked.id);
  assert.notEqual(currentWorkflow(s)!.status, 'blocked');
});

test('a dropped draft is labelled as not done, is not a receipt, and finished cancellations name their result', () => {
  const s = cancelBy(say(initialState(), 'SU04', '取消视频会员的代扣', { subscriptionId: 'sub-video' }), '不办了');
  const t = currentWorkflow(s)!;
  assert.deepEqual(outcomeBadge(s, t), { label: '未办理', tone: 'muted' });
  assert.equal(recentRecords(s).length, 0);
  assert.match(t.message, /没有提交/);
  assert.equal(outcomeBadge(s, { ...t, status: 'complete', result: { status: 'bank_cancelled' } }).label, '代扣已解除');
  assert.equal(outcomeBadge(s, { ...t, status: 'external', result: {} }).label, '需到平台处理');
});

test('a platform subscription the user was guided to cancel is marked pending in the list', () => {
  const s = initialState();
  s.workflows!.records.cancellations.push({ id: 'c1', subscriptionId: 'sub-cloud', status: 'external_pending' });
  const rows = readTool(s, 'D02', {}) as Record<string, unknown>[];
  assert.equal(rows.find(r => r.id === 'sub-cloud')!.externalPending, true);
  assert.equal(rows.find(r => r.id === 'sub-video')!.externalPending, undefined);
});

test('a prerequisite inserted for a blocked card keeps that card in the checklist', () => {
  const s = say(initialState(), 'IN08', '用日常账户买500元演示债券基金', { productId: 'fund-bond', accountId: 'daily', amount: 500 });
  const steps = s.plan!.steps.map(step => step.functionId);
  assert.ok(steps.includes('IN05') && steps.includes('IN08'), steps.join(','));
});
