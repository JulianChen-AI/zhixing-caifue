'use client';
import { useState } from 'react';
import { XCircle } from 'lucide-react';
import type { BankAction, BankState } from '@/lib/bank/types';
import type { FlowTask } from '@/lib/workflows/types';
import { taskIdentity } from '@/lib/ui/business';

type Choice = { label: string; run: () => void; primary?: boolean };

/**
 * One-step exit from the business in progress. Drafts that are still being filled end at once; a card at
 * review or authentication asks once, because that is where a stray tap would discard a checked summary.
 * Nothing here can reach a submitted result: the engine refuses to cancel completed or external work.
 */
export function CancelTask({ busy, ask, summary, choices }: { busy: boolean; ask: boolean; summary: string; choices: Choice[] }) {
  const [open, setOpen] = useState(false);
  const single = choices.length === 1 && !ask;
  return <>
    <button type="button" className="text-button cancel-task" disabled={busy} aria-expanded={single ? undefined : open} onClick={() => single ? choices[0].run() : setOpen(!open)}><XCircle aria-hidden size={14}/>取消当前任务</button>
    {open && <div className="cancel-confirm" role="alertdialog" aria-label="确认取消">
      <p>{summary}还没提交，取消后不会扣款或改动任何设置。</p>
      <div className="cancel-confirm-actions">
        {choices.map(choice => <button type="button" key={choice.label} className={choice.primary ? 'danger-button' : 'secondary-button'} disabled={busy} onClick={() => { setOpen(false); choice.run(); }}>{choice.label}</button>)}
        <button type="button" className="text-button" disabled={busy} onClick={() => setOpen(false)}>继续办理</button>
      </div>
    </div>}
  </>;
}

/** Shown on the home screen once a card is collapsed: continue or drop the latest unfinished business without reopening it. */
export function PendingBar({ bank, tasks, busy, onAction, onAll }: { bank: BankState; tasks: FlowTask[]; busy: boolean; onAction: (action: BankAction) => Promise<void>; onAll: () => void }) {
  const task = tasks.at(-1);
  if (!task) return null;
  const who = taskIdentity(bank, task);
  return <div className="pending-bar" role="group" aria-label="未完成业务">
    <span className="pending-bar-title"><b>未完成</b>{who.title}{who.detail && <small>{who.detail}</small>}</span>
    <span className="pending-bar-actions">
      <button type="button" className="text-button" disabled={busy} onClick={() => void onAction({ type: 'workflow', command: { operation: 'resume', taskId: task.id, source: 'card' } })}>继续</button>
      <CancelTask busy={busy} ask={['review', 'authenticate'].includes(task.status)} summary={`“${who.title}”`} choices={[{ label: '放弃办理', primary: true, run: () => void onAction({ type: 'workflow', command: { operation: 'cancel', taskId: task.id, source: 'card' } }) }]}/>
      {tasks.length > 1 && <button type="button" className="text-button" onClick={onAll}>全部 {tasks.length} 项</button>}
    </span>
  </div>;
}
