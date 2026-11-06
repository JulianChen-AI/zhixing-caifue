// Server wiring for the IM handler: the App's own intent layer, engine and session store.
import { commit, provider, runtimeEnv, type DemoSession } from '../bank/server';
import { dispatchAction } from '../plans/dispatch';
import { offlineWorkflow, workflowTextAction } from '../workflows/offline';
import { understandIntent, type IntentResult } from '../voice/intent-json';
import type { BankState } from '../bank/types';
import type { ImDeps, ImSession } from './handler';

/** Qwen JSON intent when configured; otherwise the offline demo rules, so the channel still answers without a model. */
async function understand(state: BankState, text: string, signal: AbortSignal): Promise<IntentResult> {
 const p = provider();
 if (p.ready && p.intent === 'json') return understandIntent(state, text, [], p, signal);
 const command = workflowTextAction(state, text) || offlineWorkflow(text, state);
 return command ? { intent: null, action: { type: 'workflow', command }, dropped: [], say: '' } : { intent: null, dropped: ['offline'], say: '没听懂想办什么，可以说“查余额”或“给室友张三转200”。' };
}
export function imSession(session: DemoSession): ImSession {
 return { state: session.state, commit: async (action, requestId) => { const next = await commit(session, action, session.state.revision, requestId); session.state = next; return next; } };
}
export function imDeps(req: Request, session: (owner: string) => Promise<ImSession>): ImDeps {
 const env = { ...process.env, ...runtimeEnv() } as unknown as Record<string, string | undefined>;
 return { secret: env.IM_WEBHOOK_SECRET || undefined, now: Date.now, appUrl: env.IM_APP_URL || new URL('/', req.url).toString(), session,
  understand: (state, text) => understand(state, text, req.signal), dispatch: (state, action, text) => dispatchAction(state, action, text) };
}
