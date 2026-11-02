// Replays the compiled demo script into a view at any time t. Clicks go through the same
// handlers a viewer's clicks would; every money decision is made by the DemoSandbox.
import { DINNER_MEMBERS, PAYDAY } from './fixtures.ts';
import { parseAa, parseGoalRule, parseInvestLearn, parsePayday, parseTransfer, type AaDraft } from './intent.ts';
import { DemoSandbox, MILESTONES, SandboxError, type AaCalc, type Envelope, type MilestoneId, type Order } from './sandbox.ts';
import type { Compiled, SceneId, TimedAct, TimedLine } from './timeline.ts';
import type { MascotAction } from '../mascot/scenario.ts';

export type Msg = { id: string; who: 'user' | 'goose' | 'system'; text: string; at: number; end: number; mode?: 'voice' | 'text'; confidence?: number; tone?: 'notice' | 'ok' };
export type CardKind =
  | 'intro-salary' | 'intro-map' | 'intro-basis'
  | 'tr-candidates' | 'tr-confirm' | 'auth' | 'tr-receipt' | 'aa-calc' | 'aa-status'
  | 'bill-scope' | 'bill-coffee' | 'bill-tx' | 'fed' | 'sub-radar' | 'sub-confirm' | 'sub-status'
  | 'anomaly' | 'freeze-confirm' | 'freeze-receipt'
  | 'pd-map' | 'pd-basis' | 'rule-confirm' | 'rule-receipt' | 'firstrun-confirm' | 'invest' | 'invest-disclosure' | 'invest-receipt'
  | 'sec-1' | 'sec-2' | 'sec-3'
  | 'done';
export type Card = { id: string; kind: CardKind; at: number; collapsed?: number; summary?: string };
export type AuthFor = 'transfer' | 'freeze' | 'rule' | 'invest';
export type StepStatus = { label: string; status: string; tone: 'wait' | 'ok' | 'info' | 'pending' };

export type View = {
  t: number;
  sb: DemoSandbox;
  scene: SceneId;
  lower: { text: string; sub?: string; at: number } | null;
  chat: Msg[];
  cards: Card[];
  flash: Record<string, number>;
  moves: { to: string; at: number; dur: number }[];
  clicks: { target: string; at: number }[];
  highlights: { target: string; at: number; dur: number }[];
  captions: { text: string; at: number; dur: number }[];
  milestones: Partial<Record<MilestoneId, { at: number; basis: string }>>;
  goose: { action: MascotAction; at: number }[];
  overlay: { kind: 'rewind' | 'final'; at: number } | null;
  auditAt: number[];
  errors: string[];
  // Scene data written by handlers
  candidates?: { contact_id: string; relation: string; account_tail: string }[];
  selected?: string;
  transfer?: { draft_id: string; payload: Record<string, unknown>; confirmation_id?: string; order?: Order; balanceBefore: number; voiceNotice?: number; voiceSnapshot?: { orders: number; confirmations: number; balance: number } };
  auth?: { for: AuthFor; confirmation_id: string; at: number };
  aaDrafts?: AaDraft[];
  aaCalcs?: AaCalc[];
  aa?: { draft_id: string; payload: Record<string, unknown>; created?: boolean; nextDay?: boolean; remind?: { draft_id: string; payload: Record<string, unknown>; sent?: boolean } };
  bill?: Envelope<ReturnType<DemoSandbox['billSummary']>['data']>;
  correctOpen?: boolean;
  corrected?: boolean;
  subPaths?: Record<string, 'bank' | 'external'>;
  sub?: { draft_id: string; payload: Record<string, unknown>; order_id?: string };
  anomaly?: ReturnType<DemoSandbox['anomalyReview']>;
  freeze?: { draft_id: string; payload: Record<string, unknown>; order_id?: string };
  plan?: ReturnType<DemoSandbox['paydayPlan']>;
  steps?: Record<string, StepStatus>;
  budgetConfirmed?: boolean;
  rule?: { draft_id: string; payload: Record<string, unknown>; order_id?: string; firstRun?: { draft_id: string; payload: Record<string, unknown>; order_id?: string; status?: string } };
  investMatch?: { result: string; rule: string; c_level: string; r_level: string };
  invest?: { draft_id?: string; payload?: Record<string, unknown>; order_id?: string; status?: string; ack?: boolean };
  billSync?: { label: string; kind: string; status: string }[];
  sec?: { inject?: ReturnType<DemoSandbox['ingestUntrusted']>; voiceOrders?: number; clickOrders?: number; replay?: string; timeout?: { order_id: string; status: string }; lookup?: { order_id: string; status: string; orders: number; balance: number }; balanceBefore?: number; balanceAfter?: number };
};

