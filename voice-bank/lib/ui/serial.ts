import type { BankState } from '../bank/types.ts';

/** Exactly one current business surface; transport and history are separate. */
export function currentSurface(bank: BankState): 'welcome' | 'question' | 'paused' | 'workflow' | 'legacy' {
  if (bank.view === 'home') return 'welcome';
  const plan = bank.plan;
  if (plan && !['complete', 'cancelled'].includes(plan.status)) {
    if (plan.status === 'paused') return 'paused';
    const step = plan.steps.find(item => item.id === plan.currentTaskId || item.taskId === plan.currentTaskId);
    if (step && step.kind !== 'workflow') return 'question';
  }
  return bank.view === 'workflow' ? 'workflow' : 'legacy';
}

