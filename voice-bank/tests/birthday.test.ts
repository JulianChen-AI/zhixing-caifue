import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduceBank } from '../lib/bank/engine.ts';
import type { BankState } from '../lib/bank/types.ts';
import { currentWorkflow } from '../lib/workflows/engine.ts';
import { applyIntent, understandIntent } from '../lib/voice/intent-json.ts';
import { businessDay } from '../lib/demo/clock.ts';
import { birthdayPlan } from '../lib/plans/birthday.ts';

const fake = (body: object) => (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }))) as typeof fetch;
const turn = async (s: BankState, text: string, intent: object) => {
 const r = await understandIntent(s, text, [], { base: 'x', planner: 'm' }, new AbortController().signal, fake(intent));
 let after = s; await applyIntent(r, a => { after = reduceBank(after, a, crypto.randomUUID()); });
 return after;
};
const SAID = '张三下个月18号生日，帮我留1000，提前两天提醒我订蛋糕';

test('TR11: ordering from a merchant is guidance only, external, never complete', () => {
 const before = initialState();
 const s = reduceBank(before, { type: 'workflow', command: { source: 'card', operation: 'run', functionId: 'TR11', params: { item: '生日蛋糕' } } }, crypto.randomUUID());
 const t = currentWorkflow(s)!;
 assert.equal(t.status, 'external');
 assert.match(t.message, /生日蛋糕需要你在商户官方 App 或小程序自己下单；暂未接入商户开放接口，我没有下单，也没有付款/);
 assert.doesNotMatch(t.message, /已订好|已下单|已为你预订|订好了/);
 assert.deepEqual(s.accounts, before.accounts);
 assert.deepEqual(s.receipts, before.receipts);
});

test('birthday sentence becomes a plan: goal, reminder, then merchant guidance last; nothing is executed', async () => {
 const before = initialState(), day = businessDay(before), [y, m] = day.split('-').map(Number);
 const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
 const s = await turn(before, SAID, { intent: 'plan', steps: [
  { functionId: 'IN01', params: { name: '张三生日', target: 1000, deadline: `${next}-18` }, quote: '张三下个月18号生日，帮我留1000，' },
  { functionId: 'IN14', params: { action: 'create', remindAt: `${next}-16` }, quote: '提前两天提醒我' },
  { functionId: 'TR11', params: { item: '蛋糕' }, quote: '订蛋糕' },
 ] });
 assert.deepEqual(s.plan!.steps.map(x => x.functionId), ['IN01', 'IN14', 'TR11']);
 const t = currentWorkflow(s)!;
 assert.equal(t.functionId, 'IN01');
 assert.equal(t.status, 'review', t.message);
 assert.deepEqual(s.workflows!.records.goals.length, before.workflows!.records.goals.length, 'no goal before confirmation');
 assert.deepEqual(s.workflows!.records.reminders, []);
 assert.deepEqual(s.accounts, before.accounts);
});

test('birthdayPlan parses the sentence deterministically and leaves anything else to the model', () => {
 const s = initialState(), day = businessDay(s), [y, m] = day.split('-').map(Number);
 const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
 const plan = birthdayPlan(s, SAID)!;
 assert.deepEqual(plan.map(t => t.functionId), ['IN01', 'IN14', 'TR11']);
 assert.deepEqual(plan[0].params, { name: '张三生日', target: 1000, deadline: `${next}-18` });
 assert.deepEqual(plan[1].params, { action: 'create', remindAt: `${next}-16` });
 assert.deepEqual(plan[2].params, { item: '蛋糕' });
 assert.equal(plan.map(t => t.quote).join(''), SAID, 'quotes tile the sentence');
 for (const other of ['帮我订个生日蛋糕', '张三下个月生日', '下个月18号生日帮我提醒一下', '帮我留1000', '张三下个月18号生日，大概留几百'])
  assert.equal(birthdayPlan(s, other), undefined, other);
 const words = birthdayPlan(s, '妈妈下个月十八号生日，存一千，前一天提醒我')!;
 assert.deepEqual([words[0].params.target, words[0].params.deadline, words[1].params.remindAt], [1000, `${next}-18`, `${next}-17`]);
});

test('the birthday sentence opens the plan even when the model proposes only a reminder', async () => {
 const s = await turn(initialState(), SAID, { intent: 'run', functionId: 'IN14', params: { action: 'create' } });
 assert.deepEqual(s.plan!.steps.map(x => x.functionId), ['IN01', 'IN14', 'TR11']);
 assert.equal(currentWorkflow(s)!.status, 'review');
});
