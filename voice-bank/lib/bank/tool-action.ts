import { z } from 'zod';
import type { BankAction, BankState } from './types.ts';
import { realtimeToolArgumentsEnvelope, realtimeToolArgumentsFor, realtimeToolDecision } from './realtime-tools.ts';
import { workflowToolArguments } from '../workflows/realtime.ts';
import { planToolArguments } from '../plans/schema.ts';
import { isComplexRequest } from '../plans/decompose.ts';
import { activePlan } from '../plans/engine.ts';
import { contactsOf } from './recipients.ts';

const context = { utterance: z.string().max(2000), history: z.array(z.string().max(1000)).max(8).optional(), turnId: z.string().min(1).max(200).optional() };
export const toolCall = z.discriminatedUnion('name', [
 z.object({ name: z.literal('bank_plan'), arguments: planToolArguments, ...context }).strict(),
 z.object({ name: z.literal('bank_request'), arguments: realtimeToolArgumentsEnvelope, ...context }).strict(),
 z.object({ name: z.literal('bank_function'), arguments: workflowToolArguments, ...context }).strict(),
]);
export type ToolCall = z.infer<typeof toolCall>;

/** One mapping for every voice tool caller, so delegated calls meet the same deterministic guards. Undefined is a pure state read. */
export function toolAction(state: BankState, tool: ToolCall): BankAction | undefined {
 if (tool.name === 'bank_request') realtimeToolArgumentsFor(contactsOf(state)).parse(tool.arguments);
 if (tool.name === 'bank_plan') return { type: 'plan', command: { ...tool.arguments, source: 'voice', utterance: tool.utterance, turnId: tool.turnId } };
 if (!activePlan(state) && ['run', 'update_transfer'].includes(tool.arguments.operation) && isComplexRequest(tool.utterance, state)) return { type: 'plan', command: { operation: 'create', source: 'voice', utterance: tool.utterance, turnId: tool.turnId } };
 if (tool.name === 'bank_function') return { type: 'workflow', command: { ...tool.arguments, source: 'voice', utterance: tool.utterance, history: tool.history, turnId: tool.turnId } };
 if (tool.arguments.operation === 'get_state') return;
 return { type: 'route', decision: realtimeToolDecision(tool.arguments, state, tool.utterance, tool.history) };
}
