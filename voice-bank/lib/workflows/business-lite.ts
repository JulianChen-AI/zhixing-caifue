import { businessNow } from '../demo/clock.ts';
import type { BankState } from '../bank/types.ts';
import { WorkflowError, type Params, type Row } from './types.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const SHANGHAI = 'Asia/Shanghai';
const shanghaiDate = new Intl.DateTimeFormat('en-US', {
  timeZone: SHANGHAI,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Demo policy notice: the adopted wealth flow says “same-day” but sets no
 * 15:00 cutoff. This implementation uses Beijing time through 24:00 only as
 * an explicit demo boundary; a production cutoff must come from the bank.
 */
export const CANCELLATION_POLICY_NOTICE = '演示口径：仅北京时间当日可撤，截止当日24:00；采用稿未规定15:00截止，真实业务时点须由机构确认。';

function fail(message: string): never {
  throw new WorkflowError(message);
}

function rows(s: BankState, kind: string): Row[] {
  return s.workflows?.records?.[kind] ?? [];
}

function beijingDay(epoch: number): string {
  if (!Number.isFinite(epoch)) return '';
  const parts = Object.fromEntries(shanghaiDate.formatToParts(epoch).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function beijingMonth(epoch: number): string {
  return beijingDay(epoch).slice(0, 7);
}

function validAt(at?: number): number {
  const value = at ?? Date.now();
  if (!Number.isFinite(value)) return fail('演示时间戳无效。');
  return value;
}

function timestamp(value: unknown, field: string): number {
  const epoch = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(epoch)) return fail(`${field}无效，不能继续。`);
  return epoch;
}

function isValidYmd(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, ys, ms, ds] = match;
  const year = Number(ys), month = Number(ms), day = Number(ds);
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function shanghaiMidnight(day: string): number {
  const [year, month, date] = day.split('-').map(Number);
  // Shanghai is UTC+08:00; local-midnight arithmetic keeps the 30-day basis explicit.
  return Date.UTC(year, month - 1, date) - 8 * 60 * 60 * 1000;
}

function goalMoney(value: unknown, name: string): number {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0) return fail(`${name}须为正的整数分。`);
  return amount;
}

function requestedYuanToCents(value: unknown, name: string): number {
  const yuan = Number(value);
  const cents = Math.round(yuan * 100);
  if (!Number.isFinite(yuan) || !Number.isSafeInteger(cents) || yuan <= 0 || Math.abs(cents / 100 - yuan) > 1e-8) {
    return fail(`${name}须为大于0且最多两位小数的金额。`);
  }
  return cents;
}

export type GoalPlan = {
  target: number;
  balance: number;
  remaining: number;
  deadline: string;
  months: number;
  monthlyAmount: number;
  basis: string;
};

/** Money values returned by this helper are cents, matching goal/rule records. */
export function goalPlan(s: BankState, p: Params): GoalPlan {
  const goal = p.goalId == null ? undefined : rows(s, 'goals').find((row) => row.id === p.goalId);
  if (p.goalId != null && !goal) return fail('找不到当前会话中的储蓄目标。');

  const target = p.target != null
    ? requestedYuanToCents(p.target, '目标金额')
    : goal ? goalMoney(goal.target, '目标金额') : fail('创建目标时请明确目标金额。');
  const balance = goal ? Number(goal.balance ?? 0) : 0;
  if (!Number.isSafeInteger(balance) || balance < 0) return fail('目标当前余额无效。');

  const deadline = p.deadline != null ? String(p.deadline) : String(goal?.deadline ?? '');
  if (!isValidYmd(deadline)) return fail('目标截止日期须为有效的 YYYY-MM-DD 日期。');
  const now = businessNow(s);
  const today = beijingDay(now);
  if (deadline <= today) return fail('目标截止日期必须晚于今天（北京时间）。');

  const remaining = target - balance;
  const days = Math.ceil((shanghaiMidnight(deadline) - shanghaiMidnight(today)) / DAY_MS);
  const months = Math.max(1, Math.ceil(days / 30));
  return {
    target,
    balance,
    remaining,
    deadline,
    months,
    monthlyAmount: remaining > 0 ? Math.ceil(remaining / months) : 0,
    basis: `演示估算：按每30天为1个月、剩余天数向上取整为${months}期；月供按分向上取整，不移动资金。`,
  };
}

/** Recalculate linked goal rules only; this does not move any money. */
export function replanGoalRules(s: BankState, goal: Row): void {
  const plan = goalPlan(s, { goalId: goal.id });
  for (const rule of rows(s, 'rules')) {
    if (rule.kind === 'goal' && rule.goalId === goal.id && !rule.fixed) rule.amount = plan.monthlyAmount;
  }
}

/**
 * Return the end of the current Beijing calendar day as an ISO instant.
 * The business source specifies same-day cancellation but no 15:00 cutoff.
 */
export function cancellationDeadline(at?: number): string {
  const epoch = validAt(at);
  const day = beijingDay(epoch);
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date, 15, 59, 59, 999)).toISOString();
}

