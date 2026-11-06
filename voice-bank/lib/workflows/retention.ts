// A bill query's result copies its ledger rows, on the task and again on its plan step, and every request reads,
// rewrites and returns the whole session. Only the latest queries keep their rows; older ones keep the totals.
// The ledger itself stays in records.transactions, so nothing is lost and a repeated question gets the rows back.
import type { BankState } from '../bank/types.ts';

export const KEPT_STATEMENTS = 3;
const FINISHED = ['complete', 'cancelled'];

const rowsOf = (result: unknown) => {
 const list = (result as { transactions?: unknown } | null | undefined)?.transactions;
 return Array.isArray(list) ? list.length : 0;
};
const trimmed = (result: unknown) => {
 const value = result as Record<string, unknown>;
 return { ...value, transactions: [], transactionsTrimmed: (value.transactions as unknown[]).length };
};

/** Returns the same state when there is nothing to trim. Never touches records, balances or task status. */
export function trimOldStatements<T extends BankState>(s: T): T {
 const flow = s.workflows;
 if (!flow) return s;
 const plan = s.plan && !FINISHED.includes(s.plan.status) ? s.plan : null;
 const active = new Set(plan?.steps.map(step => step.taskId).filter(Boolean));
 const withRows = flow.tasks.filter(t => rowsOf(t.result)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
 const keep = new Set(withRows.slice(-KEPT_STATEMENTS).map(t => t.id));
 const held = (id?: string | null) => !!id && (keep.has(id) || active.has(id) || id === flow.currentTaskId);
 const tasks = flow.tasks.some(t => rowsOf(t.result) && !held(t.id))
  ? flow.tasks.map(t => rowsOf(t.result) && !held(t.id) ? { ...t, result: trimmed(t.result) } : t)
  : flow.tasks;
 // A step outlives its task once the task history is capped, so a step without a kept task is trimmed too.
 const steps = s.plan?.steps.some(x => rowsOf(x.result) && !held(x.taskId))
  ? s.plan.steps.map(x => rowsOf(x.result) && !held(x.taskId) ? { ...x, result: trimmed(x.result) } : x)
  : s.plan?.steps;
 if (tasks === flow.tasks && steps === s.plan?.steps) return s;
 return { ...s, workflows: { ...flow, tasks }, ...(s.plan ? { plan: { ...s.plan, steps: steps! } } : {}) };
}
