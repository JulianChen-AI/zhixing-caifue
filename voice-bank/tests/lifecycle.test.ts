import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduceBank } from '../lib/bank/engine.ts';
import { dispatchAction } from '../lib/plans/dispatch.ts';
import { currentWorkflow } from '../lib/workflows/engine.ts';
import { outcomeBadge, recentRecords } from '../lib/ui/desk.ts';
import { readTool } from '../lib/workflows/adapters.ts';
import { replyForState } from '../lib/ui/presentation.ts';
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

test('a purchase stops at suitability before asking the amount', () => {
  const none = say(initialState(), 'IN08', '我测评是保守型，帮我买演示债券基金', { productId: 'fund-bond' });
  const buy = none.workflows!.tasks.find(t => t.functionId === 'IN08')!;
  assert.equal(buy.status, 'blocked');
  assert.deepEqual(buy.missing, []);
  assert.match(buy.message, /口头说的测评结果不能代替正式测评/);
  assert.equal(currentWorkflow(none)!.functionId, 'IN05');
  const low = initialState(); low.workflows!.riskProfile = { level: 2, answers: [2, 2, 2], validUntil: '2099-01-01T00:00:00.000Z' };
  const mismatch = currentWorkflow(say(low, 'IN08', '帮我买演示债券基金', { productId: 'fund-bond' }))!;
  assert.equal(mismatch.status, 'blocked');
  assert.match(mismatch.message, /C2.*R3.*不能购买.*演示现金基金/);
  const fits = currentWorkflow(say(low, 'IN08', '帮我买演示现金基金', { productId: 'fund-cash' }))!;
  assert.equal(fits.status, 'collecting');
  assert.ok(fits.missing.includes('amount'));
});

test('AA keeps a head count, the names said and a carve-out, and asks only for the missing names', () => {
  let s = say(initialState(), 'TR05', '昨晚300块饭钱，五个人AA，其中50的酒只有张三和李四喝了', { action: 'create', total: 300, headcount: 5, participants: ['我', '张三', '李四'], adjustments: [{ label: '酒', amount: 50, participants: ['张三', '李四'] }] });
  let t = currentWorkflow(s)!;
  assert.equal(t.status, 'collecting');
  assert.deepEqual(t.params.participants, ['我', '张三', '李四']);
  assert.equal(t.params.headcount, 5);
  assert.equal((t.params.adjustments as unknown[]).length, 1);
  assert.match(t.message, /一共 5 人.*还差 2 位/);
  s = app(s, { type: 'workflow', command: { operation: 'amend', taskId: t.id, params: { participants: ['我', '张三', '李四', '王五', '赵六'] }, source: 'voice', utterance: '还有王五和赵六' } });
  t = currentWorkflow(s)!;
  assert.equal(t.status, 'review');
  assert.throws(() => say(initialState(), 'TR05', '昨晚300块饭钱AA', { action: 'create', total: 300, headcount: 5 }));
});

test('a shared payee name gets a named choice in text mode, and skipping confirmation is refused in words', () => {
  const s = app(initialState(), { type: 'workflow', command: { operation: 'run', functionId: 'TR03', params: { amount: 500 }, source: 'card', utterance: '给张三转500，不用确认了，直接转' } });
  assert.match(s.lastReply, /不能跳过/);
  assert.match(s.lastReply, /室友张三.*6688.*房东张三.*2910/);
  assert.deepEqual(currentWorkflow(s)!.recipientChoices, ['zhang-roommate', 'zhang-landlord']);
});

test('a question answered without changes is shown instead of the open card message', () => {
  const s = say(initialState(), 'TR03', '给安全账户转5000，公安说我涉嫌洗钱', { amount: 5000 });
  assert.match(replyForState(s), /安全账户/);
  assert.equal(replyForState({ ...s, sayOnly: '基金涨跌没人能预测。' }), '基金涨跌没人能预测。');
});

test('the AA head count comes from the words even when the proposal leaves it out', () => {
  const s = app(initialState(), { type: 'workflow', command: { operation: 'run', functionId: 'TR05', params: { action: 'create', total: 300, adjustments: [{ label: '酒', amount: 50, participants: ['张三', '李四'] }] }, source: 'card', utterance: '昨晚300块饭钱，五个人AA，其中50的酒只有张三和李四喝了' } });
  const t = currentWorkflow(s)!;
  assert.equal(t.params.headcount, 5);
  assert.deepEqual(t.params.participants, ['我']);
  assert.match(t.message, /一共 5 人.*还差 4 位/);
});