/** Only same-Beijing-day pending subscriptions are cancellable in this demo. */
export function assertCancellation(order: Row, at?: number): void {
  const now = validAt(at);
  if (order.status !== 'pending') return fail('仅待处理申购可撤；订单状态已变化。');
  if (order.action !== 'subscribe') return fail('仅当日待处理申购可撤；赎回订单不能按申购撤单。');
  const createdAt = timestamp(order.createdAt, '订单创建时间');
  if (createdAt > now) return fail('订单创建时间晚于当前时间，不能撤单。');
  if (beijingDay(createdAt) !== beijingDay(now)) return fail(`订单不是北京时间当日创建，不能撤单。${CANCELLATION_POLICY_NOTICE}`);
  if (order.cancelUntil != null && order.cancelUntil !== '') {
    const deadline = timestamp(order.cancelUntil, '撤单截止时间');
    if (now > deadline) return fail(`订单撤单时间已过。${CANCELLATION_POLICY_NOTICE}`);
  }
}

/**
 * Demo-only AA guard. The BankState contains one local session, not a global
 * account ledger; cross-session/per-user throttling belongs in a server guard.
 */
export function assertAaLimit(s: BankState, total: number, at?: number): void {
  const yuan = Number(total);
  if (!Number.isFinite(yuan) || yuan <= 0 || yuan > 5000) return fail('AA 演示单笔总额须大于0且不超过5000元。');
  if (Math.abs(Math.round(yuan * 100) / 100 - yuan) > 1e-8) return fail('AA 金额最多支持两位小数。');
  const today = beijingDay(validAt(at));
  const count = rows(s, 'aa').filter((record) => {
    try { return beijingDay(timestamp(record.createdAt, 'AA创建时间')) === today; }
    catch { return false; }
  }).length;
  if (count >= 5) return fail('当前沙箱会话的 AA 发起次数已达每日5次演示上限；不代表跨会话或全局账户限流。');
}

const MERCHANT_CATEGORIES: Record<string, string> = {
  '校园食堂': '餐饮',
  '咖啡店': '饮品',
  '视频会员': '订阅',
};
const SYSTEM_CATEGORIES = new Set(['internal_transfer', 'investment', '转账']);

