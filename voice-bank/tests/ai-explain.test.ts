import test from 'node:test';
import assert from 'node:assert/strict';
import { checkedAnswer, explainCard } from '../lib/ai/explain.ts';

const card = { holdings: [{ name: '现金基金', cost: 100000, value: 103250, profitRate: 0.0325, holdingDays: 45 }] };

test('an answer may only use numbers on the card, in cents, yuan or percent', () => {
 assert.ok(checkedAnswer('现金基金成本1,000元，现在1032.5元，赚了3.25%，持有45天。', card));
 assert.equal(checkedAnswer('按这个速度一年能赚到1200元。', card), null, 'a new number is dropped');
});

test('advice and promises are dropped', () => {
 assert.equal(checkedAnswer('建议你继续持有现金基金。', card), null);
 assert.equal(checkedAnswer('这只稳赚不赔。', card), null);
 assert.equal(checkedAnswer('', card), null);
});

test('unknown cards are refused and a checked answer comes back from the model', async () => {
 const fake = (async () => new Response(JSON.stringify({ choices: [{ message: { content: '现金基金持有45天，赚了3.25%。' } }] }))) as typeof fetch;
 const p = { base: 'x', key: 'k', planner: 'm' }, signal = new AbortController().signal;
 assert.equal(await explainCard('IN16', card, p, signal, fake), '现金基金持有45天，赚了3.25%。');
 await assert.rejects(explainCard('TR03', card, p, signal, fake));
});
