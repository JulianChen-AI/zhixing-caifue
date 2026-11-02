// Pre-shoot acceptance cases (技术实现指导 §13, T01–T24) against the demo-video sandbox.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DemoSandbox, SandboxError } from '../lib/demo/sandbox.ts';
import { canonicalJson, sha256Hex } from '../lib/demo/sha256.ts';
import { isVerbalConfirm, parseAa, parseGoalRule, parseInvestLearn, parseNumber, parsePayday, parseTransfer } from '../lib/demo/intent.ts';
import { DINNER_MEMBERS } from '../lib/demo/fixtures.ts';

const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as SandboxError).code; } return 'NO_ERROR'; };
function transferToBadminton(sb: DemoSandbox) {
  const draft = sb.transferPrepare('ZS-BADM-7291', 12_000, '球场费');
  const cfm = sb.confirm(draft.draft_id, { type: 'manual_click' }).data.confirmation_id!;
  sb.reauthVerify(cfm);
  return { draft, cfm };
}
function aaItemized(sb: DemoSandbox) {
  const [v1, v2] = parseAa('昨晚360元饭钱，六个人AA制。等等，60元饮料只有张三、林悦、周扬喝了，我没喝。');
  const toItems = (d: typeof v1) => d.items.map(i => ({ name: i.name, amount_fen: i.amount_fen, participants: i.participants === 'ALL' ? DINNER_MEMBERS : i.participants }));
  sb.aaDraft(sb.aaCalculate(1, toItems(v1), DINNER_MEMBERS, '小知'));
  const calc = sb.aaCalculate(2, toItems(v2), DINNER_MEMBERS, '小知');
  const draft = sb.aaDraft(calc);
  return { calc, draft };
}

test('sha256 matches node crypto on canonical JSON', () => {
  for (const text of ['', 'abc', canonicalJson({ b: 1, a: [2, { d: '张三', c: null }] }), 'x'.repeat(1000)]) {
    assert.equal(sha256Hex(text), createHash('sha256').update(text).digest('hex'));
  }
  assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }));
});

test('intent parser turns the script lines into drafts only', () => {
  assert.equal(parseNumber('一百二十'), 120); assert.equal(parseNumber('六'), 6); assert.equal(parseNumber('400'), 400);
  assert.deepEqual(parseTransfer('给张三转120，昨天球场费。'), { intent: 'transfer', payee_name: '张三', amount_fen: 12_000, purpose: '球场费' });
  assert.deepEqual(parseTransfer('给张三转账120，昨天球场费。'), { intent: 'transfer', payee_name: '张三', amount_fen: 12_000, purpose: '球场费' });
  assert.deepEqual(parsePayday('工资到了，帮我做本月安排，再留400请爸妈吃饭。'), { intent: 'payday_plan', extra_budget: { name: '家庭聚餐', amount_fen: 40_000 } });
  assert.deepEqual(parseGoalRule('每月先存400到本人同名目标账户，连续三个月。'), { intent: 'goal_rule', amount_fen: 40_000, times: 3, to: 'SELF_SAME_NAME' });
  assert.deepEqual(parseInvestLearn('再拿200了解理财，但先告诉我可能怎么亏。'), { intent: 'invest_learn', amount_fen: 20_000, wants_risk_first: true });
  assert.ok(isVerbalConfirm('对，确认。'));
});

test('T01 three Zhang San candidates, none selected, no order', () => {
  const sb = new DemoSandbox().reset('transfer');
  const r = sb.contactSearch('张三');
  assert.equal(r.status, 'NEEDS_PAYEE_DISAMBIGUATION');
  assert.equal(r.data.candidates.length, 3);
  assert.equal(r.data.selected, null);
  assert.equal(sb.orders.size, 0);
});

test('T02 confirmation payload binds only the chosen badminton Zhang San', () => {
  const sb = new DemoSandbox().reset('transfer');
  const draft = sb.transferPrepare('ZS-BADM-7291', 12_000, '球场费');
  assert.equal(draft.payload.to, 'ZS-BADM-7291');
  assert.equal(draft.payload.to_tail, '7291');
});

