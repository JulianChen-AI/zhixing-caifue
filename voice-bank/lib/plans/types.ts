import type { Params } from '../workflows/types.ts';

export type PlanStatus='collecting'|'running'|'paused'|'blocked'|'complete'|'cancelled';
export type PlanStepStatus='pending'|'collecting'|'review'|'authenticate'|'complete'|'blocked'|'external'|'cancelled';
export type BalanceFormula={selector:'lowest'|'highest'|'explicit';accountId?:string;numerator:number;denominator:number};
export type Calculation={accountId:string;amountCents:number;balanceCents:number;numerator:number;denominator:number;rounding:'down-to-cent';remainder:number;snapshot:{id:string;balance:number}[];revision:number};
export type PlanStep={id:string;kind:'workflow'|'calculation'|'clarify';title:string;quote:string;functionId?:string;params:Params;dependsOn:string[];status:PlanStepStatus;taskId?:string;openedTurnId?:string;formula?:BalanceFormula;calculation?:Calculation;binding?:string;question?:string;result?:unknown;inserted?:boolean;pauseAfter?:boolean};
export type TaskPlan={monthly?:{period:string;templateId:string;savingsFailed?:boolean;rentUnknown?:boolean};id:string;layer:'double';status:PlanStatus;steps:PlanStep[];message:string;createdAt:string;version?:3;taskIds?:string[];currentTaskId?:string;announcements?:string[];returnTo?:TaskPlan;parked?:TaskPlan[];interruptionResults?:{id:string;status:PlanStatus;taskIds:string[]}[];lastUserTurnId?:string;summaryTurnIds?:string[];confirmations?:{turnId:string;taskId:string;token:string}[];log:{at:string;stepId?:string;event:string;reason:string}[]};
export type PlanProposal={quote:string;functionId:string;params?:Params};
export type PlanCommand={operation:'create'|'interrupt'|'amend'|'status'|'resume'|'pause'|'cancel'|'open_saved';planId?:string;stepId?:string;taskId?:string;functionId?:string;adoptTaskId?:string;params?:Params;steps?:PlanProposal[];tasks?:PlanProposal[];source:'voice'|'card';utterance?:string;clarification?:string;turnId?:string;prerequisite?:boolean;/** A computed summary said before the first card, such as a month draft. */lead?:string};

