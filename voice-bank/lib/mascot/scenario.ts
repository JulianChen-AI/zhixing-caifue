import type { BankState } from '../bank/types.ts';

export type MascotAction = 'idle' | 'listening' | 'thinking' | 'speaking' | 'waiting' | 'processing' | 'success' | 'risk' | 'blocked' | 'comfort' | 'encouragement' | 'growth' | 'savings' | 'guard' | 'umbrella';
export type MascotCue = { action: MascotAction; key: string; fallback?: MascotAction };
export type MascotContext = { bank: BankState | null; phase: string; mode: string; muted: boolean; busy: boolean; connecting: boolean; closing: boolean; recovering: boolean; error: string };

/** Visual feedback uses server-owned facts, never the assistant's prose. */
export function mascotCue(c: MascotContext): MascotCue {
  const bank = c.bank;
  const flow = bank?.view === 'workflow' ? bank.workflows?.tasks.find(t => t.id === bank.workflows?.currentTaskId) : undefined;
  const transfer = bank?.view === 'transfer' ? bank.task : undefined;
  const background: MascotAction = c.phase === 'speaking' ? 'speaking' : c.mode === 'live' && !c.muted && c.phase === 'listening' ? 'listening' : 'idle';
  const cue = (action: MascotAction, key: string = action): MascotCue => ({ action, key, fallback: action === 'blocked' || action === 'risk' ? 'waiting' : background });
  const taskKey = flow?.id || transfer?.id || 'none';
  // A risk stop must remain legible while the voice explains it.
  if (flow?.status === 'blocked' && flow.riskSignals?.length || transfer?.riskSignals.length && bank?.checklist?.outcome === 'blocked') return cue('blocked', `blocked:${taskKey}`);
  if (c.error) return cue('comfort', `error:${c.error}`);
  if (c.recovering) return cue('umbrella');
  if (c.connecting || c.closing) return cue('thinking');
  if (c.busy) return cue('processing');
  if (c.phase === 'checking' || c.phase === 'thinking') return cue('thinking');
  if (flow?.status === 'blocked' || flow?.status === 'unsupported' || flow?.status === 'external') return cue('comfort', `${flow.status}:${taskKey}`);
  if (flow?.riskSignals?.length || transfer?.riskSignals.length) return cue('risk', `risk:${taskKey}`);
  if (flow?.status === 'review' || flow?.status === 'authenticate' || transfer?.step === 'review' || transfer?.step === 'authenticate') return cue('waiting');
  if (flow?.status === 'complete') {
    const key = `complete:${flow.id}`;
    const resultStatus = (flow.result as { status?: string } | null)?.status;
    if (resultStatus && ['pending', 'processing', 'submitted'].includes(resultStatus)) return cue('waiting');
    // A budget is a label, not a paid or frozen amount.
    if(flow.functionId==='BI08')return cue('idle');
    // These special gestures describe completed sandbox operations only.
    if (flow.functionId === 'IN02' && flow.params.direction === 'deposit') return cue('savings', key);
    if (flow.functionId === 'IN03' && Number((flow.result as { progress?: number } | null)?.progress) >= 1) return cue('growth', key);
    if (flow.functionId === 'IN15') return cue('encouragement', key);
    if (flow.functionId === 'CA07' || flow.functionId === 'CA06' && flow.params.action === 'freeze') return cue('guard', key);
    // Reading a balance/catalog is not a completed financial transaction.
    if (flow.confirmedToken || flow.functionId === 'TR03' && bank?.receipts.some(r => r.taskId === flow.legacyTaskId)) return cue('success', key);
  }
  if (transfer?.step === 'complete' && bank?.receipts.some(r => r.taskId === transfer.id)) return cue('success', `complete:${transfer.id}`);
  if (c.phase === 'speaking') return cue('speaking');
  if (c.mode === 'live' && !c.muted && c.phase === 'listening') return cue('listening');
  return cue('idle');
}