/** Categorize and append one new row without rewriting any historical rows. */
export function appendTransaction(s: BankState, row: Row): Row {
  const transactions = s.workflows?.records?.transactions;
  if (!transactions) return fail('当前沙箱没有流水记录表。');
  const duplicate = transactions.find((existing) => existing.id === row.id);
  if (duplicate) return duplicate;
  const amount = Number(row.amount);
  if (!Number.isSafeInteger(amount) || amount < 0) return fail('流水金额须为非负整数分。');

  const saved: Row = { ...row, amount };
  const category = String(row.category ?? '');
  const systemClass = SYSTEM_CATEGORIES.has(category) || SYSTEM_CATEGORIES.has(String(row.kind));
  if (systemClass) {
    // No merchant rule was applied; retain the explicit system category verbatim.
    saved.classificationSource = 'system';
    saved.confidence = 1;
    saved.needsCategoryConfirmation = false;
  } else {
    const merchant = row.merchant;
    const futureRule = rows(s, 'categories').filter((rule) =>
      rule.merchant === merchant &&
      (rule.source === '用户明确选择未来规则' || rule.source === 'user-rule' || rule.scope === 'future'),
    ).at(-1);
    const userCategory = futureRule?.category;
    const mappedCategory = typeof merchant === 'string' ? MERCHANT_CATEGORIES[merchant] : undefined;
    if (typeof userCategory === 'string' && userCategory) {
      saved.category = userCategory;
      saved.classificationSource = 'user-rule';
      saved.confidence = 1;
      saved.needsCategoryConfirmation = false;
    } else if (mappedCategory) {
      saved.category = mappedCategory;
      saved.classificationSource = 'merchant-map';
      saved.confidence = 1;
      saved.needsCategoryConfirmation = false;
    } else {
      saved.category = '未分类';
      saved.classificationSource = 'unknown';
      saved.confidence = 0;
      saved.needsCategoryConfirmation = true;
    }
  }
  transactions.push(saved);
  return saved;
}

function validTransactionPeriod(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return isValidYmd(value) ? value.slice(0, 7) : undefined;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) ? beijingMonth(epoch) : undefined;
}

function monthForPeriod(period: string): string {
  if (!/^\d{4}-\d{2}$/.test(period)) return fail('统计期间请使用 YYYY-MM 月份或 YYYY 年份。');
  const month = Number(period.slice(5));
  if (Number(period.slice(0, 4)) < 1000 || month < 1 || month > 12) return fail('统计月份无效。');
  return period;
}

function reportPeriod(p: Params, transactions: Row[], at = Date.now()): { period: string; kind: 'month' | 'year'; notice: string; source: string } {
  if (p.period != null && String(p.period) !== '') {
    const supplied = String(p.period);
    if (/^\d{4}$/.test(supplied) && Number(supplied) >= 1000) {
      return { period: supplied, kind: 'year', notice: `按指定的${supplied}年全年统计（非单月报告）。`, source: 'requested-year' };
    }
    const period = monthForPeriod(supplied);
    return { period, kind: 'month', notice: `按指定的${period}统计。`, source: 'requested-month' };
  }
  const latest = transactions.map((row) => validTransactionPeriod(row.date)).filter((x): x is string => !!x).sort().at(-1);
  if (latest) return { period: latest, kind: 'month', notice: `未指定月份，按最新流水月份${latest}统计。`, source: 'latest-transaction-month' };
  const current = beijingMonth(at);
  return { period: current, kind: 'month', notice: `未指定月份且暂无有效流水，按当前月份${current}统计。`, source: 'current-month' };
}

function previousPeriod(period: string, kind: 'month' | 'year'): string {
  if (kind === 'year') return String(Number(period) - 1).padStart(4, '0');
  const [year, month] = period.split('-').map(Number);
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
}

function inPeriod(row: Row, period: string, kind: 'month' | 'year'): boolean {
  const rowPeriod = validTransactionPeriod(row.date);
  return !!rowPeriod && (kind === 'year' ? rowPeriod.startsWith(period) : rowPeriod === period);
}

function matchesFilters(row: Row, p: Params): boolean {
  return (!p.accountId || row.accountId === p.accountId) &&
    (!p.merchant || String(row.merchant ?? '').includes(String(p.merchant))) &&
    (!p.category || p.category === '全部' || row.category === p.category);
}

