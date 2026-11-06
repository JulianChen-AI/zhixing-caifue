import type { BankState } from '../bank/types.ts';
import type { FlowTask } from '../workflows/types.ts';
import { isWrite } from '../workflows/write-kind.ts';
import { contactsOf } from '../bank/recipients.ts';
import { outcomeBadge, type Badge, type Tone } from './desk.ts';
import { businessTitle } from './presentation.ts';

export type CardIcon = 'search' | 'shield' | 'lock' | 'receipt' | 'users' | 'route' | 'card' | 'alert' | 'database' | 'wallet' | 'file' | 'pending';
export type CardHeadView = { title: string; icon: CardIcon; badge?: Badge };

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const WAIT_MANUAL: Badge = { label: '待你手动确认', tone: 'wait' };
const SIMULATED: Badge = { label: '回执', tone: 'ok' };

function subscriptionName(bank: BankState, task: Pick<FlowTask, 'params'>) {
  const row = bank.workflows?.records.subscriptions?.find(item => item.id === task.params.subscriptionId);
  return row ? String(row.name) : '该服务';
}
function cardAction(task: Pick<FlowTask, 'functionId' | 'params'>) {
  if (task.functionId === 'CA07') return '正式挂失';
  return task.params.action === 'unfreeze' ? '解冻' : '临时冻结';
}

/**
 * Title, icon and status chip for a business card, after the showcase video. Display only:
 * a chip here never decides whether anything may run, and a receipt title appears only once
 * the task has really returned a sandbox result.
 */
export function cardHead(bank: BankState, task: FlowTask): CardHeadView {
  const { functionId: id, status, params } = task;
  const name = businessTitle(id, task.title);
  if (status === 'authenticate') return { title: `验证身份 · ${['CA06', 'CA07'].includes(id) ? cardAction(task) : name}`, icon: 'lock', badge: { label: '待验证', tone: 'info' } };
  if (status === 'review') {
    if (id === 'TR03') return { title: '转账确认页', icon: 'shield', badge: WAIT_MANUAL };
    if (id === 'TR05' && params.action === 'create') return { title: 'AA 分摊计算', icon: 'users', badge: { label: '确定性计算', tone: 'calc' } };
    if (id === 'TR05' && params.action === 'remind') return { title: 'AA 提醒确认', icon: 'users', badge: WAIT_MANUAL };
    if (id === 'SU04') return { title: `确认：解除${subscriptionName(bank, task)}的银行代扣授权`, icon: 'shield', badge: WAIT_MANUAL };
    if (id === 'CA06' || id === 'CA07') return { title: `卡片管理 · ${cardAction(task)}确认`, icon: 'card', badge: WAIT_MANUAL };
    if (id === 'IN08') return { title: '费用、风险与计划', icon: 'alert', badge: { label: '需你独立授权', tone: 'wait' } };
    if (id === 'TR04' || id === 'IN13') return { title: `规则确认页 · ${name}`, icon: 'shield', badge: { label: '创建需强认证', tone: 'wait' } };
    return { title: `确认：${name}`, icon: 'shield', badge: WAIT_MANUAL };
  }
  if (status === 'blocked' && (id === 'TR03' || id === 'TR04') && task.riskSignals?.length) return { title: '这笔转账已拦下', icon: 'alert', badge: { label: '未转出 · 未扣款', tone: 'risk' } };
  if (status === 'blocked' && (id === 'IN08' || id === 'IN13') && /测评/.test(task.message)) return { title: '购买前的适当性检查', icon: 'alert', badge: { label: '暂不能购买', tone: 'risk' } };
  if (status === 'collecting' && id === 'TR03' && task.recipientChoices?.length) {
    const first = contactsOf(bank).find(contact => contact.id === task.recipientChoices![0]);
    return { title: `找到 ${task.recipientChoices.length} 位“${first?.name || '收款人'}”`, icon: 'search', badge: { label: params.recipientId ? '已由你选择' : '无默认选中 · 请你选择', tone: params.recipientId ? 'ok' : 'wait' } };
  }
  if (status === 'complete' && isWrite(task)) {
    if (id === 'TR05' && params.action === 'create') return { title: 'AA 收款状态', icon: 'users', badge: SIMULATED };
    if (id === 'TR05' && params.action === 'remind') return { title: 'AA 提醒回执', icon: 'users', badge: SIMULATED };
    if (id === 'TR03') return { title: '转账回执', icon: 'receipt', badge: SIMULATED };
    if (id === 'CA06' || id === 'CA07') return { title: `${cardAction(task)}回执`, icon: 'card', badge: SIMULATED };
    if (id === 'SU04') return { title: `${subscriptionName(bank, task)} · 状态分开记`, icon: 'receipt', badge: SIMULATED };
    if (id === 'IN08') return { title: '申购申请回执', icon: 'pending', badge: SIMULATED };
    return { title: `${name}回执`, icon: 'receipt', badge: SIMULATED };
  }
  if (id === 'SU01' && status === 'complete') return { title: '持续扣费雷达', icon: 'route', badge: { label: '账单线索', tone: 'wait' } };
  if (id === 'TR05' && status === 'complete') return { title: 'AA 收款状态', icon: 'users', badge: outcomeBadge(bank, task) };
  return { title: name, icon: id === 'TR05' ? 'users' : /^BI/.test(id) ? 'database' : /^CA/.test(id) ? 'card' : /^IN/.test(id) ? 'wallet' : 'file', badge: outcomeBadge(bank, task) };
}

