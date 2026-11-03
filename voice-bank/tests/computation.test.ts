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
