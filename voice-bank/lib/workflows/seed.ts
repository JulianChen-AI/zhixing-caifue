import { WORKFLOW_VERSION } from './catalog.ts';
import type { FlowStore } from './types.ts';
import { demoDataset, DEFAULT_ANCHOR } from '../demo/dataset.ts';

export function initialFlowStore(anchor = DEFAULT_ANCHOR): FlowStore {
  return { version: WORKFLOW_VERSION, tasks: [], currentTaskId: null, riskProfile: null, log: [], records: {
    ...demoDataset(anchor).records,
    orders:[], rules:[], reminders:[], cancellations:[], applications:[], replacements:[], bindings:[], budgets:[], contacts:[], relations:[], aa:[], questionnaires:[], education:[], categories:[], invites:[], reviewNotes:[],
  }};
}
