import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduceBank } from '../lib/bank/engine.ts';
import type { BankAction, BankState } from '../lib/bank/types.ts';
import { CONTACTS } from '../lib/bank/types.ts';
import { currentWorkflow } from '../lib/workflows/engine.ts';
import { transferRisk } from '../lib/workflows/risk.ts';
import type { WorkflowCommand } from '../lib/workflows/types.ts';

const DAY = '2026-10-25T04:00:00.000Z'; // 12:00 Beijing
const NIGHT = '2026-10-25T15:30:00.000Z'; // 23:30 Beijing
const NEW = { id: 'wang-new', name: '王五', label: '新同学', bank: '模拟银行', tail: '5521', color: 'blue', previouslyUsed: false };

function state(clock: string, withNew = false): BankState {
 const s = initialState();
 s.demoClock = clock;
 if (withNew) s.contacts = [...CONTACTS, NEW];
 return s;
}
const act = (s: BankState, action: BankAction) => reduceBank(s, action, crypto.randomUUID());
const flow = (s: BankState, command: Omit<WorkflowCommand, 'source'> & { source?: 'card' | 'voice' }) => act(s, { type: 'workflow', command: { source: 'card', ...command } as WorkflowCommand });
const draft = (s: BankState, recipientId: string, amount = 500) => flow(s, { operation: 'run', functionId: 'TR03', params: { recipientId, accountId: 'daily', amount } });

test('risk score: amount, first payee, night and repeated payments to one person', () => {
 assert.deepEqual(transferRisk(state(DAY), { recipientId: 'zhang-roommate', amount: 50000 }), { score: 0, elevated: false, reasons: [] });
 assert.equal(transferRisk(state(DAY, true), { recipientId: 'wang-new', amount: 50000 }).elevated, false, 'a new payee alone does not interrupt');
 assert.equal(transferRisk(state(NIGHT), { recipientId: 'zhang-roommate', amount: 50000 }).elevated, false, 'night alone does not interrupt');
 const both = transferRisk(state(NIGHT, true), { recipientId: 'wang-new', amount: 50000 });
 assert.deepEqual([both.elevated, both.reasons], [true, ['第一次给这个收款人转账', '深夜（23:00—06:00）']]);
 assert.deepEqual(transferRisk(state(DAY), { recipientId: 'zhang-roommate', amount: 500000 }).reasons, ['金额较大（5,000元及以上）']);
 const s = state(DAY);
 s.receipts.push(...[1, 2].map(h => ({ id: 'r' + h, taskId: 't' + h, recipientId: 'li-friend', accountId: 'daily', amount: 40000, note: '', createdAt: new Date(Date.parse(DAY) - h * 3600000).toISOString() })));
 assert.deepEqual(transferRisk(s, { recipientId: 'li-friend', amount: 40000 }).reasons, ['24小时内已多次转给同一人']);
});

test('every transfer is confirmed on the card: voice and the realtime confirm intent are refused, by day or night', () => {
 for (const [clock, payee, contacts] of [[DAY, 'zhang-roommate', false], [NIGHT, 'wang-new', true]] as const) {
  let s = draft(state(clock, contacts), payee), t = currentWorkflow(s)!;
  assert.equal(t.status, 'review', t.message);
  assert.match(t.message, /核对无误请点卡片上的“确认”/);
  assert.throws(() => flow(s, { operation: 'confirm', taskId: t.id, token: t.reviewToken!, source: 'voice', utterance: '确认' }), /卡片上核对后点“确认”/);
  assert.throws(() => act(s, { type: 'intent', intent: { kind: 'confirm_transfer' } }), /卡片上核对后点“确认”/);
  s = flow(s, { operation: 'confirm', taskId: t.id, token: t.reviewToken! });
  assert.equal(currentWorkflow(s)!.status, 'authenticate', 'the card button works; authentication still follows');
  assert.equal(s.receipts.length, 0);
 }
});

test('elevated risk opens the review with the reasons to check; a usual daytime transfer has none', () => {
 assert.doesNotMatch(currentWorkflow(draft(state(DAY), 'zhang-roommate'))!.message, /请特别核对/);
 assert.match(currentWorkflow(draft(state(NIGHT, true), 'wang-new'))!.message, /^请特别核对：第一次给这个收款人转账、深夜/);
});

test('a spoken “确认” on a transfer card is answered with the card hint, not executed or raised as an error', async () => {
 const { understandIntent } = await import('../lib/voice/intent-json.ts');
 const s = draft(state(DAY), 'zhang-roommate');
 const fake = (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ intent: 'confirm' }) } }] }))) as typeof fetch;
 const r = await understandIntent(s, '确认', [], { base: 'x', planner: 'm' }, new AbortController().signal, fake);
 assert.equal(r.action, undefined);
 assert.equal(r.say, '转账请在卡片上核对后点“确认”。');
});
