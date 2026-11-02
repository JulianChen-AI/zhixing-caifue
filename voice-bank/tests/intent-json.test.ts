import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduceBank } from '../lib/bank/engine.ts';
import { applyIntent, echoesAssistant, understandIntent } from '../lib/voice/intent-json.ts';

const announced = { ...initialState(), lastReply: '现在办理“发起和管理 AA 收款”。“发起和管理 AA 收款”已完成。' };

test('our own announcement coming back as a user turn opens nothing and skips the model', async () => {
 let called = false;
 const r = await understandIntent(announced, '现在办理“发起和管理AA收款”', [], { base: 'x', planner: 'm' }, new AbortController().signal, (async () => { called = true; throw new Error('no call'); }) as typeof fetch);
 assert.equal(r.action, undefined); assert.deepEqual(r.dropped, ['echo']); assert.equal(called, false);
});

test('a user restating the review summary is not an echo', () => {
 assert.equal(echoesAssistant({ ...initialState(), lastReply: '请核对：从日常账户给房东张三转账500元。' }, '从日常账户给房东张三转账500元'), false);
});

test('short or new user words are not treated as echoes', () => {
 assert.equal(echoesAssistant(announced, '确认'), false);
 assert.equal(echoesAssistant(announced, '帮我查这个月的账单'), false);
 assert.equal(echoesAssistant(initialState(), '现在办理发起和管理AA收款', [{ reply: '现在办理“发起和管理 AA 收款”' }]), true);
});

test('“算了不转了，帮我查下余额” drops the open transfer before the balance query', async () => {
 const s = reduceBank(initialState(), { type: 'workflow', command: { operation: 'run', functionId: 'TR03', params: { amount: 500 }, source: 'card' } }, crypto.randomUUID());
 const transfer = s.workflows!.currentTaskId!;
 const reply = { choices: [{ message: { content: JSON.stringify({ intent: 'run', functionId: 'TR02', params: {}, say: '好的' }) } }] };
 const r = await understandIntent(s, '算了不转了，帮我查下余额', [], { base: 'x', planner: 'm' }, new AbortController().signal, (async () => new Response(JSON.stringify(reply))) as typeof fetch);
 assert.deepEqual(r.before, { type: 'workflow', command: { operation: 'cancel', taskId: transfer, source: 'card', utterance: '算了不转了，帮我查下余额' } });
 let after = s; await applyIntent(r, a => { after = reduceBank(after, a, crypto.randomUUID()); });
 assert.equal(after.workflows!.tasks.find(t => t.id === transfer)!.status, 'cancelled');
});

const said = (intent: object) => (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(intent) } }] }))) as typeof fetch;
const turn = async (s: ReturnType<typeof initialState>, text: string, intent: object) => {
 const r = await understandIntent(s, text, [], { base: 'x', planner: 'm' }, new AbortController().signal, said(intent));
 let after = s; await applyIntent(r, a => { after = reduceBank(after, a, crypto.randomUUID()); });
 return after;
};
const budget = { intent: 'run', functionId: 'BI08', params: { action: 'set' }, say: '好的' };

test('asking again for an open card returns to it instead of adding a duplicate', async () => {
 let s = await turn(initialState(), '帮我设置一些预算', budget);
 const first = s.workflows!.currentTaskId;
 s = await turn(s, '帮我设置一些预算', budget);
 assert.equal(s.workflows!.tasks.filter(t => t.functionId === 'BI08').length, 1);
 assert.equal(s.workflows!.currentTaskId, first);
 s = await turn(s, '暂停我的定时转账', { intent: 'run', functionId: 'TR04', params: { action: 'pause' }, say: '好的' });
 s = await turn(s, '帮我设置一些预算', budget);
 assert.equal(s.workflows!.tasks.filter(t => t.functionId === 'BI08').length, 1);
 assert.equal(s.workflows!.currentTaskId, first);
 assert.equal(s.plan?.steps.filter(step => step.functionId === 'BI08').length ?? 1, 1);
});

test('a repeat that adds values fills the open card; different values open a new one', async () => {
 let s = await turn(initialState(), '帮我设置一些预算', budget);
 s = await turn(s, '设置11月预算1500', { ...budget, params: { action: 'set', period: '2026-11', amount: 1500 } });
 assert.equal(s.workflows!.tasks.filter(t => t.functionId === 'BI08').length, 1);
 assert.equal(s.workflows!.tasks.find(t => t.functionId === 'BI08')!.params.amount, 1500);
 s = await turn(s, '12月预算也设1500', { ...budget, params: { action: 'set', period: '2026-12', amount: 1500 } });
 assert.equal(s.workflows!.tasks.filter(t => t.functionId === 'BI08').length, 2);
});