/** The headline of a receipt; acceptance and unknown keep their own wording, never success. */
export function receiptStatus(bank: BankState, task: FlowTask): { label: string; tone: Tone; note: string } | null {
  if (!isWrite(task) || !['complete', 'external', 'blocked'].includes(task.status)) return null;
  const badge = outcomeBadge(bank, task);
  const accepted = record(task.result).businessStage === 'accepted' || record(task.result).status === 'pending';
  if (task.status === 'complete' && accepted && task.functionId === 'IN08') return { label: '申请已受理 · 份额待确认', tone: 'pending', note: '受理 ≠ 成交' };
  return { label: badge.label, tone: badge.tone, note: '' };
}

/** What a review card must say beyond its fields, so the consequence is read before confirming. */
export function reviewNotes(task: Pick<FlowTask, 'functionId' | 'params'>): { label: string; value: string }[] {
  if (task.functionId === 'SU04') return [
    { label: '会做什么', value: '解除本行代扣通道对该商户的授权' },
    { label: '不会做什么', value: '不等于商户退订，不退还历史扣款' },
    { label: '之后', value: '原应扣日后核验是否未再扣款' },
  ];
  if (task.functionId === 'CA06' && task.params.action !== 'unfreeze') return [
    { label: '后果', value: '冻结期间该卡交易将被拒绝；已发生的交易需另行核实' },
    { label: '正式挂失', value: '需另行办理，本操作不等于挂失' },
  ];
  if (task.functionId === 'CA07') return [{ label: '后果', value: '挂失后旧卡将无法恢复，第三方绑定需分别更新' }];
  return [];
}

export type AaMember = { name: string; amount: number; detail: string; payer: boolean; paid: boolean; reminder: 'sent' | 'none' };
export type AaView = { id: string; total: number; receivable: number; received: number; outstanding: number; rule: string; balanced: boolean; members: AaMember[]; unpaid: string[] };

/** One AA session as the card shows it. Sent reminders and received money stay separate facts. */
export function aaView(bank: BankState, value: unknown): AaView | null {
  const row = record(value);
  if (!Array.isArray(row.participants)) return null;
  const sent = (bank.workflows?.records.reminders || []).filter(item => item.sessionId === row.id);
  const members = (row.participants as Record<string, unknown>[]).map(item => ({
    name: String(item.name), amount: Number(item.amount), detail: String(item.detail || ''), payer: item.payer === true, paid: item.status === 'paid',
    reminder: sent.some(reminder => reminder.to === item.name) ? 'sent' as const : 'none' as const,
  }));
  const receivable = Number(row.receivable), received = Number(row.received ?? 0);
  return {
    id: String(row.id ?? ''), total: Number(row.total), receivable, received, outstanding: Number(row.outstanding ?? receivable - received), rule: String(row.rule ?? ''),
    balanced: members.reduce((sum, item) => sum + item.amount, 0) === Number(row.total), members,
    unpaid: members.filter(item => !item.payer && !item.paid).map(item => item.name),
  };
}

const SUBSCRIPTION_STATE: Record<string, { label: string; tone: Tone }> = {
  cancelled: { label: '已解除', tone: 'ok' }, active: { label: '生效中', tone: 'info' }, unverified: { label: '未核验', tone: 'wait' },
  unknown: { label: '未确认', tone: 'wait' }, bank_mandate_stopped: { label: '待进行', tone: 'pending' },
};

/** Bank mandate, merchant, refund and later charges are four facts, not one "cancelled". */
export function subscriptionStates(value: unknown): { key: string; label: string; state: string; tone: Tone }[] {
  const row = record(value);
  const read = (key: string) => SUBSCRIPTION_STATE[String(row[key])] || SUBSCRIPTION_STATE.unknown;
  return [
    { key: 'bank', label: '银行代扣', state: read('bankAgreementState').label, tone: read('bankAgreementState').tone },
    { key: 'merchant', label: '商户订阅', state: read('merchantSubscriptionState').label, tone: read('merchantSubscriptionState').tone },
    { key: 'refund', label: '退款', state: '未发起', tone: 'muted' },
    { key: 'charge', label: '下次扣款', state: read('chargeState').label, tone: read('chargeState').tone },
  ];
}
