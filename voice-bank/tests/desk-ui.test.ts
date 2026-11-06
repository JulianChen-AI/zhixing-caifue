import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduceBank } from '../lib/bank/engine.ts';
import type { BankState } from '../lib/bank/types.ts';
import { currentWorkflow } from '../lib/workflows/engine.ts';
import { businessNow } from '../lib/demo/clock.ts';
import { outcomeBadge, planStations, recentRecords, riskMatch } from '../lib/ui/desk.ts';
import { aaView, cardHead, receiptStatus, subscriptionStates } from '../lib/ui/cards.ts';
import { cumulativeSteps, dailyNet, monthGrid, orderSteps, segments, writeSteps } from '../lib/ui/viz.ts';

const act = (s: BankState, a: any) => reduceBank(s, a, crypto.randomUUID());
const scene = (id = 'S08') => act(initialState(), { type: 'load_scene', sceneId: id });
const plan = (s: BankState, command: any) => act(s, { type: 'plan', command: { source: 'card', ...command } });
const card = (s: BankState, command: any) => act(s, { type: 'workflow', command: { source: 'card', ...command } });
const open = (s: BankState) => act(s, { type: 'plan', command: { operation: 'create', source: 'voice', utterance: '工资到了，老规矩' } });
function confirm(s: BankState) {
  let t = currentWorkflow(s)!;
  assert.equal(t.status, 'review', t.message);
  s = card(s, { operation: 'confirm', taskId: t.id, token: t.reviewToken });
  t = currentWorkflow(s)!;
  if (t.status === 'authenticate') s = card(s, { operation: 'authenticate', taskId: t.id, token: t.verificationId, code: '123456' });
  return s;
}

test('accepted, unknown and failed results are never shown as success', () => {
  const s = initialState();
  const accepted = outcomeBadge(s, { functionId: 'IN08', params: {}, status: 'complete', result: { status: 'pending', businessStage: 'accepted' } });
  assert.deepEqual(accepted, { label: '已受理 · 待结算', tone: 'pending' });
  assert.equal(outcomeBadge(s, { functionId: 'TR03', params: {}, status: 'blocked', result: { status: 'unknown' } }).tone, 'wait');
  assert.equal(outcomeBadge(s, { functionId: 'IN02', params: {}, status: 'blocked', result: { status: 'failed' } }).tone, 'risk');
  assert.deepEqual(outcomeBadge(s, { functionId: 'TR03', params: {}, status: 'complete', result: {} }), { label: '已返回结果', tone: 'ok' });
  assert.deepEqual(outcomeBadge(s, { functionId: 'TR02', params: {}, status: 'complete', result: [] }), { label: '已查询', tone: 'info' });
});

test('the monthly plan becomes stations that follow the real task states', () => {
  let s = open(scene());
  let stations = planStations(s);
  assert.deepEqual(stations.map(x => x.badge.label), ['未开始', '等待前序', '等待前序', '未开始']);
  s = plan(s, { operation: 'resume' });
  stations = planStations(s);
  assert.equal(stations[0].badge.label, '待你确认');
  assert.equal(stations[0].current, true);
  s = confirm(s); s = confirm(s); s = confirm(s);
  stations = planStations(s);
  assert.equal(stations[0].badge.label, '已转出');
  assert.equal(stations[1].badge.tone, 'ok');
  assert.deepEqual(stations[2].badge, { label: '已受理 · 待结算', tone: 'pending' });
  const records = recentRecords(s);
  assert.deepEqual(records.map(row => row.badge.label), ['已受理 · 待结算', '已完成', '已转出']);
  for (const row of records) assert.ok(row.at === '' || row.at.startsWith('2033-'), `business clock only: ${row.at}`);
});

test('a single business is not drawn as a task map', () => {
  const s = card(initialState(), { operation: 'run', functionId: 'TR03', params: { recipientId: 'zhang-roommate', accountId: 'daily', amount: 500 } });
  assert.deepEqual(planStations(s), []);
});

test('receipts list what came back and leave internal audit out', () => {
  let s = card(initialState(), { operation: 'run', functionId: 'TR03', params: { recipientId: 'zhang-roommate', accountId: 'daily', amount: 500 } });
  assert.deepEqual(recentRecords(s), []);
  s = confirm(s);
  const rows = recentRecords(s);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].badge.label, '已转出');
  assert.equal(rows[0].reference, s.receipts[0].id);
  assert.ok(s.audit.length > 0);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['at', 'badge', 'detail', 'id', 'reference', 'title']);
});

test('the risk panel explains the backend check without replacing it', () => {
  let s = open(scene());
  s = plan(s, { operation: 'resume' });
  s = confirm(s); s = confirm(s);
  const invest = currentWorkflow(s)!;
  assert.equal(invest.functionId, 'IN08');
  const match = riskMatch(s, invest, businessNow(s))!;
  assert.equal(match.within, true);
  assert.ok(match.productRisk <= match.profileLevel);
  const later = riskMatch(s, invest, Date.parse(s.workflows!.riskProfile!.validUntil) + 1)!;
  assert.equal(later.expired, true);
  assert.equal(later.within, false);
  assert.equal(riskMatch(s, { functionId: 'TR03', params: {} }, businessNow(s)), null);
});

