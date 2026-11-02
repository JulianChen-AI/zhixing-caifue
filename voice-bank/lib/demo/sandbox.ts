// Deterministic sandbox behind the demo video. The model layer may only propose drafts;
// every amount, permission, confirmation and order status is decided here.
import { canonicalJson, sha256Hex } from './sha256.ts';
import {
  AA_NEXT_DAY_PAYMENTS, ANOMALY_TX, BILL_SCOPE, BILL_TXS, CARD, CARD_HISTORY, CONTACTS, DINNER_MEMBERS,
  INJECTED_CONTACT, PAYDAY, PRODUCT, RISK_PROFILE, SUBSCRIPTIONS, SUITABILITY_TABLE, TRANSFER_OPENING_BALANCE_FEN,
  USER, type Contact, type Tx,
} from './fixtures.ts';

export type Capability = 'SIMULATED';
export type Envelope<T = unknown> = {
  capability: Capability; request_id: string; order_id: string | null; status: string;
  facts: string[]; inferences: string[]; missing_data: string[]; next_actions: string[]; data: T;
};
export type ConfirmEvent = { type: 'manual_click' | 'voice' | 'text'; text?: string };
export type Operation = 'transfer' | 'aa_create' | 'aa_remind' | 'subscription_release' | 'card_freeze' | 'rule_create' | 'rule_first_run' | 'invest_plan' | 'budget_draft';

export class SandboxError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

type Draft = { draft_id: string; op: Operation; version: number; payload: Record<string, unknown>; payload_hash: string; void: boolean; reauth_required: boolean };
type Confirmation = { confirmation_id: string; op: Operation; user_id: string; payload_hash: string; method: 'manual_click'; expires_at: number; reauth: 'NOT_REQUIRED' | 'PENDING' | 'OK'; used: boolean };
export type Order = { order_id: string; op: Operation; idempotency_key: string; payload_hash: string; amount_fen: number; status: string; created_at: number };
export type AuditEntry = {
  seq: number; scene_id: string; event: string; tool_name?: string; payload_hash?: string; confirmation_id?: string;
  confirmation_method?: string; reauth_result?: string; order_id?: string; idempotency_key?: string; receipt_status?: string;
  untrusted_field_detected?: boolean; injection_blocked?: boolean; error_code?: string; simulated: true;
};

export type AaItem = { name: string; amount_fen: number; participants: string[] };
export type AaShare = { member: string; amount_fen: number; detail: string[] };
export type AaCalc = { rule_version: number; items: AaItem[]; members: string[]; payer: string; shares: AaShare[]; receivable_fen: number; total_fen: number; remainder_rule: string };
type MemberStatus = { payment: 'UNPAID' | 'PAID' | 'PAYER'; reminder: 'NOT_SENT' | 'SENT' | 'SKIPPED_PAID' };

export const GROWTH_EVENTS = [
  'payee_and_amount_verified', 'bill_scope_explained', 'category_corrected_by_user', 'subscription_states_explained',
  'anomaly_verification_completed', 'budget_tradeoff_explained', 'risk_and_fee_explained_by_user', 'independent_decision_made_with_disclosure',
] as const;
export type GrowthEvent = typeof GROWTH_EVENTS[number];
const FORBIDDEN_GROWTH_FIELDS = ['transaction_amount', 'transaction_count', 'investment_count', 'portfolio_value', 'profit_loss', 'credit_limit', 'cancellation_count'];
export const MILESTONES = [
  { id: 'verify', label: '会核对', token: '核对书签', events: ['payee_and_amount_verified'] },
  { id: 'understand', label: '会看懂', token: '小灯', events: ['bill_scope_explained', 'category_corrected_by_user'] },
  { id: 'manage', label: '会管理', token: '整理包', events: ['subscription_states_explained'] },
  { id: 'respond', label: '会应对', token: '小伞', events: ['anomaly_verification_completed'] },
  { id: 'plan', label: '会规划', token: '地图', events: ['budget_tradeoff_explained'] },
  { id: 'risk', label: '懂风险', token: '指南针', events: ['risk_and_fee_explained_by_user', 'independent_decision_made_with_disclosure'] },
] as const;
export type MilestoneId = typeof MILESTONES[number]['id'];