function isTransferOrInvestment(row: Row): boolean {
  return row.kind === 'internal_transfer' || row.kind === 'investment' ||
    row.category === 'internal_transfer' || row.category === 'investment' || row.category === '理财';
}

function amountOf(row: Row): number {
  const amount = Number(row.amount);
  return Number.isFinite(amount) ? amount : 0;
}

type Totals = {
  grossExpenses: number;
  refunds: number;
  netExpenses: number;
  income: number;
  count: number;
  expenseCount: number;
  refundCount: number;
  categoryBreakdown: { category: string; grossExpenses: number; refunds: number; netExpenses: number }[];
};

function totalsFor(periodRows: Row[], transactions: Row[]): Totals {
  const expenses = periodRows.filter((row) => row.kind === 'expense' && !isTransferOrInvestment(row));
  const refunds = periodRows.filter((row) => row.kind === 'refund' && !isTransferOrInvestment(row));
  const income = periodRows.filter((row) => row.kind === 'income').reduce((sum, row) => sum + amountOf(row), 0);
  const categories = new Map<string, { grossExpenses: number; refunds: number }>();
  const category = (row: Row) => {
    if (typeof row.category === 'string' && row.category) return row.category;
    if (row.originalId != null) {
      const original = transactions.find((item) => item.id === row.originalId);
      if (typeof original?.category === 'string' && original.category) return original.category;
    }
    return '未分类';
  };
  for (const row of expenses) {
    const name = category(row), item = categories.get(name) ?? { grossExpenses: 0, refunds: 0 };
    item.grossExpenses += amountOf(row); categories.set(name, item);
  }
  for (const row of refunds) {
    const name = category(row), item = categories.get(name) ?? { grossExpenses: 0, refunds: 0 };
    item.refunds += amountOf(row); categories.set(name, item);
  }
  const grossExpenses = expenses.reduce((sum, row) => sum + amountOf(row), 0);
  const refundTotal = refunds.reduce((sum, row) => sum + amountOf(row), 0);
  return {
    grossExpenses,
    refunds: refundTotal,
    netExpenses: grossExpenses - refundTotal,
    income,
    count: periodRows.length,
    expenseCount: expenses.length,
    refundCount: refunds.length,
    categoryBreakdown: [...categories].map(([name, value]) => ({
      category: name,
      grossExpenses: value.grossExpenses,
      refunds: value.refunds,
      netExpenses: value.grossExpenses - value.refunds,
    })).sort((a, b) => b.netExpenses - a.netExpenses || a.category.localeCompare(b.category)),
  };
}

function yuan(cents: number): string {
  return (cents / 100).toFixed(2).replace(/\.00$/, '');
}

/**
 * Deterministic report over the current session ledger. Values remain cents;
 * no peer comparison or activity outside the supplied synthetic transactions is inferred.
 */