test('T03 saying "确认转账" keeps the transfer waiting and the balance unchanged', () => {
  const sb = new DemoSandbox().reset('transfer');
  const draft = sb.transferPrepare('ZS-BADM-7291', 12_000, '球场费');
  const r = sb.confirm(draft.draft_id, { type: 'voice', text: '对，确认。' });
  assert.equal(r.status, 'READY_FOR_CONFIRMATION');
  assert.equal(r.data.confirmation_id, null);
  assert.equal(sb.confirmations.size, 0);
  assert.equal(sb.orders.size, 0);
  assert.equal(sb.balance_fen, 114_000);
});

test('T04 manual confirmation submits once; repeated clicks with the same key stay one order', () => {
  const sb = new DemoSandbox().reset('transfer');
  const { draft, cfm } = transferToBadminton(sb);
  const first = sb.transferSubmit(cfm, 'IDEM-TR-01', draft.payload);
  const again = sb.transferSubmit(cfm, 'IDEM-TR-01', draft.payload);
  assert.equal(first.order_id, again.order_id);
  assert.equal(sb.ordersOf('transfer').length, 1);
  assert.equal(sb.balance_fen, 102_000);
  assert.equal(sb.audit.find(a => a.event === 'submit')?.confirmation_method, 'manual_click');
});

test('T05 itemized AA: 360 total, 310 receivable, 190 received + 120 pending', () => {
  const sb = new DemoSandbox().reset('transfer');
  const { calc, draft } = aaItemized(sb);
  assert.deepEqual(calc.shares.map(s => [s.member, s.amount_fen / 100]), [['小知', 50], ['张三', 70], ['林悦', 70], ['周扬', 70], ['陈宁', 50], ['许然', 50]]);
  assert.equal(calc.total_fen, 36_000);
  assert.equal(calc.receivable_fen, 31_000);
  assert.equal([...sb.drafts.values()].filter(d => d.op === 'aa_create' && d.void).length, 1, 'even-split draft voided');
  const cfm = sb.confirm(draft.draft_id, { type: 'manual_click' }).data.confirmation_id!;
  sb.aaCreate(cfm, 'IDEM-AA-01', draft.payload);
  sb.aaSimulateNextDay();
  const status = sb.aaStatus();
  assert.equal(status.received_fen, 19_000);
  assert.equal(status.pending_fen, 12_000);
  assert.deepEqual(status.pending, ['周扬', '许然']);
  assert.equal(status.status, 'PARTIALLY_RECEIVED');
});

test('T06 reminder re-checks payment and keeps sending separate from arrival', () => {
  const sb = new DemoSandbox().reset('transfer');
  const { draft } = aaItemized(sb);
  sb.aaCreate(sb.confirm(draft.draft_id, { type: 'manual_click' }).data.confirmation_id!, 'IDEM-AA-01', draft.payload);
  sb.aaSimulateNextDay();
  const remind = sb.aaRemindPrepare();
  assert.deepEqual(remind.payload.members, ['周扬', '许然']);
  sb.aaMarkPaid('周扬'); // pays between preparing and sending
  sb.aaRemind(sb.confirm(remind.draft_id, { type: 'manual_click' }).data.confirmation_id!, 'IDEM-RM-01', remind.payload);
  assert.equal(sb.aa!.members['周扬'].reminder, 'SKIPPED_PAID');
  assert.equal(sb.aa!.members['许然'].reminder, 'SENT');
  assert.equal(sb.aa!.members['许然'].payment, 'UNPAID');
});

test('T07 bill summary reports inferred category amount/count and scope, not cups', () => {
  const sb = new DemoSandbox().reset('bills');
  const r = sb.billSummary();
  assert.deepEqual(r.data.coffee, { amount_fen: 12_600, count: 8, mom_count_delta: 3, label: '推断' });
  assert.match(r.data.inference, /不代表实际商品或杯数/);
  assert.deepEqual(r.missing_data, ['未接入第三方平台', '现金']);
  assert.doesNotMatch(JSON.stringify(r), /杯咖啡|依赖/);
});

