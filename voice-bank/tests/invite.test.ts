import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduceBank } from '../lib/bank/engine.ts';
import type { BankState } from '../lib/bank/types.ts';
import { currentWorkflow } from '../lib/workflows/engine.ts';
import { offlineWorkflow } from '../lib/workflows/offline.ts';
import { inviteeName, inviteText } from '../lib/workflows/invite.ts';
import type { Params, WorkflowCommand } from '../lib/workflows/types.ts';
import { understandIntent } from '../lib/voice/intent-json.ts';

const act = (s: BankState, command: Omit<WorkflowCommand, 'source'>, requestId = crypto.randomUUID()) => reduceBank(s, { type: 'workflow', command: { source: 'card', ...command } }, requestId);
const run = (s: BankState, id: string, params: Params = {}) => act(s, { operation: 'run', functionId: id, params });
const invites = (s: BankState) => s.workflows!.records.invites || [];

test('TR10: the draft writes nothing; confirmation (no authentication) sends once by the simulated channel', () => {
 const before = initialState();
 let s = run(before, 'TR10', { action: 'create', invitee: '张三' }), t = currentWorkflow(s)!;
 assert.equal(t.status, 'review', t.message);
 assert.match(t.message, /模拟通道（演示）/);
 assert.match(t.message, /不读通讯录、不群发/);
 assert.equal(invites(s).length, 0, 'nothing recorded before confirmation');
 assert.deepEqual(s.accounts, before.accounts);
 const token = t.reviewToken!;
 s = act(s, { operation: 'confirm', taskId: t.id, token });
 t = currentWorkflow(s)!;
 assert.equal(t.status, 'complete', t.message);
 assert.equal(invites(s).length, 1);
 assert.deepEqual([invites(s)[0].invitee, invites(s)[0].status], ['张三', 'simulated_sent']);
 assert.match(t.message, /演示，不是真实消息/);
 assert.deepEqual(s.accounts, before.accounts, 'no money moves');
 // The same confirmation again, by token or by a replayed request, sends nothing more.
 assert.throws(() => act(s, { operation: 'confirm', taskId: t.id, token }));
 const again = run(s, 'TR10', { action: 'create', invitee: '张三' });
 assert.equal(currentWorkflow(again)!.status, 'blocked');
 assert.match(currentWorkflow(again)!.message, /不重复发送/);
 assert.equal(invites(again).length, 1);
});

test('TR10: a replayed confirm request id is ignored', () => {
 let s = run(initialState(), 'TR10', { action: 'create', invitee: '李四' });
 const t = currentWorkflow(s)!, id = crypto.randomUUID();
 s = act(s, { operation: 'confirm', taskId: t.id, token: t.reviewToken! }, id);
 assert.equal(act(s, { operation: 'confirm', taskId: t.id, token: t.reviewToken! }, id), s);
 assert.equal(invites(s).length, 1);
});

test('TR10: one named person only, no groups or lists', () => {
 assert.equal(inviteeName(' 王五 '), '王五');
 for (const bad of ['张三、李四', '张三和李四', '全班同学', '宿舍群', '大家', '所有人', ''])
  assert.throws(() => inviteeName(bad), Error, bad);
 const t = currentWorkflow(run(initialState(), 'TR10', { action: 'create', invitee: '张三和李四' }))!;
 assert.equal(t.status, 'blocked');
 assert.match(t.message, /不群发/);
});

test('TR10: the perk is marked demo and tied to no transaction; status reads the record', () => {
 assert.match(inviteText('张三'), /演示权益，与开户、存款、转账、消费都无关/);
 assert.doesNotMatch(inviteText('张三'), /转账即得|存入.*奖励|首笔|满\d+/);
 let s = run(initialState(), 'TR10', { action: 'status' });
 assert.deepEqual([currentWorkflow(s)!.status, currentWorkflow(s)!.message], ['complete', '还没有发出过邀请。']);
 s = run(s, 'TR10', { action: 'create', invitee: '张三' });
 const t = currentWorkflow(s)!;
 s = act(s, { operation: 'confirm', taskId: t.id, token: t.reviewToken! });
 s = run(s, 'TR10', { action: 'status' });
 assert.match(currentWorkflow(s)!.message, /张三（已通过模拟通道发送，对方尚未回应）/);
});

test('offline routing: invite a named classmate, or ask for invitation status', () => {
 assert.deepEqual(offlineWorkflow('邀请室友张三也来用')?.params, { action: 'create', invitee: '张三' });
 assert.equal(offlineWorkflow('我的邀请状态怎么样')?.params?.action, 'status');
});

test('intent: a contact id proposed as invitee becomes the spoken name; an unsaid name is dropped', async () => {
 const fake = (body: object) => (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }))) as typeof fetch;
 const ask = (text: string, invitee: string) => understandIntent(initialState(), text, [], { base: 'x', planner: 'm' }, new AbortController().signal, fake({ intent: 'run', functionId: 'TR10', params: { action: 'create', invitee } }));
 const byId = await ask('邀请我室友张三也来用这个银行', 'zhang-roommate');
 assert.deepEqual((byId.action as { command: { params: Params } }).command.params, { action: 'create', invitee: '张三' });
 const unsaid = await ask('邀请我室友也来用', '李四');
 assert.deepEqual((unsaid.action as { command: { params: Params } }).command.params, { action: 'create' });
 assert.ok(unsaid.dropped.includes('invitee:unheard'));
});
