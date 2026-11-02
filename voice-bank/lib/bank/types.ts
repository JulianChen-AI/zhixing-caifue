import type { ChecklistRun } from '../checklists/evaluate.ts';
import type { Evidence, RoutingDecision } from '../checklists/routing.ts';
import type { FlowStore, WorkflowCommand } from '../workflows/types.ts';
import type { TaskPlan, PlanCommand } from '../plans/types.ts';
export type Contact = { id: string; name: string; label: string; bank: string; tail: string; color: string; previouslyUsed: boolean; accountRef?: string; source?: string; saved?: boolean; aliases?: { names?: string[]; labels?: string[] } };
/** held: accepted but unsettled purchases. The book balance keeps them until settlement. */
export type Account = { id: string; name: string; tail: string; balance: number; held?: number };
export type Step = "recipient" | "details" | "review" | "authenticate" | "complete" | "cancelled";
export type TransferTask = {
  policyVersion: string; id: string; step: Step; recipientId: string | null; amount: number | null; accountId: string | null;
  riskSignals: string[]; amountNeedsConfirmation?: boolean; reviewToken?: string | null;
  note: string; confirmedRevision: number | null; verificationId: string | null;
};
export type Receipt = { id: string; taskId: string; recipientId: string; accountId: string; amount: number; note: string; createdAt: string; archive?: string };
export type AuditEntry = { id: string; at: string; action: string; workflowId: string; policyVersion: string; outcome: string; reason: string | null; fromStep: Step | null; toStep: Step | null; checks: ChecklistRun['checks']; evidence: Evidence[] };
export type DelegationRequest={id:string;utterance:string;turnId:string;sceneEpoch?:string;kind:'business'|'control';status:'pending'|'waiting'|'paused'|'done'|'unknown';taskIds:string[];functions:string[];stopReason?:string;resumes?:string};
export type BankState = { policyVersion: string; routing: RoutingDecision | null; checklist: ChecklistRun | null; audit: AuditEntry[]; revision: number; demoClock?: string; sceneId?: string; sceneVersion?: string; sceneEpoch?: string; lastDemoControl?: { requestId: string; type: "load_scene" | "advance_clock" | "reset"; actionFingerprint: string; sourceEpoch: string | null; resultEpoch: string; resultRevision: number }; contacts?: Contact[]; accounts: Account[]; task: TransferTask | null; receipts: Receipt[]; lastReply: string; view: "home" | "balance" | "transfer" | "workflow"; recentRequestIds: string[]; workflows?: FlowStore; plan?:TaskPlan|null; monthlyHistory?:Record<string,TaskPlan>;delegationRequests?:DelegationRequest[] };
export type Intent = { kind: "transfer" | "amend" | "cancel" | "balance" | "help" | "confirm_amount" | "confirm_transfer"; amountInferred?: boolean; amount?: number | null; recipientId?: string | null; accountId?: string | null; note?: string | null };
export type BankAction =
  | { type: 'delegation_request'; request:DelegationRequest }
  | { type: 'load_scene'; sceneId: string }
  | { type: 'advance_clock'; to: string }
  | { type: 'plan'; command: PlanCommand }
  | { type: 'workflow'; command: WorkflowCommand }
  | { type: 'route'; decision: RoutingDecision }
  | { type: "intent"; intent: Intent }
  | { type: "select_recipient"; recipientId: string }
  | { type: "edit"; amount?: number; accountId?: string; note?: string | null }
  | { type: "confirm" }
  | { type: "authenticate"; code: string; verificationId: string }
  | { type: "cancel" }
  | { type: "reset" }
  | { type: "home" };

export const CONTACTS: Contact[] = [
  { id: "zhang-roommate", name: "张三", label: "室友", bank: "招商银行", tail: "6688", color: "blue", previouslyUsed: true },
  { id: "zhang-landlord", name: "张三", label: "房东", bank: "工商银行", tail: "2910", color: "violet", previouslyUsed: true },
  { id: "li-friend", name: "李四", label: "同学", bank: "建设银行", tail: "0826", color: "mint", previouslyUsed: true },
];
