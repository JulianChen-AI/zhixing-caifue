import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduceBank } from '../lib/bank/engine.ts';
import type { BankState } from '../lib/bank/types.ts';
import { currentWorkflow } from '../lib/workflows/engine.ts';
import { portfolioReview } from '../lib/workflows/portfolio-review.ts';
import { readSummary } from '../lib/workflows/summaries.ts';
import { offlineWorkflow } from '../lib/workflows/offline.ts';
import type { Params, WorkflowCommand } from '../lib/workflows/types.ts';
import { businessDay } from '../lib/demo/clock.ts';
import { addDays } from '../lib/demo/dataset.ts';

const act = (s: BankState, command: Omit<WorkflowCommand, 'source'>) => reduceBank(s, { type: 'workflow', command: { source: 'card', ...command } }, crypto.randomUUID());
const run = (s: BankState, id: string, params: Params = {}) => act(s, { operation: 'run', functionId: id, params });
const records = (s: BankState) => s.workflows!.records;
const ADVICE = /建议(?:你)?(?:买|卖|赎回|继续持有|加仓|减仓)|加仓|减仓|预计收益|将会上涨|会涨/;

test('portfolio review: cost, value, gain, buys and days held come from the holding and settled orders', () => {
 const s = initialState(), today = businessDay(s), r = portfolioReview(s), seeded = records(s).holdings[0].purchases as { date: string; amount: number }[];
 assert.equal(r.holdings.length, 1);
 const h = r.holdings[0];
 assert.deepEqual([h.cost, h.value, h.profit, h.profitRate, h.buyCount], [20000, 20000, 0, 0, 2]);
 assert.deepEqual(h.buys.map(b => [b.date, b.amount]), [[seeded[0].date, 15000], [seeded[1].date, 5000]]);
 assert.equal(addDays(seeded[0].date, h.holdingDays!), today);
 assert.equal(h.buys.reduce((n, b) => n + b.amount, 0), h.cost, 'seeded buys add up to the cost');
 assert.ok(r.questions.length >= 2 && r.questions.length <= 3);
 assert.doesNotMatch(r.spokenSummary + r.questions.join(''), ADVICE);
});

test('portfolio review: gain and loss in cents, settled buys counted, pending buys kept apart', () => {
 const s = initialState(), h = records(s).holdings[0];
 h.value = 23000;
 records(s).orders.push(
  { id: 'order-settled', action: 'subscribe', productId: 'fund-cash', name: '现金基金', accountId: 'savings', amount: 3000, status: 'settled', createdAt: '2026-10-01T02:00:00.000Z', settledAt: '2026-10-02T02:00:00.000Z' },
  { id: 'order-pending', action: 'subscribe', productId: 'fund-bond', name: '债券基金', accountId: 'daily', amount: 5000, status: 'pending', createdAt: '2026-10-03T02:00:00.000Z' },
 );
 h.cost = 23000;
 h.value = 22310;
 const r = portfolioReview(s), item = r.holdings[0];
 assert.equal(item.profit, -690);
 assert.equal(item.profitRate, -0.03);
 assert.equal(item.buyCount, 3);
 assert.ok(item.buys.some(b => b.source === '沙箱订单' && b.amount === 3000 && b.date === '2026-10-02'));
 assert.deepEqual(r.pending.map(p => p.orderId), ['order-pending']);
 assert.match(r.spokenSummary, /亏了¥6\.90/);
 h.value = 24150;
 assert.match(portfolioReview(s).spokenSummary, /赚了¥11\.50/);
});

test('portfolio review with no holdings says so and asks nothing', () => {
 const s = initialState();
 records(s).holdings = [];
 const r = portfolioReview(s);
 assert.deepEqual([r.holdings, r.questions], [[], []]);
 assert.match(r.spokenSummary, /目前没有理财持仓/);
 // A fully redeemed holding is not something to review either.
 const t = initialState();
 records(t).holdings[0].value = 0;
 assert.equal(portfolioReview(t).holdings.length, 0);
});

test('the suitability question uses the formal profile only', () => {
 const s = initialState();
 assert.match(portfolioReview(s).questions[1], /没有有效的风险测评/);
 s.workflows!.riskProfile = { level: 3, answers: [3, 3, 3], validUntil: '2099-01-01T00:00:00.000Z' };
 assert.match(portfolioReview(s).questions[1], /R1，你的有效测评是C3，在测评范围内/);
});

test('IN16 review is read-only and finishes with the spoken review', () => {
 const before = initialState(), s = run(before, 'IN16'), t = currentWorkflow(s)!;
 assert.equal(t.status, 'complete', t.message);
 assert.match(t.message, /复盘1项持仓/);
 assert.deepEqual(records(s), records(before));
 assert.equal(readSummary('IN16', t.result), t.message);
});

test('IN16 note: nothing saved before confirmation, confirmation only (no authentication), profile untouched', () => {
 let s = run(initialState(), 'IN16', { action: 'note', note: '当时是为了放应急金，这个目的还在' });
 let t = currentWorkflow(s)!;
 assert.equal(t.status, 'review', t.message);
 assert.match(t.message, /请确认后保存/);
 assert.equal((records(s).reviewNotes || []).length, 0);
 s = act(s, { operation: 'confirm', taskId: t.id, token: t.reviewToken! });
 t = currentWorkflow(s)!;
 assert.equal(t.status, 'complete', t.message);
 assert.equal(records(s).reviewNotes.length, 1);
 assert.equal(s.workflows!.riskProfile, null);
 // A model that labels a note request as a review still gets a note card, never a review that drops the text.
 assert.equal(currentWorkflow(run(initialState(), 'IN16', { action: 'review', note: '应急金不动' }))!.status, 'review');
 // Without the note text there is nothing to save; the card asks for it.
 const missing = currentWorkflow(run(initialState(), 'IN16', { action: 'note' }))!;
 assert.deepEqual([missing.status, missing.missing], ['collecting', ['note']]);
});

test('product detail and comparison carry the underlying assets', () => {
 const one = currentWorkflow(run(initialState(), 'IN06', { productId: 'fund-bond' }))!;
 assert.equal(one.status, 'complete');
 assert.match(one.message, /底层资产：国债和政策性金融债（利率债）50%/);
 const both = currentWorkflow(run(initialState(), 'IN07', { productIds: ['fund-cash', 'fund-bond'] }))!;
 const result = both.result as { comparedFields: { field: string }[]; differences: { field: string }[] };
 assert.ok(result.comparedFields.some(f => f.field === 'underlying'));
 assert.ok(result.differences.some(f => f.field === 'underlying'));
 assert.match(both.message, /银行存款55%/);
 assert.doesNotMatch(both.message + one.message, ADVICE);
});

test('offline routing sends a review request to IN16 and an underlying question to IN06', () => {
 assert.equal(offlineWorkflow('帮我复盘一下我的理财')?.functionId, 'IN16');
 const s = initialState(), q = offlineWorkflow('债券基金底层是什么', s);
 assert.deepEqual([q?.functionId, q?.params?.productId], ['IN06', 'fund-bond']);
});