const LINE_CONFIDENCE: Record<string, number> = {};
const confidenceFor = (id: string) => LINE_CONFIDENCE[id] ?? Number((0.93 + (id.length * 7 % 6) / 100).toFixed(2));

function fresh(): View {
  return {
    t: 0, sb: new DemoSandbox().reset('intro'), scene: 'intro', lower: null, chat: [], cards: [], flash: {}, moves: [], clicks: [],
    highlights: [], captions: [], milestones: {}, goose: [{ action: 'idle', at: -10 }], overlay: null, auditAt: [], errors: [],
  };
}

const addCard = (v: View, kind: CardKind, at: number, id: string = kind) => {
  v.cards = v.cards.filter(c => c.id !== id);
  v.cards.push({ id, kind, at });
};
const dropCard = (v: View, id: string) => { v.cards = v.cards.filter(c => c.id !== id); };
const collapseAll = (v: View, at: number, summary: string) => {
  for (const c of v.cards) if (!c.collapsed) c.collapsed = at;
  v.cards = v.cards.filter(c => c.kind !== 'auth');
  v.cards.push({ id: `done-${v.cards.length}`, kind: 'done', at, summary });
  v.cards = v.cards.filter(c => !c.collapsed);
};
/** Replaces a finished card with a one-line summary in the same slot. */
const settle = (v: View, id: string, at: number, summary: string) => {
  const i = v.cards.findIndex(c => c.id === id);
  if (i >= 0) v.cards[i] = { id: `done-${id}`, kind: 'done', at, summary };
};
const gooseCue = (v: View, action: MascotAction, at: number) => { v.goose.push({ action, at }); };
const step = (v: View, id: string, status: string, tone: StepStatus['tone'], at: number) => {
  if (!v.steps) return;
  v.steps[id] = { ...v.steps[id], status, tone };
  v.flash[`step-${id}`] = at;
};

function enterScene(v: View, scene: SceneId, at: number) {
  v.scene = scene;
  v.sb = new DemoSandbox().reset(scene === 'intro' || scene === 'ending' ? 'payday' : scene);
  v.auditAt = [];
  v.chat = []; v.cards = []; v.auth = undefined; v.lower = null;
  gooseCue(v, 'idle', at);
}

