import type { BankAction, BankState } from '../bank/types.ts';
import { businessNow } from '../demo/clock.ts';

/**
 * Guided handling for two blocks the user can clear themselves: an investment plan without a valid
 * risk assessment opens the assessment first; a replacement card for a card not yet reported lost
 * opens the formal report first. The original task stays in the plan and is re-checked afterwards.
 * Runs inside reduceBank, so voice, delegation, tool calls and card clicks all get the same guidance.
 * A prerequisite the user already cancelled for this checklist is not offered again.
 * Every step still needs its own review and authentication; nothing is confirmed on the user's behalf.
 */
export function prerequisiteAction(s: BankState, utterance: string): BankAction | undefined {
 const wf = s.workflows, task = wf?.tasks.find(t => t.id === wf.currentTaskId);
 if (!task || task.status !== 'blocked') return;
 const declined = (functionId: string) => s.plan?.steps.some(x => x.inserted && x.functionId === functionId && x.status === 'cancelled');
 // Any investment held back for the assessment (定投, 购买), not just one function.
 if (/^IN/.test(task.functionId) && /风险测评/.test(task.message || '') && !declined('IN05')) {
  const profile = wf!.riskProfile;
  if (!profile || Date.parse(profile.validUntil) < businessNow(s)) return interrupt('IN05', { action: 'assess' }, utterance);
 }
 if (task.functionId === 'CA08' && task.params.action === 'request') {
  const card = wf!.records.cards?.find(c => c.id === task.params.cardId) as { status?: string; restriction?: string } | undefined;
  if (card && card.status !== 'lost' && card.restriction !== 'judicial' && !declined('CA07')) return interrupt('CA07', { action: 'report', cardId: task.params.cardId }, utterance);
 }
}
const interrupt = (functionId: string, params: Record<string, unknown>, utterance: string): BankAction => ({ type: 'plan', command: { operation: 'interrupt', functionId, params, source: 'card', utterance, prerequisite: true } });
