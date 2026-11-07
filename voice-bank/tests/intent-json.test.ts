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

test('a non-text value for a free-text field is dropped instead of reaching the card', async () => {
 const reply = { choices: [{ message: { content: JSON.stringify({ intent: 'run', functionId: 'TR03', params: { recipientId: 'zhang-roommate', amount: 500, archive: false, note: { x: 1 } }, say: '好的' }) } }] };
 const r = await understandIntent(initialState(), '给室友张三转500', [], { base: 'x', planner: 'm' }, new AbortController().signal, (async () => new Response(JSON.stringify(reply))) as typeof fetch);
 assert.ok(r.dropped.includes('archive:type') && r.dropped.includes('note:type'));
 const params = (r.action as { command: { params: Record<string, unknown> } }).command.params;
 assert.equal(params.archive, undefined); assert.equal(params.amount, 500);
});

test('a chat reply that claims a change is replaced, because nothing changed', async () => {
 const reply = { choices: [{ message: { content: JSON.stringify({ intent: 'chat', say: '好的，已取消暂停操作，继续为您服务。' }) } }] };
 const r = await understandIntent(initialState(), '稍等，不是取消', [], { base: 'x', planner: 'm' }, new AbortController().signal, (async () => new Response(JSON.stringify(reply))) as typeof fetch);
 assert.equal(r.action, undefined); assert.doesNotMatch(r.say, /已取消/); assert.ok(r.dropped.includes('say:claimed_change'));
});

test('names the user labelled are kept when the model collapses two people with the same name', async () => {
 const reply = { choices: [{ message: { content: JSON.stringify({ intent: 'run', functionId: 'TR05', params: { action: 'create', total: 240, participants: ['我', '张三', '李四', '张三'] }, say: '好的' }) } }] };
 const r = await understandIntent(initialState(), '我、室友张三、同学李四、房东张三', [], { base: 'x', planner: 'm' }, new AbortController().signal, (async () => new Response(JSON.stringify(reply))) as typeof fetch);
 assert.deepEqual((r.action as unknown as { command: { params: { participants: string[] } } }).command.params.participants, ['我', '室友张三', '同学李四', '房东张三']);
});

test('the sum in the user sentence corrects the model reading of jiao and fen', async () => {
 const reply = { choices: [{ message: { content: JSON.stringify({ intent: 'run', functionId: 'TR03', params: { recipientId: 'zhang-roommate', amount: 50.05 }, say: '好的' }) } }] };
 const r = await understandIntent(initialState(), '给室友张三转五十块零五毛', [], { base: 'x', planner: 'm' }, new AbortController().signal, (async () => new Response(JSON.stringify(reply))) as typeof fetch);
 assert.equal((r.action as unknown as { command: { params: { amount: number } } }).command.params.amount, 50.5);
});

test('a meaningless AA carve-out is dropped, and a finished card turns an edit into a new business', async () => {
 const fake = (body: object) => (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }))) as typeof fetch;
 const r = await understandIntent(initialState(), '四个人吃饭360，我请两个，剩下的和张三AA', [], { base: 'x', planner: 'm' }, new AbortController().signal, fake({ intent: 'run', functionId: 'TR05', params: { action: 'create', total: 360, adjustments: [{ label: '饭钱', amount: 360, participants: ['我', '我'] }] }, say: '好的' }));
 assert.ok(r.dropped.includes('adjustments:unclear'));
 assert.equal((r.action as unknown as { command: { params: Record<string, unknown> } }).command.params.adjustments, undefined);
 let s = reduceBank(initialState(), { type: 'workflow', command: { operation: 'run', functionId: 'TR05', params: { action: 'create', total: 360 }, source: 'card' } }, crypto.randomUUID());
 s = reduceBank(s, { type: 'workflow', command: { operation: 'cancel', taskId: s.workflows!.currentTaskId!, source: 'card' } }, crypto.randomUUID());
 const again = await understandIntent(s, '每人70，一共5个人AA，总共350', [], { base: 'x', planner: 'm' }, new AbortController().signal, fake({ intent: 'amend', params: { total: 350 }, say: '好的' }));
 assert.equal((again.action as unknown as { command: { operation: string } }).command.operation, 'run');
});

test('asking whether a finished business went through reads its record instead of cancelling', async () => {
 let s = reduceBank(initialState(), { type: 'workflow', command: { operation: 'run', functionId: 'SU04', params: { subscriptionId: 'sub-video' }, source: 'card' } }, crypto.randomUUID());
 const id = s.workflows!.currentTaskId!;
 s = reduceBank(s, { type: 'workflow', command: { operation: 'confirm', taskId: id, token: s.workflows!.tasks.find(t => t.id === id)!.reviewToken! , source: 'card' } }, crypto.randomUUID());
 s = reduceBank(s, { type: 'workflow', command: { operation: 'authenticate', taskId: id, token: s.workflows!.tasks.find(t => t.id === id)!.verificationId!, code: '123456', source: 'card' } }, crypto.randomUUID());
 const r = await understandIntent(s, '视频会员刚才取消了吗', [], { base: 'x', planner: 'm' }, new AbortController().signal, (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ intent: 'cancel', say: '好的' }) } }] }))) as typeof fetch);
 assert.deepEqual((r.action as unknown as { command: { operation: string; taskId: string } }).command, { operation: 'status', taskId: id, source: 'card', utterance: '视频会员刚才取消了吗' });
});

test('per-person times head count must match the stated total', async () => {
 const r = await understandIntent(initialState(), '每人 80，一共 5 个人 AA，总共 350', [], { base: 'x', planner: 'm' }, new AbortController().signal, (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ intent: 'run', functionId: 'TR05', params: { action: 'create', total: 350 }, say: '好的' }) } }] }))) as typeof fetch);
 assert.equal(r.action, undefined); assert.match(r.say, /合计应是400元.*总共350元/);
});

test('a card described by its state is chosen by the record, and several matches are asked about', async () => {
 const fake = (body: object) => (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }))) as typeof fetch;
 const many = await understandIntent(initialState(), '冻结我那张受限的卡', [{ user: '从储蓄账户给他转两百', reply: '' }], { base: 'x', planner: 'm' }, new AbortController().signal, fake({ intent: 'run', functionId: 'CA06', params: { action: 'freeze', cardId: 'card-risk' }, say: '好的' }));
 assert.equal(many.action, undefined); assert.match(many.say, /受限的卡有 2 张：储蓄借记卡（尾号3609.*备用借记卡（尾号9012/);
 const one = await understandIntent(initialState(), '冻结我那张正常的卡', [], { base: 'x', planner: 'm' }, new AbortController().signal, fake({ intent: 'run', functionId: 'CA06', params: { action: 'freeze' }, say: '好的' }));
 assert.equal((one.action as unknown as { command: { params: { cardId: string } } }).command.params.cardId, 'card-daily');
});