/** Viewer- or script-initiated clicks. Unknown targets are ignored, as a dead button would be. */
function click(v: View, target: string, at: number) {
  const sb = v.sb;
  v.clicks.push({ target, at });
  if (target.startsWith('cand-')) {
    const id = target.slice(5);
    const parsed = parseTransfer(lineText(v, 's1-xz-1'))!;
    v.selected = id;
    const draft = sb.transferPrepare(id, parsed.amount_fen, parsed.purpose);
    v.transfer = { draft_id: draft.draft_id, payload: draft.payload, balanceBefore: sb.balance_fen };
    addCard(v, 'tr-confirm', at + 0.25);
    gooseCue(v, 'waiting', at + 0.3);
    return;
  }
  switch (target) {
    case 'intro-basis': dropCard(v, 'intro-salary'); addCard(v, 'intro-basis', at + 0.2); v.flash['intro-basis'] = at; return;
    case 'tr-confirm': {
      const r = sb.confirm(v.transfer!.draft_id, { type: 'manual_click' });
      v.transfer!.confirmation_id = r.data.confirmation_id!;
      v.auth = { for: 'transfer', confirmation_id: r.data.confirmation_id!, at: at + 0.2 };
      settle(v, 'tr-candidates', at + 0.2, '收款人：张三 · 羽毛球社 · 尾号 7291（由你选择）');
      addCard(v, 'auth', at + 0.2);
      return;
    }
    case 'auth-ok': {
      const auth = v.auth!;
      sb.reauthVerify(auth.confirmation_id);
      dropCard(v, 'auth'); v.auth = undefined;
      if (auth.for === 'transfer') {
        const r = sb.transferSubmit(auth.confirmation_id, 'IDEM-TR-01', v.transfer!.payload);
        v.transfer!.order = r.data.order;
        settle(v, 'tr-confirm', at + 0.3, '确认页：manual_click ＋ 演示认证；语音“确认”未计入授权');
        addCard(v, 'tr-receipt', at + 0.3);
        if (r.status === 'SUCCESS') gooseCue(v, 'success', at + 0.4);
      }
      if (auth.for === 'freeze') {
        const r = sb.cardFreezeSubmit(auth.confirmation_id, 'IDEM-FZ-01', v.freeze!.payload);
        v.freeze!.order_id = r.order_id!;
        settle(v, 'freeze-confirm', at + 0.3, '冻结确认页：尾号 6688 · manual_click ＋ 演示认证');
        addCard(v, 'freeze-receipt', at + 0.3);
        if (r.status === 'SUCCESS') gooseCue(v, 'guard', at + 0.4);
      }
      if (auth.for === 'rule') {
        const r = sb.ruleCreate(auth.confirmation_id, 'IDEM-RULE-01', v.rule!.payload);
        v.rule!.order_id = r.order_id!;
        step(v, 'GOAL_RULE', '已创建 · 待首跑确认', 'info', at + 0.3);
        const run = sb.firstRunPrepare(r.order_id!);
        v.rule!.firstRun = { draft_id: run.draft_id, payload: run.payload };
        dropCard(v, 'rule-confirm');
        addCard(v, 'rule-receipt', at + 0.3);
        addCard(v, 'firstrun-confirm', at + 0.6);
        step(v, 'GOAL_FIRST_RUN', '待首跑确认', 'wait', at + 0.6);
      }
      if (auth.for === 'invest') {
        const r = sb.investSubmit(auth.confirmation_id, 'IDEM-INV-01', v.invest!.payload!);
        v.invest = { ...v.invest, order_id: r.order_id!, status: r.status };
        addCard(v, 'invest-receipt', at + 0.3);
        step(v, 'INVEST', '申请已受理 · 份额待确认', 'pending', at + 0.3);
        gooseCue(v, 'waiting', at + 0.4);
      }
      return;
    }
    case 'aa-confirm': {
      const r = sb.confirm(v.aa!.draft_id, { type: 'manual_click' });
      sb.aaCreate(r.data.confirmation_id!, 'IDEM-AA-01', v.aa!.payload);
      v.aa!.created = true;
      v.flash['aa-created'] = at;
      return;
    }
    case 'aa-remind': {
      const remind = v.aa!.remind!;
      const r = sb.confirm(remind.draft_id, { type: 'manual_click' });
      sb.aaRemind(r.data.confirmation_id!, 'IDEM-RM-01', remind.payload);
      remind.sent = true;
      v.flash['aa-remind'] = at;
      return;
    }
    case 'tx-correct': v.correctOpen = true; v.flash['tx-correct'] = at; return;
    case 'cat-study':
      sb.billCorrect('TX-PRINT-018', '学习/打印', 'SINGLE');
      v.correctOpen = false; v.corrected = true; v.flash['tx-corrected'] = at;
      settle(v, 'bill-scope', at + 0.6, '数据范围：已授权知行沙箱账户 · 演示月 · 不含未接入平台和现金');
      settle(v, 'bill-coffee', at + 0.6, '分类：8 笔 126.00 元推断为咖啡类 · 不代表杯数或商品');
      addCard(v, 'fed', at + 0.6);
      return;
    case 'sub-stop-SUB-VIDEO-25': {
      const plan = sb.subscriptionPlan('SUB-VIDEO-25') as { draft: { draft_id: string; payload: Record<string, unknown> } };
      v.sub = { draft_id: plan.draft.draft_id, payload: plan.draft.payload };
      v.subPaths = { ...v.subPaths, 'SUB-VIDEO-25': 'bank' };
      v.flash['sub-video'] = at;
      addCard(v, 'sub-confirm', at + 0.3);
      return;
    }
    case 'sub-stop-SUB-MUSIC-31':
      sb.subscriptionPlan('SUB-MUSIC-31');
      v.subPaths = { ...v.subPaths, 'SUB-MUSIC-31': 'external' };
      v.flash['sub-music'] = at;
      return;
    case 'sub-confirm': {
      const r = sb.confirm(v.sub!.draft_id, { type: 'manual_click' });
      const s = sb.subscriptionReleaseBank(r.data.confirmation_id!, 'IDEM-SUB-01', v.sub!.payload);
      v.sub!.order_id = s.order_id!;
      dropCard(v, 'sub-confirm');
      addCard(v, 'sub-status', at + 0.3);
      return;
    }
    case 'anomaly-not-me': {
      sb.anomalyAnswer('NOT_ME');
      const draft = sb.cardFreezePrepare();
      v.freeze = { draft_id: draft.draft_id, payload: draft.payload };
      v.flash['not-me'] = at;
      settle(v, 'anomaly', at + 0.35, '你已核实：非本人操作 · 三方审查保留分歧 · 规则结论“待核实”，未自动锁卡');
      addCard(v, 'freeze-confirm', at + 0.35);
      return;
    }
    case 'freeze-confirm': {
      const r = sb.confirm(v.freeze!.draft_id, { type: 'manual_click' });
      v.auth = { for: 'freeze', confirmation_id: r.data.confirmation_id!, at: at + 0.2 };
      addCard(v, 'auth', at + 0.2);
      return;
    }
    case 'budget-confirm':
      sb.budgetConfirm('家庭聚餐', PAYDAY.family_dinner_fen);
      v.budgetConfirmed = true;
      step(v, 'BUDGET', '草稿已确认 · 未付款', 'ok', at);
      return;
    case 'rule-confirm': {
      const r = sb.confirm(v.rule!.draft_id, { type: 'manual_click' });
      v.auth = { for: 'rule', confirmation_id: r.data.confirmation_id!, at: at + 0.2 };
      addCard(v, 'auth', at + 0.2);
      return;
    }
    case 'firstrun-confirm': {
      const run = v.rule!.firstRun!;
      const r = sb.confirm(run.draft_id, { type: 'manual_click' });
      const s = sb.firstRunSubmit(r.data.confirmation_id!, 'IDEM-RUN-01', run.payload);
      run.order_id = s.order_id!; run.status = s.status;
      dropCard(v, 'firstrun-confirm');
      v.flash['firstrun'] = at;
      step(v, 'GOAL_RULE', '已创建', 'ok', at);
      step(v, 'GOAL_FIRST_RUN', '首跑已确认 · 模拟回执', 'ok', at + 0.2);
      if (s.status === 'SUCCESS') gooseCue(v, 'savings', at + 0.3);
      return;
    }
    case 'risk-ack':
      v.invest = { ...v.invest, ack: true };
      v.flash['risk-ack'] = at;
      return;
    case 'invest-confirm': {
      if (!v.invest?.ack) { v.errors.push('风险与费用尚未确认阅读'); return; }
      const r = sb.confirm(v.invest.draft_id!, { type: 'manual_click' });
      v.auth = { for: 'invest', confirmation_id: r.data.confirmation_id!, at: at + 0.2 };
      settle(v, 'invest-disclosure', at + 0.2, '费用与风险已展示 · 你已确认阅读 · 每月 200 · 3 次 · 上限 600 · 90 天');
      addCard(v, 'auth', at + 0.2);
      return;
    }
    case 'sec-lookup': {
      const looked = sb.orderGet(v.sec!.timeout!.order_id);
      v.sec!.lookup = { order_id: looked.order_id!, status: looked.status, orders: sb.ordersOf('transfer').length, balance: sb.balance_fen };
      v.flash['sec-lookup'] = at;
      return;
    }
  }
}

