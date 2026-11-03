import type { BankState } from '../bank/types.ts';
import type { FlowTask } from '../workflows/types.ts';
import type { PlanStep } from '../plans/types.ts';
import { isWrite } from '../workflows/adapters.ts';
import { taskIdentity } from './business.ts';
import { contactsOf } from '../bank/recipients.ts';

/** Visual tone only; it never decides whether anything may run. */
export type Tone = 'ok' | 'wait' | 'pending' | 'info' | 'risk' | 'muted' | 'active' | 'sim' | 'calc';
export type Badge = { label: string; tone: Tone };

const resultStatus = (value: unknown) => (value && typeof value === 'object' ? (value as { status?: unknown; businessStage?: unknown }) : {});

/**
 * Reads the outcome a user may rely on. Acceptance, pending settlement and unknown results
 * are never shown as success; only a returned sandbox result of a write counts as done.
 */
export function outcomeBadge(bank: BankState, task: Pick<FlowTask, 'functionId' | 'params' | 'status' | 'result'> & { legacyTaskId?: string }): Badge {
  const result = resultStatus(task.result);
  if (result.status === 'unknown') return { label: '结果待核对', tone: 'wait' };
  if (result.status === 'failed') return { label: '失败 · 未划款', tone: 'risk' };
  if ((result.status === 'pending' || result.businessStage === 'accepted') && task.functionId === 'SU04') return { label: '取消待核对', tone: 'wait' };
  if (result.status === 'pending' || result.businessStage === 'accepted') return { label: '已受理 · 待结算', tone: 'pending' };
  switch (task.status) {
    case 'complete':
      if (!isWrite(task)) return { label: '已查询', tone: 'info' };
      // Name the business result, so a finished cancellation never reads like an abandoned task.
      if (task.functionId === 'SU04') return { label: '代扣已解除', tone: 'ok' };
      if (task.functionId === 'SU06') return { label: '代扣已恢复', tone: 'ok' };
      if (task.functionId === 'CA06') return task.params.action === 'unfreeze' ? { label: '已解冻', tone: 'ok' } : { label: '已临时冻结', tone: 'ok' };
      if (task.functionId === 'CA07') return { label: '已挂失', tone: 'ok' };
      if (task.functionId === 'TR03') return bank.receipts.some(r => r.taskId === task.legacyTaskId) ? { label: '已转出', tone: 'ok' } : { label: '已返回结果', tone: 'ok' };
      return { label: '已完成', tone: 'ok' };
    case 'review': return { label: '待你确认', tone: 'active' };
    case 'authenticate': return { label: '待验证身份', tone: 'active' };
    case 'collecting': return { label: '待补充', tone: 'active' };
    case 'queued': return { label: '等待前序', tone: 'muted' };
    case 'external': return task.functionId === 'SU04' ? { label: '需到平台处理', tone: 'pending' } : { label: '待你处理', tone: 'pending' };
    case 'blocked': return { label: '暂无法办理', tone: 'risk' };
    case 'unsupported': return { label: '暂不可用', tone: 'muted' };
    // The task was dropped before submission: nothing happened, which is not the same as a business being cancelled.
    case 'cancelled': return { label: '未办理', tone: 'muted' };
  }
  return { label: '待办理', tone: 'muted' };
}

export type Station = { id: string; index: number; title: string; badge: Badge; current: boolean; write: boolean };

/** A plan with two or more businesses, as stations; steps without a task keep their own status. */
export function planStations(bank: BankState): Station[] {
  const plan = bank.plan;
  if (!plan) return [];
  const steps = plan.steps.filter((step: PlanStep) => step.kind === 'workflow');
  if (steps.length < 2) return [];
  const tasks = bank.workflows?.tasks || [];
  return steps.map((step, index) => {
    const task = tasks.find(item => item.id === step.taskId);
    const badge = task?.status === 'queued' ? { label: step.dependsOn.length ? '等待前序' : '未开始', tone: 'muted' as Tone }
      : task ? outcomeBadge(bank, task)
      : step.status === 'pending' ? { label: '待办理', tone: 'muted' as Tone }
      : outcomeBadge(bank, { functionId: step.functionId || '', params: step.params, status: step.status, result: step.result });
    return { id: step.id, index: index + 1, title: step.title, badge, current: !!step.taskId && step.taskId === bank.workflows?.currentTaskId && !['complete', 'cancelled'].includes(task?.status || step.status), write: !!step.functionId && isWrite({ functionId: step.functionId, params: step.params }) };
  });
}

