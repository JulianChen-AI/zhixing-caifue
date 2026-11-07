import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initialState, reduceBank } from '../lib/bank/engine.ts';
import { currentWorkflow } from '../lib/workflows/engine.ts';
import { cardSnapshot, cardDataKey, explanationFacts, renderExplanation, explainCard, explainSavedCard, createExplanationCache } from '../lib/bank/card-explanation.ts';

const provider = { ready: true, base: 'https://example.invalid', key: 'test' };
const params: Record<string, Record<string, unknown>> = {
  IN10: {}, IN06: { productId: 'fund-cash' }, IN07: { productIds: ['fund-cash', 'fund-bond'] },
  BI06: { period: '2026-10' }, BI04: {}, SU08: {}, IN03: { goalId: 'goal-travel' },
};
function fixture(id: string) {
  const state = reduceBank(initialState(), { type: 'workflow', command: { operation: 'run', functionId: id, params: params[id], source: 'card' } }, crypto.randomUUID());
  const task = currentWorkflow(state)!;
  assert.equal(task.status, 'complete', task.message);
  return { state, task, snapshot: cardSnapshot(id, task.result)! };
}
const completion = (text: string) => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }));

for (const id of Object.keys(params)) test(`${id}: explains only the saved result with qwen-plus and leaves business state untouched`, async () => {
  const { state, task, snapshot } = fixture(id), before = structuredClone(state);
  assert.ok(snapshot);
  const facts = explanationFacts(snapshot), field = Object.keys(facts).find(key => /\d/.test(facts[key]));
  const output = await explainSavedCard(async () => state, task.id, cardDataKey(snapshot), provider, async (_url, init) => {
    const body = JSON.parse(String(init!.body));
    assert.equal(body.model, 'qwen-plus'); assert.equal(body.tools, undefined);
    const input = JSON.parse(body.messages[1].content);
    assert.deepEqual(input.card, snapshot); assert.deepEqual(input.facts, facts);
    assert.equal('accounts' in input, false); assert.equal('receipts' in input, false);
    return completion(field ? '卡片显示：' + facts[field] : '当前卡片没有可说明的数字。');
  });
  assert.equal(output, field ? '卡片显示：' + facts[field] : '当前卡片没有可说明的数字。');
  await assert.rejects(explainSavedCard(async () => state, task.id, cardDataKey(snapshot), provider, async () => new Response('unavailable', { status: 503 })));
  assert.deepEqual(state, before);
});

test('explanations reject invented numbers and advice, and keep the card numbers in any wording', () => {
  const snapshot = cardSnapshot('IN10', [{ value: 12345, cost: 10000, profitRate: 0.2345 }])!;
  assert.equal(explanationFacts(snapshot)['/0/value'], '123.45 元');
  for (const text of ['收益是999元', '收益为一千元', '收益为９９元', '建议买入', '可考虑赎回', '这只更适合你', '现在值得入手', '稳赚不赔', '', 42])
    assert.throws(() => renderExplanation(snapshot, text), String(text));
  assert.equal(renderExplanation(snapshot, '你投了100元，现在值123.45元，赚了23.45%。'), '你投了100元，现在值123.45元，赚了23.45%。');
  assert.equal(renderExplanation(snapshot, '你赚了23.45%。数据纯属合成演示。'), '你赚了23.45%。');
  assert.equal(renderExplanation(snapshot, '整体是赚的，持有这几项不用急着做决定。'), '整体是赚的，持有这几项不用急着做决定。');
});

test('same card data shares cached success and in-flight work; changed data or card kind does not', async () => {
  let calls = 0;
  const cache = createExplanationCache(async () => { calls++; return '已取得讲解'; });
  const a = cardSnapshot('IN03', { balance: 100, target: 200 })!;
  const reordered = cardSnapshot('IN03', { target: 200, balance: 100 })!;
  assert.equal(cardDataKey(a), cardDataKey(reordered));
  await Promise.all([cache.get(a), cache.get(reordered)]);
  await cache.get(a); assert.equal(calls, 1); assert.equal(cache.peek(a), '已取得讲解');
  await cache.get(cardSnapshot('IN03', { balance: 101, target: 200 })!);
  await cache.get(cardSnapshot('IN10', { balance: 100, target: 200 })!);
  assert.equal(calls, 3);
});

