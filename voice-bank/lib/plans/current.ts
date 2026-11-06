import type { BankState } from '../bank/types.ts';
import type { TaskPlan } from './types.ts';

const terminal=(p:TaskPlan)=>['complete','cancelled'].includes(p.status);
export const activePlan=(s:BankState)=>s.plan&&!terminal(s.plan)?s.plan:undefined;
export const currentPlanStep=(s:BankState)=>activePlan(s)?.steps.find(x=>x.kind==='clarify'&&!['complete','cancelled'].includes(x.status))||activePlan(s)?.steps.find(x=>!['complete','cancelled'].includes(x.status));