test('card heads call a result a receipt only once the task has really finished', () => {
  let s = card(initialState(), { operation: 'run', functionId: 'TR03', params: { recipientId: 'zhang-roommate', accountId: 'daily', amount: 500 } });
  assert.equal(cardHead(s, currentWorkflow(s)!).title, '转账确认页');
  assert.equal(receiptStatus(s, currentWorkflow(s)!), null);
  const t = currentWorkflow(s)!;
  s = card(s, { operation: 'confirm', taskId: t.id, token: t.reviewToken });
  assert.equal(cardHead(s, currentWorkflow(s)!).badge?.label, '待验证');
  const auth = currentWorkflow(s)!;
  s = card(s, { operation: 'authenticate', taskId: auth.id, token: auth.verificationId, code: '123456' });
  const done = currentWorkflow(s)!;
  assert.equal(cardHead(s, done).title, '转账回执');
  assert.equal(receiptStatus(s, done)?.label, '已转出');
});

test('an accepted purchase never reads as a finished trade on its card', () => {
  const s = initialState();
  const task = { functionId: 'IN08', title: '购买', params: {}, status: 'complete', result: { status: 'pending', businessStage: 'accepted' } } as any;
  assert.deepEqual(receiptStatus(s, task), { label: '申请已受理 · 份额待确认', tone: 'pending', note: '受理 ≠ 成交' });
  assert.deepEqual(orderSteps({ action: 'subscribe', businessStage: 'accepted' }).map(step => step.state), ['done', 'current', 'todo']);
  assert.equal(orderSteps({ action: 'redeem', businessStage: 'funds_arrived' }).at(-1)!.label, '资金到账');
  assert.equal(orderSteps({ businessStage: 'unknown' })[1].label, '结果待核对');
});

test('AA keeps sent reminders apart from money received, and re-totals the split', () => {
  let s = card(initialState(), { operation: 'run', functionId: 'TR05', params: { action: 'create', total: 100, participants: ['我', '张三', '林悦'] } });
  const review = aaView(s, currentWorkflow(s)!.result)!;
  assert.equal(review.balanced, true);
  assert.equal(review.members.reduce((sum, member) => sum + member.amount, 0), 10000);
  s = confirm(s);
  const created = currentWorkflow(s)!.result as { id: string };
  s = card(s, { operation: 'run', functionId: 'TR05', params: { action: 'remind', sessionId: created.id } });
  s = confirm(s);
  const after = aaView(s, s.workflows!.records.aa.find(row => row.id === created.id))!;
  assert.equal(after.received, 0, 'a reminder is not a payment');
  assert.ok(after.members.filter(member => !member.payer).every(member => member.reminder === 'sent' && !member.paid));
});

test('cancelling a bank mandate shows four separate facts, not one "cancelled"', () => {
  const states = subscriptionStates({ bankAgreementState: 'cancelled', merchantSubscriptionState: 'unknown', chargeState: 'bank_mandate_stopped' });
  assert.deepEqual(states.map(item => item.label), ['银行代扣', '商户订阅', '退款', '下次扣款']);
  assert.equal(states[0].tone, 'ok');
  assert.ok(states.slice(1).every(item => item.tone !== 'ok'));
});

test('chart geometry stays honest', () => {
  assert.deepEqual(dailyNet([{ date: '2026-10-20', amount: 3200, kind: 'expense' }, { date: '2026-10-20', amount: 1200, kind: 'refund' }, { date: '2026-10-21', amount: 900, kind: 'internal_transfer' }]), [{ date: '2026-10-20', value: 2000 }]);
  const folded = segments(Array.from({ length: 10 }, (_, i) => ({ label: `s${i}`, value: 10 - i })));
  assert.equal(folded.length, 8);
  assert.equal(folded.at(-1)!.label, '其他');
  assert.equal(folded.at(-1)!.value, 6);
  const november = monthGrid('2026-11', [{ date: '2026-11-15', name: '视频会员', amount: 2500 }]);
  assert.equal(november.filter(Boolean).length, 30);
  assert.equal(november.findIndex(Boolean), 6, '2026-11-01 is a Sunday in a Monday-first week');
  assert.equal(november.find(cell => cell?.day === 15)!.events[0].name, '视频会员');
  const steps = cumulativeSteps(600000, 36);
  assert.equal(steps.length, 12);
  assert.equal(steps.at(-1)!.value, 600000);
  assert.deepEqual(writeSteps('authenticate', true).map(step => step.state), ['done', 'done', 'current', 'todo']);
  assert.deepEqual(writeSteps('complete', false).map(step => step.state), ['done', 'done', 'done']);
});
