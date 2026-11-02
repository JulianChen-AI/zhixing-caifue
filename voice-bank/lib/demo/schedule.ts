import type { BankState, Receipt } from '../bank/types.ts';
import { availableBalance } from '../bank/accounts.ts';
import { contactsOf } from '../bank/recipients.ts';
import { appendTransaction } from '../workflows/business-lite.ts';
import type { Row } from '../workflows/types.ts';
import { businessNow } from './clock.ts';

/** Sandbox setting for a new payee's delayed arrival; not a promise of any real channel's window. */
export const NEW_PAYEE_DELAY_MINUTES = 120;

const rows = (s: BankState, kind: string) => (s.workflows!.records[kind] ||= []);
const day = (ms: number) => new Date(ms + 8 * 3600_000).toISOString().slice(0, 10);
const beijingTime = (iso: string) => new Date(Date.parse(iso) + 8 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');

/** Holds the amount and records a revocable transfer; the receipt only exists once it settles. */
export function scheduleDelayedTransfer(s: BankState, t: { id: string; recipientId: string; accountId: string; amount: number; note: string }, archive?: string) {
  const account = s.accounts.find((a) => a.id === t.accountId)!;
  account.held = (account.held || 0) + t.amount;
  const releaseAt = new Date(businessNow(s) + NEW_PAYEE_DELAY_MINUTES * 60_000).toISOString();
  const record: Row = { id: 'DT' + crypto.randomUUID().slice(0, 8).toUpperCase(), taskId: t.id, recipientId: t.recipientId, accountId: t.accountId, amount: t.amount, note: t.note, status: 'scheduled', createdAt: new Date(businessNow(s)).toISOString(), releaseAt, ...(archive ? { archive } : {}), synthetic: true };
  rows(s, 'transfers').push(record);
  return record;
}
export const delayedNotice = (r: Row) => `新收款人按延迟到账处理（演示设定）：资金已占用、尚未转出，预计北京时间 ${beijingTime(String(r.releaseAt))} 到账，到账前可以撤销。`;

/** Settle every scheduled transfer that is due; each one only once. */
export function settleDueTransfers(s: BankState, upTo: number): Row[] {
  const settled: Row[] = [];
  for (const r of rows(s, 'transfers').filter((x) => x.status === 'scheduled' && Date.parse(String(x.releaseAt)) <= upTo)) {
    const account = s.accounts.find((a) => a.id === r.accountId)!, amount = Number(r.amount);
    account.held = (account.held || 0) - amount; account.balance -= amount;
    const receipt: Receipt = { id: 'ZX' + String(r.id), taskId: String(r.taskId), recipientId: String(r.recipientId), accountId: String(r.accountId), amount, note: String(r.note || ''), createdAt: String(r.releaseAt), ...(r.archive ? { archive: String(r.archive) } : {}) };
    s.receipts.unshift(receipt);
    appendTransaction(s, { id: receipt.id, date: day(Date.parse(String(r.releaseAt))), amount, accountId: receipt.accountId, kind: 'expense', merchant: contactsOf(s).find((c) => c.id === r.recipientId)?.name || '收款人', category: '转账', relatedId: r.taskId, source: '沙箱延迟到账' });
    r.status = 'settled'; r.receiptId = receipt.id; settled.push(r);
  }
  return settled;
}

/** Run saved monthly goal deposits whose day fell in (from, to]. Each period runs once; a shortfall is recorded, never overdrawn or retried. */
export function runGoalRules(s: BankState, from: number, to: number): Row[] {
  const runs: Row[] = [];
  for (const rule of rows(s, 'rules').filter((r) => r.kind === 'goal' && r.status === 'active')) {
    const dayOfMonth = Number(String(rule.schedule || '').match(/每月\s*(\d{1,2})\s*日/)?.[1]);
    if (!dayOfMonth) continue;
    const start = rule.startDate ? Date.parse(String(rule.startDate) + 'T00:00:00+08:00') : from;
    const done = new Set(((rule.executions as Row[] | undefined) || []).map((x) => x.date));
    const cursor = new Date(Math.max(from, start) + 8 * 3600_000);
    for (let y = cursor.getUTCFullYear(), m = cursor.getUTCMonth(); ; m++) {
      const due = Date.parse(`${new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7)}-${String(dayOfMonth).padStart(2, '0')}T00:00:00+08:00`);
      if (due > to) break;
      if (due <= from || due < start || done.has(day(due))) continue;
      const goal = rows(s, 'goals').find((g) => g.id === rule.goalId), account = s.accounts.find((a) => a.id === rule.accountId);
      if (!goal || !account) break;
      const remaining = Number(goal.target) - Number(goal.balance), amount = Math.min(Number(rule.amount), remaining);
      if (remaining <= 0) { rule.status = 'completed'; break; }
      const run: Row = { id: `${rule.id}-${day(due)}`, date: day(due), amount, source: '模拟调度' };
      if (availableBalance(account) < amount) Object.assign(run, { status: 'not_executed', reason: '余额不足：未透支、未换账户，本期不补扣' });
      else {
        account.balance -= amount; goal.balance = Number(goal.balance) + amount;
        appendTransaction(s, { id: 'GR' + run.id, date: run.date, amount, accountId: account.id, kind: 'internal_transfer', merchant: String(goal.name), category: '内部转存', relatedId: goal.id, goalId: goal.id, source: '模拟调度执行' });
        run.status = 'executed';
        if (Number(goal.balance) >= Number(goal.target)) rule.status = 'completed';
      }
      rule.executions = [...((rule.executions as Row[] | undefined) || []), run]; runs.push(run); done.add(run.date);
      if (rule.status === 'completed') break;
    }
  }
  return runs;
}