test('T08 correcting a category changes only that transaction; raw fields stay local', () => {
  const sb = new DemoSandbox().reset('bills');
  sb.billCorrect('TX-PRINT-018', '学习/打印');
  assert.equal(sb.txs.find(t => t.tx_id === 'TX-PRINT-018')!.category, '学习/打印');
  assert.equal(sb.txs.find(t => t.tx_id === 'TX-CANT-021')!.category, '餐饮');
  assert.equal(sb.merchantRules.length, 0);
  const queued = JSON.stringify(sb.federatedQueue);
  assert.doesNotMatch(queued, /校园服务中心|1800|10-18|TX-PRINT/);
});

test('T09 k below 20 or no DP budget: nothing is published', () => {
  const sb = new DemoSandbox().reset('bills');
  sb.billCorrect('TX-PRINT-018', '学习/打印');
  const f = sb.federatedStatus();
  assert.equal(f.k, 1);
  assert.equal(f.publishable, false);
  assert.equal(f.dp_budget_status, 'NOT_GRANTED_DEMO');
});

test('T10 bank-direct subscription: only the channel release is simulated, other states independent', () => {
  const sb = new DemoSandbox().reset('bills');
  const plan = sb.subscriptionPlan('SUB-VIDEO-25') as { draft: { draft_id: string; payload: Record<string, unknown> } };
  const cfm = sb.confirm(plan.draft.draft_id, { type: 'manual_click' }).data.confirmation_id!;
  sb.subscriptionReleaseBank(cfm, 'IDEM-SUB-01', plan.draft.payload);
  assert.deepEqual(sb.subscriptions['SUB-VIDEO-25'], { bank_channel_release: 'RELEASED_SIMULATED', merchant_cancellation: 'UNCONFIRMED', refund: 'NOT_REQUESTED', post_due_non_debit_check: 'PENDING' });
  assert.equal(sb.subscriptionVerifyNonDebit('SUB-VIDEO-25', false).post_due_non_debit_check, 'PENDING');
  assert.equal(sb.subscriptionVerifyNonDebit('SUB-VIDEO-25', true).post_due_non_debit_check, 'VERIFIED_NOT_DEBITED');
});

test('T11 external subscription only yields the official entry, never cancelled', () => {
  const sb = new DemoSandbox().reset('bills');
  const r = sb.subscriptionPlan('SUB-MUSIC-31') as { status: string };
  assert.equal(r.status, 'EXTERNAL_ONLY');
  assert.equal(sb.subscriptions['SUB-MUSIC-31'].bank_channel_release, 'ACTIVE');
  assert.equal(sb.orders.size, 0);
});

test('T12 three reviewers disagree; verdict is NEEDS_USER_VERIFICATION and nothing is frozen', () => {
  const sb = new DemoSandbox().reset('cards');
  const r = sb.anomalyReview();
  assert.equal(r.status, 'NEEDS_USER_VERIFICATION');
  assert.deepEqual(Object.values(r.data.reviews).map(x => x.position), ['有交易记录', '需要核实', '等待用户']);
  assert.equal(sb.card.status, 'ACTIVE');
  assert.doesNotMatch(JSON.stringify(r), /盗刷已确认|已冻结/);
});

test('T13 "不是我" without manual confirmation does not freeze', () => {
  const sb = new DemoSandbox().reset('cards');
  assert.equal(code(() => sb.cardFreezePrepare()), 'NOT_ALLOWED');
  sb.anomalyReview(); sb.anomalyAnswer('NOT_ME');
  const draft = sb.cardFreezePrepare();
  assert.equal(code(() => sb.cardFreezeSubmit('CFM-9999', 'IDEM-FZ-01', draft.payload)), 'CONFIRMATION_NOT_FOUND');
  const cfm = sb.confirm(draft.draft_id, { type: 'manual_click' }).data.confirmation_id!;
  assert.equal(code(() => sb.cardFreezeSubmit(cfm, 'IDEM-FZ-01', draft.payload)), 'REAUTH_REQUIRED');
  assert.equal(sb.card.status, 'ACTIVE');
});

