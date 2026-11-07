import type { Account } from '../bank/types.ts';
import type { Row } from '../workflows/types.ts';

/**
 * Default demo data: one college student's last few months, generated relative to an anchor day.
 * The same calendar day always yields the same rows, so history does not change when the anchor moves.
 * Every row is synthetic; balances are derived from the ledger so the books always reconcile.
 */
export const DEFAULT_ANCHOR = '2026-10-25';
export const DATASET_VERSION = 'demo-dataset-20261103-v1';
const SOURCE = '合成本行流水';
const DAILY_BALANCE = 1286500, SAVINGS_BALANCE = 3000000;

export const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekday = (iso: string) => new Date(iso + 'T00:00:00Z').getUTCDay();
const monthOf = (iso: string, back: number) => { const d = new Date(iso.slice(0, 7) + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - back); return d.toISOString().slice(0, 7); };
const at = (date: string, time: string) => new Date(`${date}T${time}:00+08:00`).toISOString();

/** Deterministic per-day random numbers (mulberry32 seeded by a string hash). */
function random(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h = (h + 0x6D2B79F5) | 0; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** Amount in fen between two yuan values, rounded to 0.5 yuan. */
const price = (r: () => number, lo: number, hi: number) => Math.round((lo + r() * (hi - lo)) * 2) * 50;

/** The Friday of the calendar week before the anchor's week (weeks start on Monday). */
export function lastWeekFriday(anchor: string) {
  const sinceMonday = (weekday(anchor) + 6) % 7;
  return addDays(anchor, -sinceMonday - 3);
}
/** Charge dates on a fixed day of month from start through anchor, and the next one after anchor. */
function monthly(start: string, anchor: string, dayOfMonth: number) {
  const dates: string[] = [];
  for (let back = 3; back >= -1; back--) {
    const date = `${monthOf(anchor, back)}-${String(dayOfMonth).padStart(2, '0')}`;
    if (date >= start) dates.push(date);
  }
  return { past: dates.filter(d => d <= anchor), next: dates.find(d => d > anchor)! };
}

// Two payees share the name 张三, so ledger rows carry the contact's label as well.
type Payee = { id: string; name: string };
const ROOMMATE: Payee = { id: 'zhang-roommate', name: '室友张三' }, LANDLORD: Payee = { id: 'zhang-landlord', name: '房东张三' }, CLASSMATE: Payee = { id: 'li-friend', name: '同学李四' };

export type DemoDataset = { anchor: string; version: string; accounts: Account[]; records: Record<string, Row[]> };

export function demoDataset(anchor = DEFAULT_ANCHOR): DemoDataset {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor)) throw new Error('演示数据基准日须为 YYYY-MM-DD。');
  const start = `${monthOf(anchor, 2)}-01`;
  const txns: (Row & { at: string })[] = [], history: Row[] = [];
  const spend = (id: string, date: string, time: string, merchant: string, category: string, amount: number, extra: Record<string, unknown> = {}) =>
    txns.push({ id, date, at: at(date, time), merchant, category, amount, accountId: 'daily', kind: 'expense', source: SOURCE, ...extra });
  const earn = (id: string, date: string, merchant: string, amount: number, accountId = 'daily') =>
    txns.push({ id, date, at: at(date, '09:00'), merchant, category: '收入', amount, accountId, kind: 'income', source: SOURCE });
  const transfer = (key: string, date: string, time: string, payee: Payee, amount: number, note: string) => {
    const id = 'HIST-' + key, createdAt = at(date, time);
    // Earlier transfers live beside this session's receipts, which only record what was done here.
    history.push({ id, taskId: 'hist-task-' + key, recipientId: payee.id, accountId: 'daily', amount, note, createdAt, historical: true });
    txns.push({ id, date, at: createdAt, merchant: payee.name, category: '转账', amount, accountId: 'daily', kind: 'expense', note, relatedId: 'hist-task-' + key, source: '合成历史转账' });
  };

  // Everyday spending. Canteen, cafe and video names are reserved for the scripted rows below.
  for (let date = start; date <= anchor; date = addDays(date, 1)) {
    const r = random('zhixing-day-' + date), wd = weekday(date), weekend = wd === 0 || wd === 6, key = date.replaceAll('-', '');
    const today = date === anchor;
    if (r() < .8) spend(`txn-${key}-breakfast`, date, '07:40', '学生餐厅', '餐饮', price(r, 5, 9));
    if (today) continue;
    if (r() < .9) spend(`txn-${key}-lunch`, date, '12:10', r() < .7 ? '学生餐厅' : '风味餐厅', '餐饮', price(r, 13, 20));
    if (weekend ? r() < .5 : r() < .15) spend(`txn-${key}-delivery`, date, '18:30', '外卖平台', '餐饮', price(r, 25, 42));
    else if (r() < .75) spend(`txn-${key}-dinner`, date, '17:50', '学生餐厅', '餐饮', price(r, 12, 19));
    if (r() < .3) spend(`txn-${key}-tea`, date, '15:20', '奶茶店', '饮品', price(r, 12, 19));
    if (weekend && r() < .6) { spend(`txn-${key}-metro-a`, date, '10:05', '地铁', '交通', price(r, 3, 6)); spend(`txn-${key}-metro-b`, date, '19:40', '地铁', '交通', price(r, 3, 6)); }
    if (wd === 6) spend(`txn-${key}-market`, date, '16:00', '校园超市', '日用', price(r, 35, 110));
    if (r() < .08) spend(`txn-${key}-print`, date, '14:00', '打印店', '学习', price(r, 2, 8));
    if (date.endsWith('-08')) spend(`txn-${key}-books`, date, '13:30', '书店', '学习', price(r, 45, 89));
    if (wd === 6 && ['08', '09', '10', '11', '22', '23', '24', '25'].some(d => date.endsWith('-' + d)) && r() < .7) spend(`txn-${key}-movie`, date, '20:00', '电影院', '娱乐', price(r, 39, 79));
  }

  // Monthly income, rent, utilities, savings and mandates.
  for (const d of monthly(start, anchor, 1).past) {
    const k = d.slice(0, 7);
    earn(`txn-allowance-${k}`, d, '生活费', 300000);
    transfer(`rent-${k}`, d, '10:00', LANDLORD, 150000, `${Number(k.slice(5))}月房租`);
  }
  for (const d of monthly(start, anchor, 2).past) {
    const k = d.slice(0, 7);
    txns.push({ id: `txn-save-out-${k}`, date: d, at: at(d, '09:30'), merchant: '转存储蓄', category: '内部转存', amount: 50000, accountId: 'daily', kind: 'internal_transfer', source: SOURCE });
    txns.push({ id: `txn-save-in-${k}`, date: d, at: at(d, '09:30'), merchant: '日常账户转入', category: '内部转存', amount: 50000, accountId: 'savings', kind: 'internal_transfer', direction: 'in', source: SOURCE });
  }
  for (const d of monthly(start, anchor, 10).past) {
    const r = random('zhixing-utilities-' + d);
    transfer(`utilities-${d.slice(0, 7)}`, d, '21:00', ROOMMATE, price(r, 45, 75), '水电燃气分摊');
  }
  for (const d of monthly(start, anchor, 20).past) earn(`txn-tutoring-${d.slice(0, 7)}`, d, '家教收入', 120000);
  const charges = (id: string, day: number, merchant: string, category: string, amount: number, time: string) => {
    const { past, next } = monthly(start, anchor, day);
    past.forEach((d, i) => {
      const fromEnd = past.length - 1 - i;
      spend(fromEnd === 0 ? `txn-${id}` : fromEnd === 1 ? `txn-${id}-old` : `txn-${id}-${d.slice(0, 7)}`, d, time, merchant, category, amount);
    });
    return next;
  };
  const videoNext = charges('video', 15, '视频会员', '订阅', 2500, '08:00');
  const cloudNext = charges('cloud', 3, '云存储', '订阅', 600, '08:00');
  const loanNext = charges('loan', 5, '助学贷款还款', '还款', 50000, '08:00');

  // One shared snack with a classmate on last week's Friday, so "上周五给谁转过钱" has an answer.
  const friday = lastWeekFriday(anchor);
  if (friday >= start) transfer(`snack-${friday}`, friday, '19:20', CLASSMATE, 3600, '奶茶和零食');

  // Scripted rows used by tests and evaluations: keep their ids, amounts and distances from the anchor.
  spend('txn-coffee', addDays(anchor, -7), '08:20', '咖啡店', '饮品', 2600);
  spend('txn-food', addDays(anchor, -5), '12:05', '校园食堂', '餐饮', 3200);
  spend('txn-double', addDays(anchor, -5), '12:05', '校园食堂', '餐饮', 3200, { suspectedDuplicate: true });
  txns.push({ id: 'txn-refund', date: addDays(anchor, -4), at: at(addDays(anchor, -4), '10:00'), merchant: '校园食堂', category: '餐饮', amount: 1200, accountId: 'daily', kind: 'refund', originalId: 'txn-food', source: SOURCE });

  txns.sort((a, b) => a.at.localeCompare(b.at) || String(a.id).localeCompare(String(b.id)));
  history.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const transactions: Row[] = txns.map(({ at: _at, ...row }) => row);
  const opening = (accountId: string, balance: number) => balance - transactions.filter(t => t.accountId === accountId).reduce((n, t) => n + signed(t), 0);

  return {
    anchor, version: DATASET_VERSION,
    accounts: [
      { id: 'daily', name: '日常账户', tail: '8021', balance: DAILY_BALANCE, opening: { date: start, amount: opening('daily', DAILY_BALANCE) } },
      { id: 'savings', name: '储蓄账户', tail: '3609', balance: SAVINGS_BALANCE, opening: { date: start, amount: opening('savings', SAVINGS_BALANCE) } },
    ],
    records: {
      transactions,
      transferHistory: history,
      subscriptions: [
        { id: 'sub-video', name: '视频会员', channel: 'bank', amount: 2500, cycle: 'monthly', nextChargeAt: videoNext, benefitUntil: videoNext, status: 'active', protected: false, confirmed: true },
        { id: 'sub-cloud', name: '云存储', channel: 'platform', amount: 600, cycle: 'monthly', nextChargeAt: cloudNext, status: 'active', protected: false, confirmed: true },
        { id: 'sub-loan', name: '助学贷款还款', channel: 'bank', amount: 50000, cycle: 'monthly', nextChargeAt: loanNext, status: 'active', protected: true, confirmed: true },
      ],
      products: [
        { id: 'fund-cash', name: '现金基金', risk: 1, feeRate: 0, price: 1, type: '货币', liquidity: '沙箱手动推进结算；赎回预计T+1工作日（不含节假日校验），并非即时到账', synthetic: true,
          underlying: [{ asset: '银行存款', share: 55 }, { asset: '同业存单', share: 30 }, { asset: '剩余期限一年内的国债和政策性金融债', share: 15 }], underlyingSource: '合成数据，不是真实产品披露' },
        { id: 'fund-bond', name: '债券基金', risk: 3, feeRate: 0, price: 1, type: '债券', liquidity: '沙箱手动推进结算；赎回预计T+1工作日（不含节假日校验），并非即时到账', synthetic: true,
          underlying: [{ asset: '国债和政策性金融债（利率债）', share: 50 }, { asset: 'AA+及以上信用债', share: 40 }, { asset: '现金及银行存款', share: 10 }], underlyingSource: '合成数据，不是真实产品披露' },
      ],
      goals: [{ id: 'goal-travel', name: '旅行目标', target: 300000, balance: 0, deadline: '2027-06-01', status: 'active' }],
      // Two earlier buys make up the holding's cost, so a portfolio review has dates and amounts to look back on.
      holdings: [{ id: 'holding-cash', productId: 'fund-cash', name: '现金基金', value: 20000, cost: 20000, accountId: 'savings', purchases: [{ date: addDays(anchor, -120), amount: 15000 }, { date: addDays(anchor, -45), amount: 5000 }] }],
      cards: [
        { id: 'card-daily', name: '日常借记卡', tail: '8021', accountId: 'daily', status: 'active', restriction: 'none', limit: 500000, issuer: '本行沙箱' },
        { id: 'card-risk', name: '储蓄借记卡', tail: '3609', accountId: 'savings', status: 'restricted', restriction: 'risk', limit: 1000000, issuer: '本行沙箱' },
        { id: 'card-judicial', name: '备用借记卡', tail: '9012', accountId: 'daily', status: 'restricted', restriction: 'judicial', limit: 100000, issuer: '本行沙箱' },
      ],
    },
  };
}

/** Effect of one ledger row on its account's balance. */
export function signed(t: Row) {
  const amount = Number(t.amount) || 0;
  if (t.kind === 'income' || t.kind === 'refund') return amount;
  if (t.kind === 'internal_transfer') return t.direction === 'in' ? amount : -amount;
  return -amount;
}

/** The six hand-written rows of the original ledger, for checks whose arithmetic is spelled out by hand. */
export const SCRIPTED_TRANSACTION_IDS = ['txn-food', 'txn-coffee', 'txn-video', 'txn-video-old', 'txn-refund', 'txn-double'];
export function scriptedLedger<S extends { workflows?: { records: Record<string, Row[]> } }>(s: S): S {
  const r = s.workflows!.records;
  r.transactions = SCRIPTED_TRANSACTION_IDS.map(id => r.transactions.find(t => t.id === id)!);
  r.transferHistory = [];
  return s;
}