export function monthlyReport(s: BankState, p: Params, summary: Record<string, unknown>): Record<string, unknown> {
  const transactions = rows(s, 'transactions');
  const chosen = reportPeriod(p, transactions, businessNow(s));
  const matching = transactions.filter((row) => inPeriod(row, chosen.period, chosen.kind) && matchesFilters(row, p));
  const current = totalsFor(matching, transactions);
  const baselinePeriod = previousPeriod(chosen.period, chosen.kind);
  // A month still in progress is compared with the same days of the previous month, not with a whole month.
  const today = new Date(businessNow(s) + 8 * 3600_000).toISOString().slice(0, 10), toDate = chosen.kind === 'month' && chosen.period === today.slice(0, 7);
  const baselineRows = transactions.filter((row) => inPeriod(row, baselinePeriod, chosen.kind) && matchesFilters(row, p) && (!toDate || String(row.date).slice(8, 10) <= today.slice(8, 10)));
  const baseline = totalsFor(baselineRows, transactions);
  const hasBaseline = baselineRows.length > 0;
  const changeAmount = hasBaseline ? current.netExpenses - baseline.netExpenses : null;
  const changePercent = !hasBaseline || baseline.netExpenses === 0
    ? null
    : Number((((current.netExpenses - baseline.netExpenses) / baseline.netExpenses) * 100).toFixed(2));

  const insights: { rule: string; text: string; evidence: string }[] = [];
  if (current.grossExpenses || current.refunds) {
    insights.push({
      rule: 'refunds-offset-expenses',
      text: `${chosen.period}记录支出¥${yuan(current.grossExpenses)}，退款¥${yuan(current.refunds)}，净支出¥${yuan(current.netExpenses)}。`,
      evidence: `grossExpenses=${current.grossExpenses}分; refunds=${current.refunds}分; netExpenses=${current.netExpenses}分`,
    });
  }
  const topCategory = current.categoryBreakdown.filter((item) => item.grossExpenses || item.refunds)[0];
  if (topCategory && insights.length < 3) {
    insights.push({
      rule: 'largest-category-net',
      text: `${chosen.period}当前记录中，${topCategory.category}净支出为¥${yuan(topCategory.netExpenses)}。`,
      evidence: `category=${topCategory.category}; grossExpenses=${topCategory.grossExpenses}分; refunds=${topCategory.refunds}分; netExpenses=${topCategory.netExpenses}分`,
    });
  }
  if (hasBaseline && insights.length < 3 && changeAmount !== null) {
    const direction = changeAmount > 0 ? '增加' : changeAmount < 0 ? '减少' : '未变化';
    insights.push({
      rule: 'period-comparison',
      text: `${chosen.period}净支出较${baselinePeriod}${direction}¥${yuan(Math.abs(changeAmount))}${changePercent === null ? '；基期为0，百分比不可比' : `（${changePercent}%）`}。`,
      evidence: `currentNet=${current.netExpenses}分; baselineNet=${baseline.netExpenses}分; change=${changeAmount}分`,
    });
  }
  if (!insights.length) {
    insights.push({
      rule: 'no-recorded-expense',
      text: `${chosen.period}当前筛选范围内没有可计入消费的支出或退款记录。`,
      evidence: `matchingRows=${matching.length}; expenseRows=${current.expenseCount}; refundRows=${current.refundCount}`,
    });
  }

  const reportSummary = {
    ...summary,
    grossExpenses: current.grossExpenses,
    refunds: current.refunds,
    netExpenses: current.netExpenses,
    income: current.income,
    count: current.count,
    expenseCount: current.expenseCount,
    refundCount: current.refundCount,
    period: chosen.period,
    periodType: chosen.kind,
    category: p.category || '全部',
    countBasis: '交易笔数包括退款、收入及转移；支出笔数与退款笔数另列',
    basis: '退款冲减原支出；自有转移和理财投资不计消费；未明确用途的对外转账单列为转账，不推断用途；净额可为负数',
    coverage: '仅当前会话内可用日期的合成流水及沙箱执行记录',
  };
  return {
    period: chosen.period,
    periodType: chosen.kind,
    periodSource: chosen.source,
    periodNotice: chosen.notice,
    hasBudget: !!s.workflows?.records.budgets?.length,
    summary: reportSummary,
    categoryBreakdown: current.categoryBreakdown,
    comparison: {
      baselinePeriod,
      baselineNetExpenses: hasBaseline ? baseline.netExpenses : null,
      changeAmount,
      changePercent,
      ...(toDate ? { sameDays: `${Number(baselinePeriod.slice(5))}月1日至${Number(today.slice(8, 10))}日` } : {}),
      ...(hasBaseline ? {} : { unavailableReason: `未找到${baselinePeriod}匹配流水。` }),
      ...(hasBaseline && baseline.netExpenses === 0 ? { unavailableReason: '基期净支出为0，百分比不可比。' } : {}),
    },
    insights,
  };
}