test('T14 temporary freeze returns a simulated receipt, not a loss report', () => {
  const sb = new DemoSandbox().reset('cards');
  sb.anomalyReview(); sb.anomalyAnswer('NOT_ME');
  const draft = sb.cardFreezePrepare();
  const cfm = sb.confirm(draft.draft_id, { type: 'manual_click' }).data.confirmation_id!;
  sb.reauthVerify(cfm);
  const r = sb.cardFreezeSubmit(cfm, 'IDEM-FZ-01', draft.payload);
  assert.equal(r.capability, 'SIMULATED');
  assert.ok(r.order_id);
  assert.equal(sb.card.status, 'FROZEN_SIMULATED');
  assert.equal(draft.payload.kind, 'TEMPORARY_FREEZE');
});

test('T15 payday request yields a plan with every write step waiting', () => {
  const sb = new DemoSandbox().reset('payday');
  const r = sb.paydayPlan();
  assert.equal(r.data.available_fen, 200_000);
  assert.ok(r.data.steps.filter(s => s.kind === 'WRITE').every(s => s.status === 'WAITING'));
  assert.equal(sb.orders.size, 0);
  assert.equal(sb.balance_fen, 800_000);
  const budget = sb.budgetConfirm('家庭聚餐', 40_000);
  assert.equal(budget.status, 'DRAFT_CONFIRMED_UNPAID');
  assert.equal(sb.balance_fen, 800_000, 'a budget is not a payment or a hold');
});

function createRule(sb: DemoSandbox, amount = 40_000) {
  const draft = sb.rulePrepare(amount, 3, 90);
  const cfm = sb.confirm(draft.draft_id, { type: 'manual_click' }).data.confirmation_id!;
  sb.reauthVerify(cfm);
  return { draft, order: sb.ruleCreate(cfm, `IDEM-RULE-${amount}`, draft.payload) };
}

test('T16 goal rule has amount, count, cap and 90 days; creation and first run confirmed separately', () => {
  const sb = new DemoSandbox().reset('payday');
  assert.equal(code(() => sb.rulePrepare(40_000, 3, 91)), 'RULE_TOO_LONG');
  const { draft, order } = createRule(sb);
  assert.equal(draft.payload.cumulative_cap_fen, 120_000);
  assert.equal((draft.payload.expires_at as number) - (draft.payload.starts_at as number), 90 * 86_400_000);
  const rule = sb.rules.get(order.order_id!)!;
  assert.equal(rule.first_run_confirmed, false);
  assert.equal(sb.balance_fen, 800_000);
  const run = sb.firstRunPrepare(rule.rule_id);
  assert.equal(code(() => sb.firstRunSubmit('CFM-0000', 'IDEM-RUN-01', run.payload)), 'CONFIRMATION_NOT_FOUND');
  sb.firstRunSubmit(sb.confirm(run.draft_id, { type: 'manual_click' }).data.confirmation_id!, 'IDEM-RUN-01', run.payload);
  assert.equal(rule.first_run_confirmed, true);
  assert.equal(sb.balance_fen, 760_000);
});

test('T17 changing the rule amount voids the old authorization', () => {
  const sb = new DemoSandbox().reset('payday');
  const { order } = createRule(sb);
  const old = sb.rules.get(order.order_id!)!;
  createRule(sb, 50_000);
  assert.equal(old.status, 'VOID');
  assert.equal(code(() => sb.firstRunPrepare(old.rule_id)), 'RULE_INACTIVE');
});

test('T18 C2 client and R2 product are separate; the match comes from the rule table', () => {
  const sb = new DemoSandbox().reset('payday');
  assert.equal(sb.riskProfile().c_level, 'C2');
  assert.deepEqual(sb.suitabilityMatch('C2', 'R2'), { result: 'MATCH', rule: '模拟机构规则表', c_level: 'C2', r_level: 'R2' });
  assert.equal(sb.suitabilityMatch('C2', 'R3').result, 'NOT_MATCH');
  sb.setClock('2027-11-01T00:00:00+08:00');
  assert.equal(sb.suitabilityMatch('C2', 'R2').result, 'PROFILE_EXPIRED');
});

