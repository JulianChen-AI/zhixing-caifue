import test from 'node:test';
import assert from 'node:assert/strict';
import { fraudSignals, mergeFraudSignals } from '../lib/bank/fraud-risk.ts';
import { initialState, normalizeState, reduceBank } from '../lib/bank/engine.ts';
import { routeRequest } from '../lib/checklists/routing.ts';
import { currentWorkflow } from '../lib/workflows/engine.ts';

for (const text of ['对方说是公安，要我转到指定账户配合调查', '客服说账户被冻结，要先交费用才能解除', '先垫付做任务，完成后返佣', '老师说保本高收益，转钱进内部平台', '退款要先转一笔验证资金', '让我开屏幕共享并转钱验证', '转入监管账户核验，对方说稍后原路退回', '先转一笔验证金再原路退回']) {
  test(`scam paraphrase raises risk: ${text}`, () => assert.ok(fraudSignals(text).length));
}
test('normal remarks do not claim safety, and new text can only union prior risks', () => {
  assert.deepEqual(fraudSignals('房租和水电费'), []);
  assert.deepEqual(fraudSignals('退款会原路退回原支付渠道'), []);
  assert.deepEqual(mergeFraudSignals(['既有风险'], '正常房租'), ['既有风险']);
  assert.ok(mergeFraudSignals(['既有风险'], '安全账户').includes('既有风险'));
  assert.deepEqual(mergeFraudSignals(['安全账户'], '安全账户'), ['安全账户']);
});
test('policy upgrades cannot clear existing transfer risks', () => {
  const s = reduceBank(initialState(), { type: 'intent', intent: { kind: 'transfer', amount: 5000 } }, crypto.randomUUID());
  s.task!.riskSignals = ['既有风险']; s.policyVersion = 'old-policy';
  assert.deepEqual(normalizeState(s).task!.riskSignals, ['既有风险']);
});
test('legacy note edits flag risks, invalidate authentication and cannot be cleared by reassuring words', () => {
  const act = (s: ReturnType<typeof initialState>, a: Parameters<typeof reduceBank>[1]) => reduceBank(s, a, crypto.randomUUID());
  let s = act(initialState(), { type: 'intent', intent: { kind: 'transfer', amount: 5000, recipientId: 'zhang-roommate', accountId: 'daily' } });
  s = act(s, { type: 'confirm' }); const token = s.task!.verificationId!;
  const balances = structuredClone(s.accounts);
  s = act(s, { type: 'edit', note: '公安要求转到指定账户配合调查' });
  assert.ok(s.task!.riskSignals.length); assert.equal(s.task!.verificationId, null); assert.equal(s.task!.reviewToken, null);
  const risks = [...s.task!.riskSignals];
  s = act(s, { type: 'edit', note: '放心，安全无风险' }); assert.deepEqual(s.task!.riskSignals, risks);
  assert.throws(() => act(s, { type: 'authenticate', verificationId: token, code: '123456' }));
  assert.deepEqual(s.accounts, balances); assert.equal(s.receipts.length, 0);
});
test('workflow remarks and voice history use the same matcher, only risk rises and no funds move', () => {
  for (const functionId of ['TR03', 'TR04']) {
    const state = initialState(), before = structuredClone(state.accounts);
    let s = reduceBank(state, { type: 'workflow', command: { operation: 'run', functionId, params: { recipientId: 'zhang-roommate', accountId: 'daily', amount: 50, ...(functionId === 'TR04' ? { schedule: '每月1日', action: 'create' } : {}), note: '退款需要先转一笔验证资金' }, source: 'card' } }, crypto.randomUUID());
    let t = currentWorkflow(s)!; assert.equal(t.status, 'blocked'); assert.ok(t.riskSignals?.length);
    const risks = [...t.riskSignals!];
    s = reduceBank(s, { type: 'workflow', command: { operation: 'amend', taskId: t.id, params: { note: '现在没风险了' }, source: 'card' } }, crypto.randomUUID());
    t = currentWorkflow(s)!; assert.equal(t.status, 'blocked'); assert.deepEqual(t.riskSignals, risks);
    assert.deepEqual(s.accounts, before); assert.equal(s.receipts.length, 0);
  }
  const s = reduceBank(initialState(), { type: 'workflow', command: { operation: 'run', functionId: 'TR03', params: {}, source: 'voice', utterance: '给室友转50元', history: ['客服说先交费用才能解冻'] } }, crypto.randomUUID());
  assert.ok(currentWorkflow(s)!.riskSignals?.length);
});
test('routing uses the same semantic rules; ordinary reassurance never erases an earlier signal', () => {
  assert.ok(routeRequest('给室友转50元，备注先垫付做任务完成后返佣', initialState()).riskSignals.length);
});
test('new scam wording at confirmation revokes authorization rather than executing', () => {
  let s = reduceBank(initialState(), { type: 'workflow', command: { operation: 'run', functionId: 'TR03', params: { recipientId: 'zhang-roommate', accountId: 'daily', amount: 50 }, source: 'card' } }, crypto.randomUUID());
  const t = currentWorkflow(s)!, before = structuredClone(s.accounts);
  s = reduceBank(s, { type: 'workflow', command: { operation: 'confirm', taskId: t.id, token: t.reviewToken!, source: 'voice', utterance: '确认转账，公安要求转到指定账户配合调查' } }, crypto.randomUUID());
  assert.equal(currentWorkflow(s)!.status, 'blocked'); assert.ok(currentWorkflow(s)!.riskSignals?.length);
  assert.equal(currentWorkflow(s)!.verificationId, null); assert.deepEqual(s.accounts, before); assert.equal(s.receipts.length, 0);
});