test('failed explanations are not cached, can retry, and cannot mutate the snapshot', async () => {
  const snapshot = cardSnapshot('BI06', { netExpenses: 12300 })!, before = structuredClone(snapshot);
  let calls = 0;
  const cache = createExplanationCache(async () => { if (++calls === 1) throw new Error('offline'); return '重试成功'; });
  await assert.rejects(cache.get(snapshot)); assert.equal(cache.peek(snapshot), undefined);
  assert.equal(await cache.get(snapshot), '重试成功'); assert.equal(calls, 2);
  assert.deepEqual(snapshot, before);
});

test('cache is bounded and page instances never share responses', async () => {
  const a = cardSnapshot('IN03', { balance: 100 })!, b = cardSnapshot('IN03', { balance: 200 })!;
  const one = createExplanationCache(async () => '本页讲解', 1), two = createExplanationCache(async () => '其他页讲解');
  await one.get(a); await one.get(b); assert.equal(one.peek(a), undefined); assert.equal(two.peek(b), undefined);
});

test('unsupported, incomplete, empty, oversized and non-finite results cannot be explained', () => {
  assert.equal(cardSnapshot('TR03', { amount: 1 }), null);
  assert.equal(cardSnapshot('IN10', null), null);
  assert.throws(() => cardSnapshot('IN03', { amount: NaN }));
  assert.throws(() => cardSnapshot('IN03', { text: 'a'.repeat(70000) }));
});

test('API uses session-owned completed cards, rejects stale data before and after inference', async () => {
  const { state, task, snapshot } = fixture('IN03'); let calls = 0;
  const request: typeof fetch = async () => { calls++; return completion('卡片已显示当前进度。'); };
  await assert.rejects(explainSavedCard(async () => state, 'not-owned', cardDataKey(snapshot), provider, request));
  await assert.rejects(explainSavedCard(async () => state, task.id, 'stale', provider, request));
  assert.equal(calls, 0);
  const pending = structuredClone(state); currentWorkflow(pending)!.status = 'review';
  await assert.rejects(explainSavedCard(async () => pending, task.id, cardDataKey(snapshot), provider, request));
  let reads = 0;
  const changed = structuredClone(state); currentWorkflow(changed)!.result = { balance: 99999 };
  await assert.rejects(explainSavedCard(async () => ++reads === 1 ? state : changed, task.id, cardDataKey(snapshot), provider, request));
  assert.equal(calls, 1);
});

test('provider failures, aborts, empty/invalid answers fail locally rather than fabricating a result', async () => {
  const { snapshot } = fixture('IN03');
  await assert.rejects(explainCard(snapshot, { ...provider, ready: false }, async () => { throw new Error('must not call'); }));
  for (const request of [
    async () => new Response('down', { status: 503 }), async () => { throw new Error('network'); },
    async () => new Response('{}'), async () => completion('余额999元'),
  ]) await assert.rejects(explainCard(snapshot, provider, request));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(explainCard(snapshot, provider, async () => completion('说明。'), controller.signal));
});

test('UI wires the result cards, confines failures to the explanation, and the endpoint never commits', () => {
  const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
  assert.match(read('../components/workflow-panel.tsx'), /CardExplanation/);
  const ui = read('../components/card-explanation.tsx');
  assert.match(ui, /AI 讲解/); assert.match(ui, /role="status"/); assert.match(ui, /role="alert"/);
  assert.doesNotMatch(ui, /onAction|reduceBank|bank_function/);
  assert.match(read('../app/layout.tsx'), /CardExplanationProvider/);
  const api = read('../app/api/bank/explain/route.ts');
  assert.match(api, /checkOrigin/); assert.match(api, /loadSession/); assert.doesNotMatch(api, /\bcommit\(/);
});
