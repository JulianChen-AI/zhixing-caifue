import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduceBank } from '../lib/bank/engine.ts';
import { CONTACTS } from '../lib/bank/types.ts';
import { understandIntent } from '../lib/voice/intent-json.ts';
import { upperAmount, spokenYuan } from '../lib/bank/amount-words.ts';
import { currentWorkflow } from '../lib/workflows/engine.ts';

const fake = (body: object) => (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }))) as typeof fetch;
const hear = (text: string, amount: number, functionId = 'TR03') => understandIntent(initialState(), text, [], { base: 'x', planner: 'm' }, new AbortController().signal,
 fake({ intent: 'run', functionId, params: { recipientId: 'li-friend', accountId: 'daily', amount }, say: '好的' }));

test('capitals and spoken words for amounts in cents', () => {
 const cases: [number, string][] = [[300000, '叁仟元整'], [30000, '叁佰元整'], [1200000, '壹万贰仟元整'], [100500, '壹仟零伍元整'], [120050, '壹仟贰佰元伍角'], [123, '壹元贰角叁分'], [5, '伍分'], [10000000, '壹拾万元整'], [10010000, '壹拾万零壹佰元整']];
 for (const [cents, words] of cases) assert.equal(upperAmount(cents), words, String(cents));
 assert.deepEqual([spokenYuan(30000), spokenYuan(300000), spokenYuan(1200000), spokenYuan(1000), spokenYuan(5050)], ['三百', '三千', '一万二千', '十', '50.5元']);
});

test('one amount heard differently by the model: no draft, ask which', async () => {
 const r = await hear('给同学李四转三千，用日常账户', 300);
 assert.equal(r.action, undefined);
 assert.equal(r.say, '金额是三千还是三百？请再说一遍要转多少。');
 const digits = await hear('给同学李四转3000元，用日常账户', 300);
 assert.equal(digits.action, undefined);
 assert.match(digits.say, /三千还是三百/);
});

test('no conflict, mixed forms and relative changes do not interrupt', async () => {
 for (const [text, amount] of [['给同学李四转三千，用日常账户', 3000], ['给同学李四转300，用日常账户', 300], ['给同学李四转1万2，用日常账户', 12000], ['两百五，不对，三百，转给同学李四', 300], ['再加100', 300]] as [string, number][]) {
  const r = await hear(text, amount);
  assert.ok(r.action, text);
  assert.ok(!r.dropped.some(d => d.startsWith('amount:conflict')), text);
 }
 // Only transfers are checked; other amounts keep their own rules.
 assert.ok((await understandIntent(initialState(), '往旅行目标存三千', [], { base: 'x', planner: 'm' }, new AbortController().signal, fake({ intent: 'run', functionId: 'IN02', params: { direction: 'deposit', goalId: 'goal-travel', amount: 300 } }))).action);
});

test('the transfer review reads the amount back in capitals and asks for the card button', () => {
 const run = (s: ReturnType<typeof initialState>, amount: number, recipientId = 'li-friend') => reduceBank(s, { type: 'workflow', command: { source: 'card', operation: 'run', functionId: 'TR03', params: { recipientId, accountId: 'daily', amount } } }, crypto.randomUUID());
 const day = initialState(); day.demoClock = '2026-10-25T04:00:00.000Z';
 const usual = currentWorkflow(run(day, 3000))!.message;
 assert.match(usual, /转 3,000(?:\.00)? 元（叁仟元整）/);
 assert.match(usual, /核对无误请点卡片上的“确认”/);
 const night = initialState(); night.demoClock = '2026-10-25T15:30:00.000Z';
 night.contacts = [...CONTACTS, { id: 'wang-new', name: '王五', label: '新同学', bank: '模拟银行', tail: '5521', color: 'blue', previouslyUsed: false }];
 const card = currentWorkflow(run(night, 500, 'wang-new'))!.message;
 assert.match(card, /^请特别核对：.*（伍佰元整）。核对无误请点卡片上的“确认”/);
});