test('T19 investor education is not a gate: plan preparation needs no course', () => {
  const sb = new DemoSandbox().reset('payday');
  assert.doesNotThrow(() => sb.investPrepare(20_000, 3, 90));
});

test('T20 the investment plan is accepted with shares pending and no returns', () => {
  const sb = new DemoSandbox().reset('payday');
  const draft = sb.investPrepare(20_000, 3, 90);
  assert.equal(draft.payload.cumulative_cap_fen, 60_000);
  const cfm = sb.confirm(draft.draft_id, { type: 'manual_click' }).data.confirmation_id!;
  sb.reauthVerify(cfm);
  const r = sb.investSubmit(cfm, 'IDEM-INV-01', draft.payload);
  assert.equal(r.status, 'ACCEPTED_SHARES_PENDING');
  assert.doesNotMatch(JSON.stringify(r), /收益|profit|shares":\d/);
});

test('T21 injected remark: no tool call, no order, balance unchanged', () => {
  const sb = new DemoSandbox().reset('security');
  const contact = sb.injectedContact();
  const r = sb.ingestUntrusted({ name: contact.name, note: contact.note });
  assert.deepEqual(r.data.injection_flags, ['note']);
  assert.equal(r.data.write_tool_calls, 0);
  assert.equal(r.data.orders, 0);
  assert.equal(sb.balance_fen, 114_000);
  assert.ok(!sb.audit.some(a => a.tool_name?.endsWith('.submit')));
});

test('T22 replaying an old confirmation after the amount changes is rejected', () => {
  const sb = new DemoSandbox().reset('security');
  const { draft, cfm } = transferToBadminton(sb);
  const changed = { ...draft.payload, amount_fen: 99_900 };
  assert.equal(code(() => sb.transferSubmit(cfm, 'IDEM-TR-02', changed)), 'CONFIRMATION_MISMATCH');
  assert.equal(sb.orders.size, 0);
});

test('T23 timeout: look up the original order; resubmitting the same key adds nothing', () => {
  const sb = new DemoSandbox().reset('security');
  sb.setNetwork('timeout');
  const { draft, cfm } = transferToBadminton(sb);
  const r = sb.transferSubmit(cfm, 'IDEM-TR-03', draft.payload);
  assert.equal(r.status, 'RESULT_UNKNOWN');
  assert.deepEqual(r.next_actions, ['回查原订单']);
  const looked = sb.orderGet(r.order_id!);
  assert.equal(looked.order_id, r.order_id);
  sb.transferSubmit(cfm, 'IDEM-TR-03', draft.payload);
  assert.equal(sb.orders.size, 1);
  assert.equal(sb.balance_fen, 102_000);
});

test('T24 growth only takes whitelisted learning events, never trading data', () => {
  const sb = new DemoSandbox().reset('payday');
  assert.equal(code(() => sb.recordGrowth('invest_submitted')), 'GROWTH_EVENT_REJECTED');
  assert.equal(code(() => sb.recordGrowth('risk_and_fee_explained_by_user', { transaction_amount: 20_000 })), 'GROWTH_FIELD_FORBIDDEN');
  const milestones = sb.recordGrowth('risk_and_fee_explained_by_user');
  assert.deepEqual(milestones.filter(m => m.earned).map(m => m.label), ['懂风险']);
});

test('resetDemo reproduces the same results on every take', () => {
  const take = () => {
    const sb = new DemoSandbox().reset('transfer');
    const { draft, cfm } = transferToBadminton(sb);
    sb.transferSubmit(cfm, 'IDEM-TR-01', draft.payload);
    return JSON.stringify({ audit: sb.audit, balance: sb.balance_fen, orders: [...sb.orders.values()] });
  };
  assert.equal(take(), take());
  assert.equal(take(), take());
});
