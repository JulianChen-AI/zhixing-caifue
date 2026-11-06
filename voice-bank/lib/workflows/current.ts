import type { BankState } from '../bank/types.ts';

export const currentWorkflow=(s:BankState)=>s.workflows?.tasks.find(t=>t.id===s.workflows!.currentTaskId);