let currentLines: Map<string, TimedLine> = new Map();
const lineText = (_v: View, id: string) => currentLines.get(id)?.text || '';

/** System-side steps the script triggers (searches, plans, simulated next day...). */
function run(v: View, op: string, at: number) {
  const sb = v.sb;
  switch (op) {
    case 'intro-salary': addCard(v, 'intro-salary', at); return;
    case 'intro-map': v.plan = sb.paydayPlan(); v.steps = initialSteps(); addCard(v, 'intro-map', at); return;
    case 'tr-search': {
      const parsed = parseTransfer(lineText(v, 's1-xz-1'))!;
      const r = sb.contactSearch(parsed.payee_name);
      v.candidates = r.data.candidates; v.selected = undefined;
      addCard(v, 'tr-candidates', at);
      gooseCue(v, 'thinking', at);
      return;
    }
    case 'tr-voice-confirm': {
      const r = sb.confirm(v.transfer!.draft_id, { type: 'voice', text: lineText(v, 's1-xz-2') });
      v.transfer!.voiceNotice = at;
      v.transfer!.voiceSnapshot = { orders: sb.orders.size, confirmations: sb.confirmations.size, balance: sb.balance_fen };
      v.chat.push({ id: `sys-${at}`, who: 'system', text: 'notice' in r.data ? r.data.notice : '', at, end: at, tone: 'notice' });
      return;
    }
    case 'aa-v1': {
      v.aaDrafts = parseAa(lineText(v, 's1-xz-3'));
      const d = v.aaDrafts[0];
      const calc = sb.aaCalculate(1, toItems(d), DINNER_MEMBERS, '小知');
      const draft = sb.aaDraft(calc);
      v.aaCalcs = [calc];
      v.aa = { draft_id: draft.draft_id, payload: draft.payload };
      addCard(v, 'aa-calc', at);
      return;
    }
    case 'aa-v2': {
      const d = v.aaDrafts![1];
      const calc = sb.aaCalculate(2, toItems(d), DINNER_MEMBERS, '小知');
      const draft = sb.aaDraft(calc);
      v.aaCalcs = [...v.aaCalcs!, calc];
      v.aa = { draft_id: draft.draft_id, payload: draft.payload };
      v.flash['aa-v2'] = at;
      return;
    }
    case 'aa-nextday': {
      sb.aaSimulateNextDay();
      const remind = sb.aaRemindPrepare();
      v.aa!.nextDay = true;
      v.aa!.remind = { draft_id: remind.draft_id, payload: remind.payload };
      dropCard(v, 'aa-calc');
      addCard(v, 'aa-status', at);
      return;
    }
    case 'collapse-transfer': collapseAll(v, at, `转账 120 元 · ${v.transfer?.order?.order_id} · 模拟回执已完成`); return;
    case 'bill-summary': v.bill = sb.billSummary(); addCard(v, 'bill-scope', at); addCard(v, 'bill-coffee', at + 0.5); addCard(v, 'bill-tx', at + 1.0); return;
    case 'collapse-bills': collapseAll(v, at, '已纠正 1 笔分类 · 本地保留 · 聚合未发布'); return;
    case 'sub-radar': addCard(v, 'sub-radar', at); return;
    case 'anomaly-review': v.anomaly = sb.anomalyReview(); addCard(v, 'anomaly', at); gooseCue(v, 'risk', at + 2.6); return;
    case 'payday-plan': {
      const parsed = parsePayday(lineText(v, 's5-xz-1'))!;
      v.plan = sb.paydayPlan();
      v.steps = initialSteps();
      if (parsed.extra_budget) v.flash['budget-draft'] = at;
      addCard(v, 'pd-map', at);
      gooseCue(v, 'thinking', at);
      return;
    }
    case 'pd-basis': addCard(v, 'pd-basis', at); gooseCue(v, 'speaking', at); return;
    case 'rule-draft': {
      const parsed = parseGoalRule(lineText(v, 's5-xz-2'))!;
      const draft = sb.rulePrepare(parsed.amount_fen, parsed.times, 90);
      v.rule = { draft_id: draft.draft_id, payload: draft.payload };
      dropCard(v, 'pd-basis');
      addCard(v, 'rule-confirm', at);
      step(v, 'GOAL_RULE', '待确认', 'wait', at);
      gooseCue(v, 'waiting', at);
      return;
    }
    case 'invest-card': {
      const parsed = parseInvestLearn(lineText(v, 's5-xz-3'))!;
      dropCard(v, 'rule-receipt');
      v.investMatch = sb.suitabilityMatch('C2', 'R2');
      const draft = sb.investPrepare(parsed.amount_fen, 3, 90);
      v.invest = { draft_id: draft.draft_id, payload: draft.payload };
      addCard(v, 'invest', at);
      step(v, 'INVEST', '待确认', 'wait', at);
      return;
    }
    case 'invest-disclosure':
      settle(v, 'invest', at, '适当性：正式测评 C2 · 产品 R2 · 机构规则匹配（模拟）· 投教自愿可跳过');
      addCard(v, 'invest-disclosure', at);
      return;
    case 'bill-sync': {
      v.billSync = sb.billSyncPayday();
      step(v, 'BILL_SYNC', '仅按已取得记录更新', 'ok', at);
      return;
    }
    case 'sec-1': {
      v.sec = { balanceBefore: sb.balance_fen };
      const c = sb.injectedContact();
      v.sec.inject = sb.ingestUntrusted({ name: c.name, note: c.note });
      addCard(v, 'sec-1', at);
      return;
    }
    case 'sec-2': {
      const draft = sb.transferPrepare('ZS-BADM-7291', 12_000, '球场费');
      sb.confirm(draft.draft_id, { type: 'voice', text: '确认转账' });
      v.sec!.voiceOrders = sb.orders.size;
      const cfm = sb.confirm(draft.draft_id, { type: 'manual_click' }).data.confirmation_id!;
      sb.reauthVerify(cfm);
      sb.transferSubmit(cfm, 'IDEM-SEC-02', draft.payload);
      v.sec!.clickOrders = sb.orders.size;
      try { sb.transferSubmit(cfm, 'IDEM-SEC-02B', { ...draft.payload, amount_fen: 999_900 }); v.sec!.replay = 'ACCEPTED'; }
      catch (e) { v.sec!.replay = (e as SandboxError).code; }
      addCard(v, 'sec-2', at);
      return;
    }
    case 'sec-3': {
      sb.reset('security');
      v.auditAt = [];
      sb.setNetwork('timeout');
      v.sec!.balanceBefore = sb.balance_fen;
      const draft = sb.transferPrepare('ZS-BADM-7291', 12_000, '球场费');
      const cfm = sb.confirm(draft.draft_id, { type: 'manual_click' }).data.confirmation_id!;
      sb.reauthVerify(cfm);
      const r = sb.transferSubmit(cfm, 'IDEM-SEC-03', draft.payload);
      v.sec!.timeout = { order_id: r.order_id!, status: r.status };
      sb.setNetwork('normal');
      addCard(v, 'sec-3', at);
      return;
    }
  }
}

