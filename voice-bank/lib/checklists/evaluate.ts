import { POLICY_VERSION, workflowById, type Fact, type SourceRef } from './catalog.ts';
export type CheckStatus = 'passed' | 'clarify' | 'blocked' | 'pending';
export type CheckResult = { id: string; title: string; status: CheckStatus; reason: string; sources: SourceRef[] };
export type ChecklistRun = { workflowId: string; policyVersion: string; outcome: 'proceed' | 'clarify' | 'blocked' | 'unsupported'; checks: CheckResult[]; question: string | null };
export function evaluateChecklist(workflowId: string, facts: Record<string, Fact>, through?: string): ChecklistRun {
  const flow = workflowById(workflowId);
  if (!flow) return { workflowId, policyVersion: POLICY_VERSION, outcome: 'unsupported', checks: [], question: '当前没有这个业务的预设检查单，请重新明确要办理的业务。' };
  const checks: CheckResult[] = []; let stopped = false;
  for (const rule of flow.steps) {
    if (stopped) checks.push({ id: rule.id, title: rule.title, status: 'pending', reason: '等待前序检查完成', sources: rule.sources });
    else {
      const value = facts[rule.field];
      const passed = rule.op === 'present' ? value != null && value !== '' : rule.op === 'eq' ? value === rule.value : rule.op === 'gte' ? typeof value === 'number' && typeof rule.value === 'number' && value >= rule.value : rule.op === 'lte' ? typeof value === 'number' && typeof rule.value === 'number' && value <= rule.value : false;
      const status = passed ? 'passed' : rule.onFailure === 'blocked' ? 'blocked' : 'clarify';
      checks.push({ id: rule.id, title: rule.title, status, reason: passed ? '已由当前业务记录验证' : rule.question, sources: rule.sources });
      stopped = !passed;
    }
    if (rule.field === through) break;
  }
  if (!checks.some(check=>check.status === 'clarify' || check.status === 'blocked') && flow.capability !== 'demo-ready') {
    checks.push({id:flow.id+'.adapter',title:'检查执行适配器',status:'blocked',reason:'业务条件已检查，但执行适配器尚未接入。',sources:flow.sources});
    return {workflowId,policyVersion:POLICY_VERSION,outcome:'unsupported',checks,question:'业务条件已检查，但执行适配器尚未接入。'};
  }
  const failed = checks.find(check => check.status === 'clarify' || check.status === 'blocked');
  return { workflowId, policyVersion: POLICY_VERSION, outcome: failed ? failed.status as 'clarify' | 'blocked' : 'proceed', checks, question: failed?.reason || null };
}
