import { businessDay, businessNow } from '../demo/clock.ts';
import type { BankState } from '../bank/types.ts';
import type { Params, Row } from './types.ts';

/** Amounts are cents. Spoken as ¥1,234.50. */
const yuan = (c: number) => `¥${(c / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (r: Row, key: string) => Number(r[key] || 0);
const list = (s: BankState, kind: string) => (s.workflows?.records[kind] || []) as Row[];

export type ReviewBuy = { date: string; amount: number; source: string };
export type ReviewItem = {
 holdingId: string; productId: string; name: string; risk: number | null;
 cost: number; value: number; profit: number; profitRate: number | null;
 buyCount: number; firstBuyAt: string | null; holdingDays: number | null; buys: ReviewBuy[];
};

/**
 * Looking back on what was bought: cost, value, gain or loss, how often and when each buy happened, and how long it has
 * been held, from the holdings and settled orders only. It asks questions; it never says to buy, sell or hold, and
 * never projects a return. Accepted orders that are not settled are listed apart and do not count as held.
 */
export function portfolioReview(s: BankState, p: Params = {}) {
 const today = businessDay(s), orders = list(s, 'orders'), products = list(s, 'products');
 const holdings = list(s, 'holdings').filter(h => (!p.holdingId || h.id === p.holdingId) && num(h, 'value') > 0);
 const items: ReviewItem[] = holdings.map(h => {
  const seeded = (Array.isArray(h.purchases) ? h.purchases as { date: string; amount: number }[] : []).map(b => ({ date: b.date, amount: b.amount, source: '合成历史买入' }));
  const settled = orders.filter(o => o.action === 'subscribe' && o.status === 'settled' && o.productId === h.productId && o.accountId === h.accountId)
   .map(o => ({ date: businessDay({ demoClock: String(o.settledAt || o.createdAt) } as BankState), amount: num(o, 'amount'), source: '沙箱订单' }));
  const buys = [...seeded, ...settled].sort((a, b) => a.date.localeCompare(b.date));
  const cost = num(h, 'cost'), value = num(h, 'value'), first = buys[0]?.date ?? null;
  const product = products.find(r => r.id === h.productId);
  return {
   holdingId: String(h.id), productId: String(h.productId), name: String(h.name), risk: product ? num(product, 'risk') : null,
   cost, value, profit: value - cost, profitRate: cost > 0 ? Math.round((value - cost) / cost * 10000) / 10000 : null,
   buyCount: buys.length, firstBuyAt: first, holdingDays: first ? Math.max(0, Math.round((Date.parse(today) - Date.parse(first)) / 86400000)) : null, buys,
  };
 });
 const pending = orders.filter(o => o.action === 'subscribe' && o.status === 'pending').map(o => ({ orderId: o.id, name: o.name, amount: num(o, 'amount'), note: '已受理、份额未确认，不计入持有' }));
 const notes = list(s, 'reviewNotes').filter(n => !p.holdingId || !n.holdingId || n.holdingId === p.holdingId);
 const questions = reviewQuestions(s, items);
 return {
  holdings: items, pending, questions, notes, asOf: today, synthetic: true,
  basis: '成本是买入本金减去已赎回部分；盈亏 = 市值 − 成本；持有天数从第一次买入算起。数据为合成演示数据。',
  boundary: '只回顾事实并提问，不给买入、卖出或继续持有的建议，也不预测收益。',
  spokenSummary: reviewSpeech(items, pending.length, questions),
 };
}

function reviewQuestions(s: BankState, items: ReviewItem[]): string[] {
 if (!items.length) return [];
 const one = items.length === 1 ? items[0] : undefined, name = one ? one.name : '这几项产品';
 const profile = s.workflows?.riskProfile, valid = !!profile && Date.parse(profile.validUntil) >= businessNow(s);
 const top = Math.max(...items.map(i => i.risk ?? 0));
 const fit = !valid
  ? `你现在没有有效的风险测评，${name}${one?.risk ? `是R${one.risk}` : `最高是R${top}`}；想判断它还合不合适，可以先做一次测评。`
  : `${name}${one?.risk ? `是R${one.risk}` : `最高是R${top}`}，你的有效测评是C${profile!.level}，${top <= profile!.level ? '在测评范围内' : '已经高于测评结果'}；这和你当时愿意承担的风险一致吗？`;
 return [
  `当时买${name}是为了什么（应急、攒钱目标还是先试试）？这个目的现在还在吗？`,
  fit,
  '这笔钱多久内可能要用？赎回要等到账，这个节奏对你合适吗？',
 ];
}

function reviewSpeech(items: ReviewItem[], pending: number, questions: string[]) {
 if (!items.length) return `目前没有理财持仓，暂时没有可复盘的内容${pending ? `；有 ${pending} 笔申购已受理但份额未确认，确认后再复盘` : ''}。`;
 const facts = items.map(i => `${i.name}成本${yuan(i.cost)}、市值${yuan(i.value)}、${i.profit > 0 ? `赚了${yuan(i.profit)}` : i.profit < 0 ? `亏了${yuan(-i.profit)}` : '不赚不亏'}，买过${i.buyCount}次${i.holdingDays != null ? `，持有${i.holdingDays}天` : ''}`).join('；');
 return `复盘${items.length}项持仓：${facts}。想一想：${questions.slice(0, 2).join('')}`;
}

/** A note the user writes for their own review. It never enters the risk profile or any eligibility check. */
export function reviewNote(p: Params, at: string) {
 return { holdingId: p.holdingId ?? null, note: String(p.note), createdAt: at };
}

/** Underlying assets in one line, for speech and comparison. */
export const underlyingText = (product: Row) => Array.isArray(product.underlying) && product.underlying.length
 ? (product.underlying as { asset: string; share: number }[]).map(u => `${u.asset}${u.share}%`).join('、') : null;
