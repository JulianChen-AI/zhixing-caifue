// Eval wrapper around lib/voice/intent-json.ts: per-case conversation memory plus commit through the reducer.
import type { BankAction, BankState } from '../../lib/bank/types.ts';
import { applyIntent, understandIntent, type Intent } from '../../lib/voice/intent-json.ts';

type Provider = { base: string; key?: string; planner: string };
export type JsonTurn = { summary: string; asked: boolean; intent: Intent | null; dropped: string[] };

export function jsonAgent(provider: Provider) {
 const threads = new Map<string, { user: string; reply: string }[]>();
 return async function turn(thread: string, utterance: string, deps: { state: () => BankState; commit: (action: BankAction) => void }, signal: AbortSignal): Promise<JsonTurn> {
  const history = threads.get(thread) || [];
  const understood = await understandIntent(deps.state(), utterance, history, provider, signal), { intent, action, dropped, say } = understood;
  let summary = say;
  if (action) {
   try {
    await applyIntent(understood, deps.commit);
    const after = deps.state(), task = after.workflows?.tasks.find(t => t.id === after.workflows?.currentTaskId);
    summary = task?.message || after.lastReply || say;
   } catch (error) { summary = error instanceof Error ? error.message : String(error); }
  }
  const after = deps.state(), task = after.workflows?.tasks.find(t => t.id === after.workflows?.currentTaskId);
  history.push({ user: utterance, reply: summary.slice(0, 200) }); threads.set(thread, history);
  return { summary, asked: intent?.intent === 'ask' || task?.status === 'collecting', intent, dropped };
 };
}
