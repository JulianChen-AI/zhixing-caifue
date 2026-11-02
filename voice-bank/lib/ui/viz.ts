/** Pure geometry for the card visuals. Nothing here decides whether a business may run. */
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export type Segment = { label: string; value: number; share: number; slot: number };

/** Part-to-whole in the caller's order, so a hue follows its entity; a ninth series folds into "其他". */
export function segments(rows: { label: string; value: number }[]): Segment[] {
  const positive = rows.filter(row => row.value > 0);
  const keep = new Set(positive.length > 8 ? [...positive].sort((x, y) => y.value - x.value).slice(0, 7) : positive);
  const tail = positive.filter(row => !keep.has(row)).reduce((sum, row) => sum + row.value, 0);
  const kept = [...positive.filter(row => keep.has(row)), ...(tail ? [{ label: '其他', value: tail }] : [])];
  const total = kept.reduce((sum, row) => sum + row.value, 0);
  return kept.map((row, index) => ({ ...row, share: total ? row.value / total : 0, slot: index + 1 }));
}

/** Net spending per day. Refunds offset the day they land on, so a day can be negative. */
export function dailyNet(transactions: unknown): { date: string; value: number }[] {
  const days = new Map<string, number>();
  for (const item of Array.isArray(transactions) ? transactions.map(record) : []) {
    if (typeof item.date !== 'string' || typeof item.amount !== 'number') continue;
    const sign = item.kind === 'expense' ? 1 : item.kind === 'refund' ? -1 : 0;
    if (sign) days.set(item.date, (days.get(item.date) || 0) + sign * item.amount);
  }
  return [...days].map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date));
}

export type DayCell = { day: number; date: string; events: { name: string; amount: number }[] } | null;

/** One month as Monday-first weeks. Only the events given appear; no date is moved or invented. */
export function monthGrid(month: string, events: { date: string; name: string; amount: number }[]): DayCell[] {
  const [year, index] = month.split('-').map(Number);
  const first = (new Date(Date.UTC(year, index - 1, 1)).getUTCDay() + 6) % 7, length = new Date(Date.UTC(year, index, 0)).getUTCDate();
  const cells: DayCell[] = Array.from({ length: first }, () => null);
  for (let day = 1; day <= length; day++) {
    const date = `${month}-${String(day).padStart(2, '0')}`;
    cells.push({ day, date, events: events.filter(item => item.date === date).map(({ name, amount }) => ({ name, amount })) });
  }
  return cells;
}

/** Months covered by the events, in order. */
export function eventMonths(events: { date: string }[]) {
  return [...new Set(events.map(item => item.date.slice(0, 7)).filter(month => /^\d{4}-\d{2}$/.test(month)))].sort();
}

/** Running principal per period; at most twelve columns, always ending exactly on the total. */
export function cumulativeSteps(total: number, periods: number) {
  const count = Math.max(1, Math.min(12, Math.floor(periods) || 1)), full = Math.max(1, Math.floor(periods) || 1);
  return Array.from({ length: count }, (_, i) => {
    const period = Math.round((i + 1) * full / count);
    return { period, value: Math.round(total * period / full) };
  });
}

export const clampRatio = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

/** Where an order stands: acceptance is its own step and never reads as a completed trade. */
export function orderSteps(order: unknown): { label: string; state: 'done' | 'current' | 'todo' | 'void' }[] {
  const row = record(order), stage = row.businessStage, redeem = row.action === 'redeem';
  const last = redeem ? '资金到账' : '份额确认';
  if (stage === 'cancelled') return [{ label: '已提交', state: 'done' }, { label: '已撤销', state: 'void' }];
  if (stage === 'shares_confirmed' || stage === 'funds_arrived') return [{ label: '已提交', state: 'done' }, { label: '已受理', state: 'done' }, { label: last, state: 'done' }];
  if (stage === 'accepted') return [{ label: '已提交', state: 'done' }, { label: '已受理', state: 'current' }, { label: last, state: 'todo' }];
  return [{ label: '已提交', state: 'done' }, { label: '结果待核对', state: 'current' }, { label: last, state: 'todo' }];
}

/** The steps of a write on one line. Reading it grants nothing; the engine holds the gates. */
export function writeSteps(status: string, needsAuth: boolean): { label: string; state: 'done' | 'current' | 'todo' }[] {
  const order = ['collecting', 'review', ...(needsAuth ? ['authenticate'] : []), 'complete'];
  const labels: Record<string, string> = { collecting: '填写', review: '核对', authenticate: '认证', complete: '回执' };
  const at = order.indexOf(status);
  return order.map((key, index) => ({ label: labels[key], state: at < 0 ? 'todo' : index < at || status === 'complete' ? 'done' : index === at ? 'current' : 'todo' }));
}
