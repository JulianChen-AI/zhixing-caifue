import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduceBank } from '../lib/bank/engine.ts';
import { parseBillingQuery, spokenPeriods, inBillingPeriod } from '../lib/workflows/billing-query.ts';
import { understandIntent, applyIntent } from '../lib/voice/intent-json.ts';
import { dispatchAction } from '../lib/plans/dispatch.ts';
import { replyForState } from '../lib/ui/presentation.ts';
import { currentWorkflow } from '../lib/workflows/engine.ts';
import { isNextMonthPlan, nextMonthDraft } from '../lib/plans/monthly.ts';
import type { BankState } from '../lib/bank/types.ts';

// 2026-11-03 is a Tuesday; the data is anchored on it.
const day = () => ({ ...initialState('2026-11-03'), demoClock: '2026-11-03T04:00:00.000Z' }) as BankState;
const fake = (body: object) => (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }))) as typeof fetch;
const run = (s: BankState, functionId: string, params: Record<string, unknown>) => reduceBank(s, { type: 'workflow', command: { operation: 'run', functionId, params, source: 'card' } }, crypto.randomUUID());
async function say(s: BankState, text: string, proposal: object) {
  const r = await understandIntent(s, text, [], { base: 'x', planner: 'm' }, new AbortController().signal, fake(proposal));
  await applyIntent(r, async a => { s = reduceBank(s, dispatchAction(s, a, text), crypto.randomUUID()); });
  return { s, r };
}

test('spoken days and ranges resolve on the bank calendar, in the order said', () => {
  assert.deepEqual(spokenPeriods('上上周五和这周三我分别花了多少', '2026-11-03'), ['2026-10-23', '2026-11-04']);
  assert.deepEqual(spokenPeriods('上周花了多少', '2026-11-03'), ['2026-10-26~2026-11-01']);
  assert.deepEqual(spokenPeriods('最近7天', '2026-11-03'), ['2026-10-28~2026-11-03']);
  assert.ok(inBillingPeriod('2026-10-30', '2026-10-26~2026-11-01') && !inBillingPeriod('2026-11-02', '2026-10-26~2026-11-01'));
  assert.deepEqual(parseBillingQuery('这个月和上个月分别花了多少', day()).periods, ['2026-11', '2026-10']);
  assert.equal(parseBillingQuery('上月和本月一共花了多少', day()).clarification?.field, 'period');
});

test('two days in one question are two queries; filters the user never said are dropped', async () => {
  const { s, r } = await say(day(), '上上周五和这周三我分别花了多少', { intent: 'run', functionId: 'BI02', params: { period: '2026-10', category: '餐饮', accountId: 'daily' }, say: '好' });
  assert.ok(r.dropped.includes('category:unsaid') && r.dropped.includes('accountId:unsaid'));
  assert.deepEqual(s.plan!.steps.map(x => [x.functionId, x.params.period, x.params.category]), [['BI02', '2026-10-23', undefined], ['BI02', '2026-11-04', undefined]]);
  assert.match(replyForState(s), /2026年10月23日.*净支出.*2026年11月4日（这一天还没到）：净支出 ¥0.00/);
});

test('every month named in a sentence is counted, however it is written', () => {
  const periods = (text: string) => parseBillingQuery(text, day()).periods;
  assert.deepEqual(periods('9月和10月分别花了多少'), ['2026-09', '2026-10']);
  assert.deepEqual(periods('九月和十月分别花了多少'), ['2026-09', '2026-10']);
  assert.deepEqual(periods('九月份、十月份各花了多少'), ['2026-09', '2026-10']);
  assert.deepEqual(periods('9、10月分别花了多少'), ['2026-09', '2026-10']);
  assert.deepEqual(periods('2026年9月和10月分别花了多少'), ['2026-09', '2026-10']);
  assert.deepEqual(periods('去年9月和10月分别花了多少'), ['2025-09', '2025-10']);
  assert.deepEqual(periods('上个月和9月分别花了多少'), ['2026-10', '2026-09']);
  assert.deepEqual(periods('上个月和这个月分别花了多少'), ['2026-10', '2026-11']);
});

test('one month keeps working in every spelling, and words that only look like months are left alone', () => {
  const period = (text: string) => parseBillingQuery(text, day()).params.period;
  assert.equal(period('9月花了多少'), '2026-09');
  assert.equal(period('九月花了多少'), '2026-09');
  assert.equal(period('十二月账单'), '2026-12');
  assert.equal(period('十月份花了多少'), '2026-10');
  assert.equal(period('去年9月花了多少'), '2025-09');
  assert.equal(period('今年3月花了多少'), '2026-03');
  assert.equal(period('2026年10月账单'), '2026-10');
  assert.equal(period('10月18号的账单'), '2026-10');
  assert.equal(period('这个月花了多少'), '2026-11');
  for (const text of ['这一月花了多少', '三个月花了多少', '半月花了多少', '每月花多少']) assert.notEqual(period(text), '2026-01', text);
  assert.equal(parseBillingQuery('13月账单', day()).clarification?.field, 'period');
  // The month is the period, not a merchant the user named.
  assert.equal(parseBillingQuery('九月花了多少', day()).clarification, undefined);
});