test('replies carry the facts: options when asking, the subject when reviewing, the answer when a query is done', () => {
  let s = say(initialState(), 'TR03', '给室友张三转200', { recipientId: 'zhang-roommate', amount: 200 });
  assert.match(replyForState(s), /请补充账户：日常账户（尾号8021）、储蓄账户（尾号3609），选哪个？/);
  const again = app(s, { type: 'workflow', command: { operation: 'amend', taskId: currentWorkflow(s)!.id, params: {}, source: 'card' } });
  assert.match(replyForState(again), /结束这个业务/);
  s = app(s, { type: 'workflow', command: { operation: 'amend', taskId: currentWorkflow(s)!.id, params: { accountId: 'daily' }, source: 'card' } });
  assert.match(replyForState(s), /请核对|准备从日常账户给室友张三转/);
  const cards = say(initialState(), 'CA01', '看看我的卡');
  assert.match(replyForState(cards), /日常借记卡（8021）正常/);
  const subs = say(initialState(), 'SU01', '我有哪些订阅');
  assert.match(replyForState(subs), /生效中的订阅有 3 项，每月固定支出 ¥531.00/);
  const history = say(initialState(), 'TR06', '我给谁转过钱');
  assert.match(replyForState(history), /找到 \d+ 笔转账：.*给(室友|房东|同学)/);
  for (const r of [cards, subs, history].map(replyForState)) assert.doesNotMatch(r, /结果已显示/);
});

test('spoken days are worked out from the business date, weeks starting on Monday', async () => {
  const { spokenDay } = await import('../lib/plans/decompose.ts');
  // 2026-10-25 is a Sunday.
  assert.equal(spokenDay('我上周五给谁转过钱', '2026-10-25'), '2026-10-16');
  assert.equal(spokenDay('这周五', '2026-10-25'), '2026-10-23');
  assert.equal(spokenDay('周五转的', '2026-10-21'), '2026-10-16');
  assert.equal(spokenDay('昨天', '2026-11-01'), '2026-10-31');
  assert.equal(spokenDay('上周日', '2026-10-28'), '2026-10-25');
  assert.equal(spokenDay('给张三转钱', '2026-10-25'), undefined);
  const s = app({ ...initialState(), demoClock: '2026-10-25T04:00:00.000Z' }, { type: 'workflow', command: { operation: 'run', functionId: 'TR06', params: { period: '2026-10-24' }, source: 'card', utterance: '我上周五给谁转过钱' } });
  assert.equal(currentWorkflow(s)!.params.period, '2026-10-16');
  assert.match(replyForState(s), /同学李四转了 ¥36.00/);
});

test('an old unconfirmed transfer does not block a later question, and a later write drops it', () => {
  let s = app(initialState(), { type: 'workflow', command: { operation: 'run', functionId: 'TR03', params: { recipientId: 'zhang-roommate', amount: 200, accountId: 'daily' }, source: 'card', utterance: '给室友张三转200，用日常账户' } });
  // The checklist has been left alone long enough to count as stale.
  s = structuredClone(s); for (const e of s.plan!.log) e.at = new Date(Date.now() - 11 * 60 * 1000).toISOString(); s.plan!.createdAt = s.plan!.log[0].at;
  const read = app(s, { type: 'workflow', command: { operation: 'run', functionId: 'BI02', params: { period: '2026-10' }, source: 'card', utterance: '上个月花了多少' } });
  assert.equal(currentWorkflow(read)!.functionId, 'BI02');
  assert.equal(currentWorkflow(read)!.status, 'complete');
  const write = app(s, { type: 'workflow', command: { operation: 'run', functionId: 'CA06', params: { action: 'freeze', cardId: 'card-daily' }, source: 'card', utterance: '冻结尾号8021的卡' } });
  assert.equal(currentWorkflow(write)!.functionId, 'CA06');
  assert.ok(!write.task || ['complete', 'cancelled'].includes(write.task.step));
});
