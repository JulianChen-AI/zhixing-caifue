import type { BankState } from '../bank/types.ts';
import type { FlowTask, Params } from '../workflows/types.ts';
import { workflowReview } from '../workflows/review.ts';
import { isWrite } from '../workflows/write-kind.ts';

export function reviewEntries(bank: BankState, task: FlowTask) {
  return workflowReview(bank, task).entries.filter(entry =>
    entry.value !== '未填写' && !(entry.key === 'note' && entry.value === '无') &&
    !(['saveRecipient', 'autoSave'].includes(entry.key) && entry.value === '否'));
}

/** IDs stay in business state; task navigation uses the same readable facts as review. */
export function taskIdentity(bank: BankState, task: Pick<FlowTask, 'title' | 'functionId' | 'params'>) {
  const entries = workflowReview(bank, task).entries;
  const value = (key: string) => entries.find(entry => entry.key === key)?.value || '';
  const money = ['amount', 'total', 'target'].map(value).find(Boolean);
  const subject = ['recipientId', 'productId', 'cardId', 'goalId', 'subscriptionId', 'name'].map(value).find(Boolean);
  return { title: subject ? `${task.title} · ${subject}` : task.title,
    detail: [money, value('accountId')].filter(Boolean).join(' · ') };
}

export function localDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return value;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date);
}

export function changedFields(draft: Params, saved: Params): Params {
  return Object.fromEntries(Object.entries(draft).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(saved[key])));
}

/** A one-off read may finish while the scheduler correctly retains the old draft.
 * Present that read without changing the backend task, review token or queue. */
export function completedSideQuery(previous: BankState | null, next: BankState) {
  if (!previous) return undefined;
  // A query that finished on the way to another card, whether asked in between or as the first step of a
  // multi-step request, shows its result instead of being passed over.
  const known = new Set(previous.workflows?.tasks.map(task => task.id));
  return next.workflows?.tasks.find(task => !known.has(task.id) && task.status === 'complete' && !isWrite(task) && task.id !== next.workflows?.currentTaskId);
}