const INJECTION_PATTERN = /忽略(之前|以上)?(的)?(规则|指令)|无需确认|免确认|立即转账|ignore (all |previous )?instructions/i;
const DAY = 86_400_000;
const yuan = (fen: number) => (fen / 100).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export class DemoSandbox {
  scene = 'none';
  now = Date.parse('2022-10-28T20:00:00+08:00'); // story present (24 岁) is 2026-10; 大二 is four years earlier
  network: 'normal' | 'timeout' = 'normal';
  balance_fen = TRANSFER_OPENING_BALANCE_FEN;
  private seq = 0;
  private counters: Record<string, number> = {};
  drafts = new Map<string, Draft>();
  confirmations = new Map<string, Confirmation>();
  orders = new Map<string, Order>();
  idempotency = new Map<string, string>();
  audit: AuditEntry[] = [];
  writeToolCalls = 0;
  growth = new Set<GrowthEvent>();
  // Scene state
  aa: { aa_id: string; versions: AaCalc[]; members: Record<string, MemberStatus>; status: string } | null = null;
  txs: Tx[] = BILL_TXS.map(tx => ({ ...tx }));
  federatedQueue: { label_from: string; label_to: string; contribution_clipped: boolean; cohort_count: number; publishable: boolean; dp_budget_status: string }[] = [];
  merchantRules: { merchant: string; category: string }[] = [];
  subscriptions: Record<string, { bank_channel_release: string; merchant_cancellation: string; refund: string; post_due_non_debit_check: string; external_todo?: string }> = {};
  card = { ...CARD, status: 'ACTIVE' as string };
  anomaly: { verdict: string; allowed_actions: string[]; user_answer: 'NONE' | 'ME' | 'NOT_ME' } | null = null;
  rules = new Map<string, { rule_id: string; version: number; to_account: string; amount_fen: number; max_executions: number; cumulative_cap_fen: number; starts_at: number; expires_at: number; status: string; first_run_confirmed: boolean; executions: number }>();
  budgets: { name: string; amount_fen: number; status: string }[] = [];
  billSync: { label: string; kind: string; status: string }[] = [];

  /** resetDemo(): every scene starts from the same fixture so takes are reproducible. */
  reset(scene: string) {
    const fresh = new DemoSandbox();
    Object.assign(this, fresh);
    this.scene = scene;
    if (scene === 'payday') { this.balance_fen = PAYDAY.salary_fen; this.now = Date.parse('2026-10-28T09:00:00+08:00'); }
    if (scene === 'cards') this.now = Date.parse('2023-03-14T23:48:00+08:00');
    for (const sub of SUBSCRIPTIONS) this.subscriptions[sub.subscription_id] = { bank_channel_release: 'ACTIVE', merchant_cancellation: 'UNCONFIRMED', refund: 'NOT_REQUESTED', post_due_non_debit_check: 'NOT_STARTED' };
    return this;
  }

  private id(prefix: string) { this.counters[prefix] = (this.counters[prefix] || 0) + 1; return `${prefix}-${String(this.counters[prefix]).padStart(4, '0')}`; }
  private log(entry: Omit<AuditEntry, 'seq' | 'scene_id' | 'simulated'>) { this.audit.push({ seq: ++this.seq, scene_id: this.scene, simulated: true, ...entry }); }
  private envelope<T>(status: string, data: T, extra: Partial<Envelope<T>> = {}): Envelope<T> {
    return { capability: 'SIMULATED', request_id: this.id('REQ'), order_id: null, status, facts: [], inferences: [], missing_data: [], next_actions: [], data, ...extra };
  }

  // ---------- Contacts and untrusted text ----------
  contactSearch(name: string) {
    const candidates = CONTACTS.filter(c => c.name === name).map(c => ({ ...c }));
    this.log({ event: 'read', tool_name: 'contact.search' });
    // Several matches must be chosen by the user: nothing is preselected.
    return this.envelope(candidates.length > 1 ? 'NEEDS_PAYEE_DISAMBIGUATION' : candidates.length ? 'READY' : 'NOT_FOUND',
      { candidates, selected: null as string | null }, { next_actions: candidates.length > 1 ? ['请选择收款人'] : [] });
  }

  /** Free text from contacts, merchants, SMS or OCR is data. It can be shown and checked, never executed. */
  ingestUntrusted(fields: Record<string, string>) {
    const flagged = Object.entries(fields).filter(([, value]) => INJECTION_PATTERN.test(value)).map(([key]) => key);
    this.log({ event: 'draft_check', untrusted_field_detected: true, injection_blocked: flagged.length > 0 });
    return this.envelope('DATA_ONLY', { untrusted_fields: Object.keys(fields), injection_flags: flagged, write_tool_calls: this.writeToolCalls, orders: this.orders.size, balance_fen: this.balance_fen });
  }
  injectedContact(): Contact { return { ...INJECTED_CONTACT }; }

  // ---------- Generic draft → confirmation → submit gate ----------
  prepare(op: Operation, payload: Record<string, unknown>, opts: { reauth?: boolean } = {}) {
    for (const draft of this.drafts.values()) if (draft.op === op && !draft.void) draft.void = true;
    const version = [...this.drafts.values()].filter(d => d.op === op).length + 1;
    const draft: Draft = { draft_id: this.id('DRAFT'), op, version, payload: structuredClone(payload), payload_hash: sha256Hex(canonicalJson({ op, user: USER.user_id, payload })), void: false, reauth_required: !!opts.reauth };
    this.drafts.set(draft.draft_id, draft);
    this.log({ event: 'prepare', tool_name: `${op}.prepare`, payload_hash: draft.payload_hash });
    return draft;
  }

  /** Only a click on the confirmation sheet produces a confirmation; speech and chat text stay intents. */
  confirm(draft_id: string, event: ConfirmEvent) {
    const draft = this.drafts.get(draft_id);
    if (!draft || draft.void) throw new SandboxError('DRAFT_VOID', '草稿已作废，请按最新内容重新确认');
    if (event.type !== 'manual_click') {
      this.log({ event: 'intent_only', confirmation_method: event.type, payload_hash: draft.payload_hash });
      return this.envelope('READY_FOR_CONFIRMATION', { confirmation_id: null, notice: '语音或文字“确认”不构成支付授权，请在确认页手动确认' });
    }
    const confirmation: Confirmation = {
      confirmation_id: this.id('CFM'), op: draft.op, user_id: USER.user_id, payload_hash: draft.payload_hash, method: 'manual_click',
      expires_at: this.now + 5 * 60_000, reauth: draft.reauth_required ? 'PENDING' : 'NOT_REQUIRED', used: false,
    };
    this.confirmations.set(confirmation.confirmation_id, confirmation);
    this.log({ event: 'confirmation.create', confirmation_id: confirmation.confirmation_id, confirmation_method: 'manual_click', payload_hash: draft.payload_hash });
    return this.envelope(confirmation.reauth === 'PENDING' ? 'AUTHENTICATING' : 'CONFIRMED', { confirmation_id: confirmation.confirmation_id });
  }

  /** Simulated authentication; no secret is collected or logged. */
  reauthVerify(confirmation_id: string) {
    const confirmation = this.confirmations.get(confirmation_id);
    if (!confirmation) throw new SandboxError('CONFIRMATION_NOT_FOUND', '确认凭证不存在');
    confirmation.reauth = 'OK';
    this.log({ event: 'reauth.verify', confirmation_id, reauth_result: 'OK_SIMULATED' });
    return this.envelope('CONFIRMED', { confirmation_id });
  }

  private checkConfirmation(op: Operation, confirmation_id: string, payload: Record<string, unknown>) {
    const confirmation = this.confirmations.get(confirmation_id);
    const hash = sha256Hex(canonicalJson({ op, user: USER.user_id, payload }));
    const fail = (code: string, message: string): never => { this.log({ event: 'rejected', tool_name: `${op}.submit`, confirmation_id, payload_hash: hash, error_code: code }); throw new SandboxError(code, message); };
    if (!confirmation || confirmation.op !== op) fail('CONFIRMATION_NOT_FOUND', '没有对应的手动确认');
    if (confirmation!.payload_hash !== hash) fail('CONFIRMATION_MISMATCH', '内容已改变，旧确认失效');
    if (confirmation!.expires_at < this.now) fail('CONFIRMATION_EXPIRED', '确认已过期');
    if (confirmation!.reauth === 'PENDING') fail('REAUTH_REQUIRED', '尚未完成认证');
    return { confirmation: confirmation!, hash };
  }

  /** Writes are idempotent by key; a timeout leaves the original order to be looked up, never resubmitted. */
  submit(op: Operation, confirmation_id: string, idempotency_key: string, payload: Record<string, unknown>, apply: (order: Order) => void) {
    const { confirmation, hash } = this.checkConfirmation(op, confirmation_id, payload);
    const existing = this.idempotency.get(idempotency_key);
    if (existing) {
      const order = this.orders.get(existing)!;
      this.log({ event: 'idempotent_replay', tool_name: `${op}.submit`, order_id: order.order_id, idempotency_key, receipt_status: order.status });
      return this.envelope(order.status, { order }, { order_id: order.order_id });
    }
    if (confirmation.used) {
      this.log({ event: 'rejected', tool_name: `${op}.submit`, confirmation_id, error_code: 'CONFIRMATION_USED' });
      throw new SandboxError('CONFIRMATION_USED', '该确认已使用');
    }
    const order: Order = { order_id: this.id('ORD'), op, idempotency_key, payload_hash: hash, amount_fen: Number(payload.amount_fen) || 0, status: 'SUCCESS', created_at: this.now };
    apply(order); // a rule violation throws here, before any order or confirmation use is recorded
    confirmation.used = true;
    this.writeToolCalls++;
    this.orders.set(order.order_id, order);
    this.idempotency.set(idempotency_key, order.order_id);
    const visible = this.network === 'timeout' ? 'RESULT_UNKNOWN' : order.status;
    this.log({ event: 'submit', tool_name: `${op}.submit`, confirmation_id, confirmation_method: confirmation.method, payload_hash: hash, order_id: order.order_id, idempotency_key, receipt_status: visible });
    return this.envelope(visible, { order: { ...order, status: visible } }, { order_id: order.order_id, next_actions: visible === 'RESULT_UNKNOWN' ? ['回查原订单'] : [] });
  }

  orderGet(order_id: string) {
    const order = this.orders.get(order_id);
    if (!order) throw new SandboxError('ORDER_NOT_FOUND', '订单不存在');
    this.log({ event: 'read', tool_name: 'order.get', order_id, receipt_status: order.status });
    return this.envelope(order.status, { order: { ...order } }, { order_id });
  }

  setNetwork(mode: 'normal' | 'timeout') { this.network = mode; }
  setClock(iso: string) { this.now = Date.parse(iso); }

  // ---------- Transfer ----------
  transferPrepare(contact_id: string, amount_fen: number, purpose: string) {
    const contact = CONTACTS.find(c => c.contact_id === contact_id) || (contact_id === INJECTED_CONTACT.contact_id ? INJECTED_CONTACT : undefined);
    if (!contact) throw new SandboxError('PAYEE_NOT_FOUND', '收款人不存在');
    if (!Number.isInteger(amount_fen) || amount_fen <= 0) throw new SandboxError('AMOUNT_INVALID', '金额必须为正整数分');
    if (amount_fen > this.balance_fen) throw new SandboxError('INSUFFICIENT_FUNDS', '余额不足');
    return this.prepare('transfer', { to: contact.contact_id, to_tail: contact.account_tail, amount_fen, purpose }, { reauth: true });
  }
  transferSubmit(confirmation_id: string, idempotency_key: string, payload: Record<string, unknown>) {
    return this.submit('transfer', confirmation_id, idempotency_key, payload, order => { this.balance_fen -= order.amount_fen; });
  }

  // ---------- AA ----------
  aaCalculate(rule_version: number, items: AaItem[], members: string[], payer: string): AaCalc {
    const totals = new Map(members.map(m => [m, { amount: 0, detail: [] as string[] }]));
    for (const item of items) {
      const each = Math.floor(item.amount_fen / item.participants.length);
      let remainder = item.amount_fen - each * item.participants.length;
      for (const person of item.participants) {
        const share = each + (remainder > 0 ? 1 : 0);
        if (remainder > 0) remainder--;
        const entry = totals.get(person);
        if (!entry) throw new SandboxError('MEMBER_UNKNOWN', `${person} 不在名单`);
        entry.amount += share;
        entry.detail.push(`${item.name}${yuan(share)}`);
      }
    }
    const shares = members.map(member => ({ member, amount_fen: totals.get(member)!.amount, detail: totals.get(member)!.detail }));
    const total_fen = items.reduce((s, i) => s + i.amount_fen, 0);
    const sum = shares.reduce((s, x) => s + x.amount_fen, 0);
    if (sum !== total_fen) throw new SandboxError('AA_SUM_MISMATCH', '分摊合计与总额不一致');
    const receivable_fen = total_fen - (shares.find(s => s.member === payer)?.amount_fen || 0);
    return { rule_version, items, members, payer, shares, receivable_fen, total_fen, remainder_rule: '不能整除时，余数按名单顺序逐分分配' };
  }
  aaDraft(calc: AaCalc) {
    if (!this.aa) this.aa = { aa_id: this.id('AA'), versions: [], members: {}, status: 'AA_DRAFT' };
    this.aa.versions.push(calc);
    this.aa.status = this.aa.versions.length > 1 ? 'RECALCULATED' : 'AA_DRAFT';
    this.log({ event: 'aa.calculate', tool_name: 'aa.calculate' });
    return this.prepare('aa_create', { aa_id: this.aa.aa_id, rule_version: calc.rule_version, shares: calc.shares.map(s => [s.member, s.amount_fen]) });
  }
  aaCreate(confirmation_id: string, idempotency_key: string, payload: Record<string, unknown>) {
    return this.submit('aa_create', confirmation_id, idempotency_key, payload, () => {
      const calc = this.aa!.versions.at(-1)!;
      this.aa!.members = Object.fromEntries(calc.members.map(m => [m, { payment: m === calc.payer ? 'PAYER' : 'UNPAID', reminder: 'NOT_SENT' } as MemberStatus]));
      this.aa!.status = 'COLLECTING';
    });
  }
  /** 模拟次日: apply the synthetic payment records. */
  aaSimulateNextDay() {
    this.now += DAY;
    for (const name of AA_NEXT_DAY_PAYMENTS) if (this.aa?.members[name]) this.aa.members[name].payment = 'PAID';
    this.aaRefreshStatus();
    this.log({ event: 'aa.payment_callback', tool_name: 'aa.status' });
  }
  aaMarkPaid(name: string) { if (this.aa?.members[name]) { this.aa.members[name].payment = 'PAID'; this.aaRefreshStatus(); } }
  private aaRefreshStatus() {
    const people = Object.values(this.aa!.members).filter(m => m.payment !== 'PAYER');
    this.aa!.status = people.every(m => m.payment === 'PAID') ? 'SETTLED' : people.some(m => m.payment === 'PAID') ? 'PARTIALLY_RECEIVED' : 'COLLECTING';
  }
  aaStatus() {
    const calc = this.aa!.versions.at(-1)!;
    const amount = (name: string) => calc.shares.find(s => s.member === name)!.amount_fen;
    const entries = Object.entries(this.aa!.members).filter(([, s]) => s.payment !== 'PAYER');
    const received_fen = entries.filter(([, s]) => s.payment === 'PAID').reduce((sum, [n]) => sum + amount(n), 0);
    const pending = entries.filter(([, s]) => s.payment === 'UNPAID').map(([n]) => n);
    const pending_fen = pending.reduce((sum, n) => sum + amount(n), 0);
    if (received_fen + pending_fen !== calc.receivable_fen) throw new SandboxError('AA_STATUS_MISMATCH', '已收与待收之和不等于应收');
    return { status: this.aa!.status, received_fen, pending_fen, pending, members: this.aa!.members };
  }
  aaRemindPrepare() {
    const { pending } = this.aaStatus();
    return this.prepare('aa_remind', { aa_id: this.aa!.aa_id, members: pending });
  }
  /** Re-checks payment right before sending: whoever has paid is skipped. */
  aaRemind(confirmation_id: string, idempotency_key: string, payload: Record<string, unknown>) {
    return this.submit('aa_remind', confirmation_id, idempotency_key, payload, () => {
      for (const name of payload.members as string[]) {
        const member = this.aa!.members[name];
        member.reminder = member.payment === 'PAID' ? 'SKIPPED_PAID' : 'SENT';
      }
    });
  }

  // ---------- Bills ----------
  billSummary() {
    const coffeeThis = this.txs.filter(t => t.month === 'this' && t.category === '咖啡类');
    const coffeeLast = this.txs.filter(t => t.month === 'last' && t.category === '咖啡类');
    const amount_fen = coffeeThis.reduce((s, t) => s + t.amount_fen, 0);
    this.log({ event: 'read', tool_name: 'bill.summary' });
    return this.envelope('DONE', {
      scope: BILL_SCOPE,
      coffee: { amount_fen, count: coffeeThis.length, mom_count_delta: coffeeThis.length - coffeeLast.length, label: '推断' },
      fact: `沙箱账户中该月有 ${coffeeThis.length} 笔、合计 ${yuan(amount_fen)} 元的相关交易`,
      inference: '商户映射推断为咖啡类，不代表实际商品或杯数',
      suggestion: '可查看明细、纠正分类或补充小票',
    }, { missing_data: BILL_SCOPE.excluded });
  }
  /** Corrects one transaction by default; only an explicit merchant rule touches others. */
  billCorrect(tx_id: string, category: string, scope: 'SINGLE' | 'MERCHANT_RULE' = 'SINGLE') {
    const tx = this.txs.find(t => t.tx_id === tx_id);
    if (!tx) throw new SandboxError('TX_NOT_FOUND', '交易不存在');
    const from = tx.category;
    tx.category = category; tx.inferred = false;
    if (scope === 'MERCHANT_RULE') this.merchantRules.push({ merchant: tx.merchant, category });
    // Only the label pair may enter the aggregation candidate queue; raw text, amount and time stay local.
    this.federatedQueue.push({ label_from: from, label_to: category, contribution_clipped: true, cohort_count: 1, publishable: false, dp_budget_status: 'NOT_GRANTED_DEMO' });
    this.log({ event: 'bill.correct', tool_name: 'bill.correct' });
    return this.envelope('DONE', { tx: { ...tx }, from, scope });
  }
  federatedStatus() {
    const k = this.federatedQueue.length, dpBudgetGranted = false;
    // k ≥ 20 is only a floor; nothing is published without a granted privacy budget as well.
    return { k, threshold: 20, publishable: k >= 20 && dpBudgetGranted, dp_budget_status: 'NOT_GRANTED_DEMO', queue: this.federatedQueue.map(q => ({ ...q })) };
  }

  // ---------- Subscriptions ----------
  subscriptionPlan(subscription_id: string) {
    const sub = SUBSCRIPTIONS.find(s => s.subscription_id === subscription_id)!;
    if (sub.channel === 'EXTERNAL') {
      this.subscriptions[subscription_id].external_todo = '前往官方通道';
      return this.envelope('EXTERNAL_ONLY', { path: '前往服务商官方通道处理', bank_can_release: false });
    }
    return { envelope: this.envelope('READY_FOR_CONFIRMATION', { path: '银行代扣通道解约', bank_can_release: true }), draft: this.prepare('subscription_release', { subscription_id, channel: sub.channel, amount_fen: 0 }) };
  }
  subscriptionReleaseBank(confirmation_id: string, idempotency_key: string, payload: Record<string, unknown>) {
    return this.submit('subscription_release', confirmation_id, idempotency_key, payload, () => {
      const state = this.subscriptions[payload.subscription_id as string];
      state.bank_channel_release = 'RELEASED_SIMULATED';
      state.post_due_non_debit_check = 'PENDING';
    });
  }
  /** The non-debit check passes only with an actual record after the original due date. */
  subscriptionVerifyNonDebit(subscription_id: string, observedNoDebitAfterDue: boolean) {
    const state = this.subscriptions[subscription_id];
    if (observedNoDebitAfterDue && state.bank_channel_release === 'RELEASED_SIMULATED') state.post_due_non_debit_check = 'VERIFIED_NOT_DEBITED';
    return { ...state };
  }

  // ---------- Card anomaly ----------
  anomalyReview() {
    const tx = ANOMALY_TX;
    const reviews = {
      data_review: { role: '数据审查', facts: [tx.time, tx.city, `${yuan(tx.amount_fen)}元`, '首次商户'], position: '有交易记录' },
      pattern_review: { role: '行为审查', inference: `异地（常用城市${CARD_HISTORY.usual_city}）、首次商户，与历史模式不同`, position: '需要核实' },
      policy_review: { role: '合规审查', rule: '证据不足不得定性盗刷或自动锁卡', position: '等待用户' },
    };
    // Deterministic arbiter: no vote of the reviewers can trigger a freeze or payment.
    this.anomaly = { verdict: 'NEEDS_USER_VERIFICATION', allowed_actions: ['查看明细', '是我本人', '不是我', '联系官方'], user_answer: 'NONE' };
    this.log({ event: 'read', tool_name: 'anomaly.review' });
    return this.envelope('NEEDS_USER_VERIFICATION', { tx, reviews, ...this.anomaly });
  }
  anomalyAnswer(answer: 'ME' | 'NOT_ME') {
    if (!this.anomaly) throw new SandboxError('NO_ANOMALY', '没有待核实交易');
    this.anomaly.user_answer = answer;
    if (answer === 'NOT_ME' && !this.anomaly.allowed_actions.includes('进入临时冻结确认页')) this.anomaly.allowed_actions.push('进入临时冻结确认页');
    return { ...this.anomaly };
  }
  cardFreezePrepare() {
    if (this.anomaly?.user_answer !== 'NOT_ME') throw new SandboxError('NOT_ALLOWED', '用户未表示非本人操作，不进入冻结');
    return this.prepare('card_freeze', { card_id: this.card.card_id, tail: this.card.tail, kind: 'TEMPORARY_FREEZE' }, { reauth: true });
  }
  cardFreezeSubmit(confirmation_id: string, idempotency_key: string, payload: Record<string, unknown>) {
    return this.submit('card_freeze', confirmation_id, idempotency_key, payload, () => { this.card.status = 'FROZEN_SIMULATED'; });
  }

  // ---------- Payday ----------
  paydayPlan() {
    const available_fen = PAYDAY.salary_fen - PAYDAY.rent_fen - PAYDAY.living_fen - PAYDAY.reserve_fen;
    this.log({ event: 'read', tool_name: 'payday.plan' });
    return this.envelope('PLANNED', {
      trigger: { type: 'SALARY_CREDIT_CONFIRMED', amount_fen: PAYDAY.salary_fen },
      basis: [
        { label: '房租', amount_fen: PAYDAY.rent_fen, source: '用户登记' },
        { label: '日常生活预算', amount_fen: PAYDAY.living_fen, source: '用户登记' },
        { label: '保留金', amount_fen: PAYDAY.reserve_fen, source: '已有规则' },
      ],
      available_fen,
      steps: [
        { step_id: 'SCOPE', kind: 'READ', status: 'DONE' }, { step_id: 'BUDGET', kind: 'BUDGET_DRAFT', status: 'READY_FOR_CONFIRMATION' },
        { step_id: 'GOAL_RULE', kind: 'WRITE', status: 'WAITING' }, { step_id: 'GOAL_FIRST_RUN', kind: 'WRITE', status: 'WAITING' },
        { step_id: 'INVEST', kind: 'WRITE', status: 'WAITING' }, { step_id: 'BILL_SYNC', kind: 'READ', status: 'WAITING' },
      ],
    }, { facts: ['工资到账 8,000 元（沙箱已入账）'], next_actions: ['逐项确认'] });
  }
  /** A budget is a plan only: no payment and no hold on funds. */
  budgetConfirm(name: string, amount_fen: number) {
    this.budgets.push({ name, amount_fen, status: 'DRAFT_CONFIRMED_UNPAID' });
    this.log({ event: 'budget.confirm', tool_name: 'budget.draft' });
    return { name, amount_fen, status: 'DRAFT_CONFIRMED_UNPAID', balance_fen: this.balance_fen };
  }
  rulePrepare(amount_fen: number, max_executions: number, days: number) {
    if (days > 90) throw new SandboxError('RULE_TOO_LONG', '周期授权最长 90 天');
    if (!Number.isInteger(amount_fen) || amount_fen <= 0 || max_executions < 1) throw new SandboxError('RULE_INVALID', '规则参数无效');
    return this.prepare('rule_create', {
      to_account: PAYDAY.goal_account.account_id, amount_fen, max_executions, cumulative_cap_fen: amount_fen * max_executions,
      starts_at: this.now, expires_at: this.now + days * DAY,
    }, { reauth: true });
  }
  ruleCreate(confirmation_id: string, idempotency_key: string, payload: Record<string, unknown>) {
    return this.submit('rule_create', confirmation_id, idempotency_key, { ...payload }, order => {
      if ((payload.expires_at as number) - (payload.starts_at as number) > 90 * DAY) throw new SandboxError('RULE_TOO_LONG', '周期授权最长 90 天');
      for (const old of this.rules.values()) if (old.to_account === payload.to_account && old.status === 'ACTIVE') old.status = 'VOID';
      this.rules.set(order.order_id, {
        rule_id: order.order_id, version: this.rules.size + 1, to_account: payload.to_account as string, amount_fen: payload.amount_fen as number,
        max_executions: payload.max_executions as number, cumulative_cap_fen: payload.cumulative_cap_fen as number,
        starts_at: payload.starts_at as number, expires_at: payload.expires_at as number, status: 'ACTIVE', first_run_confirmed: false, executions: 0,
      });
      order.amount_fen = 0; // creating the rule moves no money
    });
  }
  firstRunPrepare(rule_id: string) {
    const rule = this.rules.get(rule_id);
    if (!rule || rule.status !== 'ACTIVE') throw new SandboxError('RULE_INACTIVE', '规则已失效，需要重新创建');
    return this.prepare('rule_first_run', { rule_id, amount_fen: rule.amount_fen, run: 1 });
  }
  firstRunSubmit(confirmation_id: string, idempotency_key: string, payload: Record<string, unknown>) {
    return this.submit('rule_first_run', confirmation_id, idempotency_key, payload, order => {
      const rule = this.rules.get(payload.rule_id as string)!;
      if (rule.executions + 1 > rule.max_executions || (rule.executions + 1) * rule.amount_fen > rule.cumulative_cap_fen) throw new SandboxError('RULE_CAP', '超过次数或累计上限');
      if (this.balance_fen < order.amount_fen) { order.status = 'FAILED'; return; }
      rule.first_run_confirmed = true; rule.executions++;
      this.balance_fen -= order.amount_fen;
    });
  }
  riskProfile() { this.log({ event: 'read', tool_name: 'risk.profile' }); return { ...RISK_PROFILE }; }
  suitabilityMatch(c_level: string, r_level: string) {
    const valid = Date.parse(`${RISK_PROFILE.valid_until}T00:00:00+08:00`) > this.now;
    const allowed = valid && (SUITABILITY_TABLE[c_level] || []).includes(r_level);
    this.log({ event: 'read', tool_name: 'suitability.match' });
    return { result: allowed ? 'MATCH' : valid ? 'NOT_MATCH' : 'PROFILE_EXPIRED', rule: '模拟机构规则表', c_level, r_level };
  }
  investPrepare(amount_fen: number, times: number, days: number) {
    const match = this.suitabilityMatch(RISK_PROFILE.c_level, PRODUCT.risk_level);
    if (match.result !== 'MATCH') throw new SandboxError(match.result, '适当性不匹配，停止新申购');
    if (days > 90) throw new SandboxError('RULE_TOO_LONG', '周期授权最长 90 天');
    return this.prepare('invest_plan', { product_id: PRODUCT.product_id, amount_fen, times, cumulative_cap_fen: amount_fen * times, days }, { reauth: true });
  }
  investSubmit(confirmation_id: string, idempotency_key: string, payload: Record<string, unknown>) {
    return this.submit('invest_plan', confirmation_id, idempotency_key, payload, order => {
      order.status = 'ACCEPTED_SHARES_PENDING'; // 受理 ≠ 成交: no shares or returns are shown
      this.balance_fen -= order.amount_fen;
    });
  }
  billSyncPayday() {
    this.billSync = [];
    for (const b of this.budgets) this.billSync.push({ label: `${b.name}预算`, kind: '预算安排，不记消费、不冻结', status: '草稿已确认，未付款' });
    for (const order of this.orders.values()) {
      if (order.op === 'rule_first_run') this.billSync.push({ label: '目标储蓄首跑', kind: '本人同名内部划转，不记消费', status: order.status === 'SUCCESS' ? '模拟回执：已划转' : '结果待回查' });
      if (order.op === 'invest_plan') this.billSync.push({ label: '定投首期', kind: '订单状态与资金占用', status: '申请已受理，份额待确认' });
    }
    this.log({ event: 'read', tool_name: 'bill.sync' });
    return [...this.billSync];
  }

  // ---------- Growth ----------
  /** Growth accepts only whitelisted learning/decision events; trading data is rejected outright. */
  recordGrowth(event: string, fields: Record<string, unknown> = {}) {
    if (!(GROWTH_EVENTS as readonly string[]).includes(event)) throw new SandboxError('GROWTH_EVENT_REJECTED', '非白名单成长事件');
    const forbidden = Object.keys(fields).filter(k => FORBIDDEN_GROWTH_FIELDS.includes(k));
    if (forbidden.length) throw new SandboxError('GROWTH_FIELD_FORBIDDEN', `成长服务不接收：${forbidden.join(',')}`);
    this.growth.add(event as GrowthEvent);
    return this.milestones();
  }
  milestones() { return MILESTONES.map(m => ({ id: m.id, label: m.label, token: m.token, earned: m.events.some(e => this.growth.has(e as GrowthEvent)) })); }
  ordersOf(op: Operation) { return [...this.orders.values()].filter(o => o.op === op); }
}

export { yuan, DINNER_MEMBERS };
