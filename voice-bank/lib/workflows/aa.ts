import { WorkflowError, type Row } from './types.ts';

/** One spoken carve-out, e.g. drinks shared only by the people who had them. */
export type AaItem = { label: string; amount: number; participants: string[] };
export type AaShare = { name: string; amount: number; detail: string; payer: boolean; status: 'self' | 'unpaid' | 'paid' };

const SELF = /^(?:我|自己|本人|小知)$/;
export const isPayer = (name: string) => SELF.test(name.trim());
const yuan = (cents: number) => (cents / 100).toFixed(cents % 100 ? 2 : 0);

export function normalizeAdjustments(value: unknown): AaItem[] {
  if (!Array.isArray(value) || value.length > 10) throw new WorkflowError('分项需为不超过10项的列表。');
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new WorkflowError('每个分项需包含名称、金额和分摊人。');
    const { label, amount, participants, ...rest } = item as Record<string, unknown>;
    if (Object.keys(rest).length) throw new WorkflowError('分项只接受名称、金额和分摊人。');
    if (typeof label !== 'string' || !label.trim() || label.length > 20) throw new WorkflowError('分项名称需为1至20个字。');
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0 || Math.abs(Math.round(n * 100) / 100 - n) > 1e-8) throw new WorkflowError('分项金额需大于0，最多两位小数。');
    if (!Array.isArray(participants) || participants.length > 20 || !participants.every((x) => typeof x === 'string' && x.trim()))
      throw new WorkflowError('分项分摊人需为用户说出的姓名列表。', 400, 'adjustments');
    return { label: label.trim(), amount: n, participants: participants.map((x) => (x as string).trim()) };
  });
}

/** Split in whole cents. Each item is shared only by its people; the rest by everyone. */
export function aaShares(totalCents: number, names: string[], items: AaItem[] = []) {
  if (names.length < 2 || names.length > 20) throw new WorkflowError('AA 参与者须为 2 至 20 人。');
  if (new Set(names).size !== names.length) throw new WorkflowError('AA 名单里有重复的人，请核对。');
  const split = (amount: number, people: string[]) => {
    const base = Math.floor(amount / people.length), extra = amount % people.length;
    return new Map(people.map((name, i) => [name, base + (i < extra ? 1 : 0)]));
  };
  for (const item of items) {
    if (!item.participants.length) throw new WorkflowError(`请说明“${item.label}”具体是哪几位分摊，不能随机分配。`, 400, 'adjustments');
    const outside = item.participants.filter((name) => !names.includes(name));
    if (outside.length) throw new WorkflowError(`“${item.label}”的分摊人${outside.join('、')}不在 AA 名单里，请核对。`, 400, 'adjustments');
  }
  const carved = items.reduce((sum, item) => sum + Math.round(item.amount * 100), 0);
  if (carved >= totalCents) throw new WorkflowError('分项金额之和需小于 AA 总额。', 400, 'adjustments');
  const common = split(totalCents - carved, names);
  const parts = items.map((item) => ({ label: item.label, shares: split(Math.round(item.amount * 100), item.participants) }));
  const label = items.length ? '其余' : '均分';
  const shares: AaShare[] = names.map((name) => {
    const own = parts.filter((p) => p.shares.has(name));
    const amount = common.get(name)! + own.reduce((sum, p) => sum + p.shares.get(name)!, 0);
    const detail = [`${label}${yuan(common.get(name)!)}`, ...own.map((p) => `${p.label}${yuan(p.shares.get(name)!)}`)].join('＋');
    return { name, amount, detail, payer: isPayer(name), status: isPayer(name) ? 'self' : 'unpaid' };
  });
  const payerShare = shares.filter((s) => s.payer).reduce((sum, s) => sum + s.amount, 0);
  const receivable = totalCents - payerShare;
  const others = shares.filter((s) => !s.payer).length;
  const summary = items.length
    ? `总共${yuan(totalCents)}元，${items.map((i) => `${i.label}${yuan(Math.round(i.amount * 100))}元由${i.participants.join('、')}分摊`).join('；')}，其余按${names.length}人均分。${payerShare ? `你承担${yuan(payerShare)}元，` : ''}向其他${others}人应收${yuan(receivable)}元。`
    : `${names.length}人均分，每人${yuan(Math.floor(totalCents / names.length))}元${totalCents % names.length ? '（余下的分按名单顺序各加1分）' : ''}。${payerShare ? `你承担${yuan(payerShare)}元，` : ''}向其他${others}人应收${yuan(receivable)}元。`;
  return { shares, payerShare, receivable, summary, rule: '以分为单位计算；不能整除时，余下的分按名单顺序各加1分，合计等于总额。' };
}

export const REMINDER_TEXT = (amount: number) => `上次聚餐AA，你应付${yuan(amount)}元，当前尚未收到。方便时请通过本次AA入口完成；如已付款，可先核对记录。`;
/** Re-read who still owes before every preview or send; paid people are never reminded. */
export function reminderDrafts(aa: Row) {
  const people = (aa.participants as AaShare[] | undefined) || [];
  return people.filter((p) => !p.payer && p.status === 'unpaid').map((p) => ({ to: p.name, amount: p.amount, text: REMINDER_TEXT(p.amount) }));
}