test('a span of months is one query over the whole span', () => {
  const period = (text: string) => parseBillingQuery(text, day()).params.period;
  assert.equal(period('7月到10月花了多少'), '2026-07-01~2026-10-31');
  assert.equal(period('9到10月花了多少'), '2026-09-01~2026-10-31');
  assert.equal(period('九月至十月一共花了多少'), '2026-09-01~2026-10-31');
  assert.equal(period('去年11月到12月花了多少'), '2025-11-01~2025-12-31');
  assert.equal(period('2月到3月花了多少'), '2026-02-01~2026-03-31');
  // “Each month of the span” is several answers, so it stays several queries.
  assert.deepEqual(parseBillingQuery('8月到10月每个月分别花了多少', day()).periods, ['2026-08', '2026-09', '2026-10']);
  // Backwards is a slip to ask about, never a silent empty range.
  assert.equal(parseBillingQuery('10月到7月花了多少', day()).clarification?.field, 'period');
});

test('two months still ask when the user wants one total across them', () => {
  assert.equal(parseBillingQuery('9月和10月一共花了多少', day()).clarification?.field, 'period');
});

test('two months in one question are two queries, whichever month the model picked', async () => {
  const { s } = await say(day(), '9月和10月分别花了多少', { intent: 'run', functionId: 'BI02', params: { period: '2026-09' }, say: '好' });
  assert.deepEqual(s.plan!.steps.map(x => [x.functionId, x.params.period, x.quote]), [['BI02', '2026-09', '9月和'], ['BI02', '2026-10', '10月分别花了多少']]);
  assert.match(replyForState(s), /2026年9月.*净支出.*2026年10月.*净支出/);
});

test('months sharing one 月, and months in Chinese, are split the same way', async () => {
  for (const text of ['9、10月分别花了多少', '九月和十月分别花了多少', '九月份和十月份分别花了多少', '2026年9月和10月分别花了多少']) {
    const { s } = await say(day(), text, { intent: 'run', functionId: 'BI02', params: {}, say: '好' });
    assert.deepEqual(s.plan!.steps.map(x => x.params.period), ['2026-09', '2026-10'], text);
    assert.equal(s.plan!.steps.map(x => x.quote).join(''), text);
  }
});

test('a span followed by another month never loses or invents a period', () => {
  assert.deepEqual(parseBillingQuery('9到10月和12月分别花了多少', day()).periods, ['2026-09', '2026-10', '2026-12']);
  assert.ok(parseBillingQuery('9到10月到11月花了多少', day()).params.period || parseBillingQuery('9到10月到11月花了多少', day()).periods.length);
});

test('a span of months runs as one query and answers for the whole span', async () => {
  const { s } = await say(day(), '9月到10月花了多少', { intent: 'run', functionId: 'BI02', params: { period: '2026-09' }, say: '好' });
  const task = currentWorkflow(s)!;
  assert.equal(task.params.period, '2026-09-01~2026-10-31');
  assert.equal(task.status, 'complete');
  assert.match(task.message, /2026年9月1日至10月31日/);
});

test('“花超了吗” compares this month with the same days of last month and says when no budget exists', async () => {
  const { s } = await say(day(), '我这个月是不是花超了？跟上个月比怎么样', { intent: 'run', functionId: 'BI02', params: { period: '2026-11' }, say: '好' });
  assert.equal(currentWorkflow(s)!.functionId, 'BI06');
  assert.match(replyForState(s), /11月到目前净支出 ¥[\d,.]+；上月同期（10月1日至3日）¥[\d,.]+，(多|少)花了 ¥[\d,.]+。.*还没有设预算/);
});

test('a goal projection uses the average monthly surplus and says it is an estimate', () => {
  const s = run(day(), 'IN03', { goalId: 'goal-travel' });
  const plan = (currentWorkflow(s)!.result as { projection: { monthly: number; months: number; reachBy: string } }).projection;
  assert.ok(plan.monthly > 0 && plan.months > 0 && /^\d{4}-\d{2}$/.test(plan.reachBy));
  assert.equal(plan.months, Math.ceil(300000 / plan.monthly));
  assert.match(replyForState(s), /大约 \d+ 个月后（\d{4}年\d+月）能攒够.*估算，不是承诺/);
});

test('“下个月的钱安排一下” drafts the month from the books and leaves rent and savings to be confirmed', async () => {
  const text = '帮我把下个月的钱安排一下：房租照交，存500，剩下的随便花';
  assert.ok(isNextMonthPlan(text) && !isNextMonthPlan('取消下个月的安排'));
  const draft = nextMonthDraft(day(), text);
  assert.match(draft.lead, /12月资金安排（草稿）.*收入约 ¥4,200.00；房租 ¥1,500.00（转给房东张三，每月1日）；储蓄 ¥500.00；固定扣款 ¥531.00/);
  const { s } = await say(day(), text, { intent: 'run', functionId: 'TR04', params: { action: 'create', amount: 1500 }, say: '好' });
  assert.deepEqual(s.plan!.steps.map(x => x.functionId), ['TR04', 'IN04']);
  assert.equal(currentWorkflow(s)!.params.recipientId, 'zhang-landlord');
  assert.equal(currentWorkflow(s)!.status, 'review');
  assert.deepEqual(s.receipts, []);
});