export type RecordRow = { id: string; title: string; detail: string; badge: Badge; at: string; reference?: string };

/**
 * User-facing receipts: what was submitted and what came back, newest first. Internal audit
 * entries are deliberately not part of this list. Times come only from the business result or
 * receipt, so a scene's business clock is never mixed with the device clock.
 */
export function recentRecords(bank: BankState, limit = 6): RecordRow[] {
  const all = bank.workflows?.tasks || [];
  // Only what came back from a submission; drafts dropped before submission are not receipts.
  const tasks = all.filter(task => isWrite(task) && ['complete', 'external', 'blocked'].includes(task.status) && task.result != null);
  const rows: RecordRow[] = tasks.map(task => {
    const identity = taskIdentity(bank, task), result = resultStatus(task.result) as { id?: unknown; originalTransferId?: unknown; createdAt?: unknown };
    const receipt = task.functionId === 'TR03' ? bank.receipts.find(r => r.taskId === task.legacyTaskId) : undefined;
    const reference = receipt?.id || (typeof result.originalTransferId === 'string' ? result.originalTransferId : typeof result.id === 'string' ? result.id : undefined);
    return { id: task.id, title: identity.title, detail: identity.detail, badge: outcomeBadge(bank, task), at: receipt?.createdAt || (typeof result.createdAt === 'string' ? result.createdAt : ''), reference };
  }).reverse();
  const linked = new Set(all.map(task => task.legacyTaskId).filter(Boolean));
  const loose = bank.receipts.filter(receipt => !linked.has(receipt.taskId)).map(receipt => {
    const contact = contactsOf(bank).find(c => c.id === receipt.recipientId);
    return { id: receipt.id, title: `转账 · ${contact ? `${contact.name}（${contact.label}）` : '收款人'}`, detail: `¥${(receipt.amount / 100).toFixed(2)}`, badge: { label: '已转出', tone: 'ok' as Tone }, at: receipt.createdAt, reference: receipt.id };
  });
  return [...rows, ...loose].slice(0, limit);
}

export type RiskMatch = { profileLevel: number; validUntil: string; productRisk: number; productName: string; feeRate: number | null; fees: { name: string; rate: number }[]; liquidity: string; within: boolean; expired: boolean };

/**
 * The facts behind the suitability check, shown before a purchase is confirmed. The engine's
 * own check remains the only gate; this only explains it.
 */
export function riskMatch(bank: BankState, task: Pick<FlowTask, 'functionId' | 'params'>, now: number): RiskMatch | null {
  if (task.functionId !== 'IN08' || typeof task.params.productId !== 'string') return null;
  const product = bank.workflows?.records.products?.find(item => item.id === task.params.productId);
  const profile = bank.workflows?.riskProfile;
  if (!product || !profile) return null;
  const productRisk = Number(product.risk);
  if (!Number.isFinite(productRisk)) return null;
  const expired = Date.parse(profile.validUntil) < now;
  return { profileLevel: profile.level, validUntil: profile.validUntil, productRisk, productName: String(product.name || ''), feeRate: typeof product.feeRate === 'number' ? product.feeRate : null, fees: Array.isArray(product.fees) ? (product.fees as { name?: unknown; rate?: unknown }[]).filter(fee => typeof fee.rate === 'number').map(fee => ({ name: String(fee.name || '费用'), rate: fee.rate as number })) : [], liquidity: String(product.liquidity || ''), within: !expired && productRisk <= profile.level, expired };
}