const toItems = (d: AaDraft) => d.items.map(i => ({ name: i.name, amount_fen: i.amount_fen, participants: i.participants === 'ALL' ? DINNER_MEMBERS : i.participants }));
const initialSteps = (): Record<string, StepStatus> => ({
  SCOPE: { label: '数据范围', status: '已读取 · 工资已核验', tone: 'ok' },
  BUDGET: { label: '聚餐预算', status: '待确认', tone: 'wait' },
  GOAL_RULE: { label: '目标储蓄规则', status: '待确认', tone: 'wait' },
  GOAL_FIRST_RUN: { label: '规则首跑', status: '待确认', tone: 'wait' },
  INVEST: { label: '合成定投', status: '待确认', tone: 'wait' },
  BILL_SYNC: { label: '账单回流', status: '等待前序结果', tone: 'wait' },
});

function apply(v: View, act: TimedAct, lines: Map<string, TimedLine>) {
  const at = act.at;
  const before = v.sb.audit.length;
  try {
    switch (act.k) {
      case 'scene': enterScene(v, act.scene, at); break;
      case 'lower': v.lower = { text: act.text, sub: act.sub, at }; break;
      case 'user': {
        const line = lines.get(act.line)!;
        v.chat.push({ id: act.line, who: 'user', text: line.text, at: line.start, end: line.end, mode: act.mode, confidence: act.mode === 'voice' ? confidenceFor(act.line) : undefined });
        gooseCue(v, 'listening', at);
        break;
      }
      case 'goose': {
        const line = lines.get(act.line)!;
        v.chat.push({ id: act.line, who: 'goose', text: line.text, at: line.start, end: line.end });
        gooseCue(v, 'speaking', at);
        break;
      }
      case 'cursor': v.moves.push({ to: act.to, at, dur: act.dur ?? 0.55 }); break;
      case 'click': click(v, act.target, at); break;
      case 'run': run(v, act.op, at); break;
      case 'highlight': v.highlights.push({ target: act.target, at, dur: act.dur ?? 1.6 }); break;
      case 'caption': v.captions.push({ text: act.text, at, dur: act.dur ?? 2.6 }); break;
      case 'milestone': {
        v.sb.recordGrowth(act.event);
        const m = MILESTONES.find(x => x.id === act.id)!;
        if (!v.milestones[m.id]) v.milestones[m.id] = { at, basis: act.basis };
        gooseCue(v, 'growth', at);
        break;
      }
      case 'gooseAnim': gooseCue(v, act.action, at); break;
      case 'overlay': v.overlay = act.kind ? { kind: act.kind, at } : null; break;
    }
  } catch (e) {
    v.errors.push(`${act.k}@${at.toFixed(2)}: ${(e as Error).message}`);
  }
  for (let i = before; i < v.sb.audit.length; i++) v.auditAt[i] = at;
}

/** The view at time t: replay every act up to t from a fresh state. */
export function viewAt(compiled: Compiled, t: number): View {
  const lines = new Map(compiled.lines.map(l => [l.id, l]));
  currentLines = lines;
  const v = fresh();
  for (const act of compiled.acts) {
    if (act.at > t) break;
    apply(v, act, lines);
  }
  v.t = t;
  return v;
}

/** Validates a whole take: returns errors raised by any act (e.g. a click without a confirmation). */
export function rehearse(compiled: Compiled): string[] {
  return viewAt(compiled, compiled.duration + 1).errors;
}

export const MILESTONE_LIST = MILESTONES;
