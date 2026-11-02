export type Params = Record<string, unknown>;
export type Row = { id: string; [key: string]: unknown };
export type ToolStep = { toolId: string; title: string; status: 'passed' | 'pending' | 'skipped' | 'blocked'; reason: string };
export type FlowStatus = 'queued' | 'collecting' | 'review' | 'authenticate' | 'complete' | 'cancelled' | 'blocked' | 'unsupported' | 'external';
export type FlowTask = {
  id: string; functionId: string; title: string; params: Params; status: FlowStatus;
  missing: string[]; steps: ToolStep[]; reviewToken: string | null; verificationId: string | null;
  confirmedToken: string | null; result: unknown; message: string; createdAt: string;
  fieldEvidence?: Record<string,{source:'user-card'|'utterance'|'calculation'|'model-proposal'|'saved-template';quote:string;value?:unknown}>;
  clarificationFields?: string[];
  queryClarification?: {field:'period'|'merchant'|'category';message:string};
  queryClarifications?: {field:'period'|'merchant'|'category';message:string}[];
  recipientChoices?: string[];
  riskSignals?: string[];
  limitations?: string[];
  legacyTaskId?: string; legacyReviewToken?: string;
};
export type FlowStore = {
  version: string; tasks: FlowTask[]; currentTaskId: string | null;
  records: Record<string, Row[]>; riskProfile: { level: number; validUntil: string; answers: number[] } | null;
  log: { id: string; at: string; taskId: string; operation: string; status: string; reason: string;revision?:number }[];
};
export type WorkflowCommand = {
  operation: 'list' | 'describe' | 'run' | 'amend' | 'confirm' | 'authenticate' | 'cancel' | 'resume' | 'status' | 'settle';
  functionId?: string; taskId?: string; params?: Params; token?: string; code?: string;
  source: 'card' | 'voice' | 'plan'; utterance?: string; history?: string[];turnId?:string;
};
export class WorkflowError extends Error { constructor(message: string, public status = 400, public field?: string) { super(message); } }

