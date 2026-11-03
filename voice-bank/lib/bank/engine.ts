import { type BankAction, type BankState, type Intent } from './types.ts';
import { contactsOf, recipientCandidates, recipientIdentityMentioned } from './recipients.ts';
import { POLICY_VERSION, DEMO_POLICY } from '../checklists/catalog.ts';
import { evaluateChecklist, type ChecklistRun } from '../checklists/evaluate.ts';
import { appendTransaction } from '../workflows/business-lite.ts';
import { initialFlowStore } from '../workflows/seed.ts';
import { demoDataset, DEFAULT_ANCHOR } from '../demo/dataset.ts';
import { reduceWorkflow } from '../workflows/engine.ts';
import {flattenPlan} from '../plans/materialize.ts';
import { assertPlanAccess, reconcilePlan, reducePlan, refreshPlanCalculation } from '../plans/engine.ts';
import { isDemoControl, reduceDemoControl } from '../demo/control.ts';
import { businessISO, businessDay } from '../demo/clock.ts';
import { availableBalance } from './accounts.ts';
import { interceptMonthlyAction } from '../plans/monthly.ts';
import { delayedNotice, scheduleDelayedTransfer } from '../demo/schedule.ts';
import { prerequisiteAction } from '../workflows/prerequisites.ts';

export class BankError extends Error { constructor(message: string, public status = 400) { super(message); } }
/** Tests and evaluations use the fixed default anchor; live sessions pass the current business day. */
export function initialState(anchor = DEFAULT_ANCHOR): BankState {
  const data = demoDataset(anchor);
  return { policyVersion: POLICY_VERSION, routing: null, checklist: null, audit: [], revision: 0, dataAnchor: data.anchor, dataVersion: data.version, accounts: data.accounts,
    task: null, receipts: [], lastReply: '你好，今天想办点什么？', view: 'home', recentRequestIds: [], workflows: initialFlowStore(anchor) };
}
/** A fresh default dataset for the live session: anchored on today unless a scene clock is running. */
export const liveInitialState = (s?: BankState) => initialState(s?.demoClock ? s.dataAnchor ?? DEFAULT_ANCHOR : businessDay());
/** Old active drafts have no proof of account selection, so require fresh selection/confirmation. */
export function normalizeState(previous: BankState): BankState {
  const s = structuredClone(previous);
  s.workflows ||= initialFlowStore();
  if (s.policyVersion !== POLICY_VERSION) {
    s.routing = null; s.audit ||= [];
    if (s.task && !['complete','cancelled'].includes(s.task.step)) {
      s.task.policyVersion = POLICY_VERSION; s.task.amountNeedsConfirmation = false;
      s.task.accountId = null; s.task.confirmedRevision = null; s.task.verificationId = null;
      s.task.riskSignals = []; s.task.step = s.task.recipientId ? 'details' : 'recipient';
      s.lastReply = '办理规则已更新，请重新选择付款账户并核对这笔演示转账。';
    }
    s.policyVersion = POLICY_VERSION;
  }
  if (s.task) { s.task.riskSignals ||= []; s.task.policyVersion ||= s.task.step === 'complete' ? 'legacy-prototype' : POLICY_VERSION; }
  flattenPlan(s);s.audit ||= []; s.routing ||= null; s.checklist = transferChecklist(s);
  return s;
}
export const money = (cents: number) => (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function validAmount(cents: number) { if (!Number.isSafeInteger(cents) || cents <= 0 || cents > DEMO_POLICY.maxTransferCents) throw new BankError('请输入 0.01 至 100,000 元的演示转账金额。'); }
function requireTask(s: BankState) { if (!s.task || ['complete','cancelled'].includes(s.task.step)) throw new BankError('请先发起一笔新的转账。'); return s.task; }
export function transferChecklist(s: BankState, through?: string): ChecklistRun | null {
  const t = s.task; if (!t || t.step === 'cancelled') return null;
  if (t.step === 'complete' && t.policyVersion !== POLICY_VERSION) return {workflowId:'TF-T01',policyVersion:t.policyVersion||'legacy-prototype',outcome:'unsupported',checks:[{id:'TF-T01.legacy_receipt',title:'保留旧版回执',status:'pending',reason:'该回执早于当前规则，没有追溯验证记录',sources:[]}],question:'历史回执已保留；不会补造当前检查单的通过记录。'};
  const account = s.accounts.find(a => a.id === t.accountId);
  const unresolved = s.routing?.workflowId === 'TF-T01' ? s.routing.unresolved : [];
  return evaluateChecklist('TF-T01', {
    'recipient.unique': contactsOf(s).some(c => c.id === t.recipientId) && !unresolved.includes('recipient'),
    'amount.valid': t.amount != null && Number.isSafeInteger(t.amount) && t.amount > 0 && t.amount <= DEMO_POLICY.maxTransferCents && !unresolved.includes('amount') && !t.amountNeedsConfirmation,
    'account.explicit': !!account && !unresolved.includes('account'),
    'risk.clear': !(t.riskSignals || []).length,
    // A new payee is settled through the delayed path, never immediately.
    'settlement.supported': contactsOf(s).some(c=>c.id===t.recipientId) && t.amount != null && t.amount <= DEMO_POLICY.immediateTransferCents,
    'balance.sufficient': !!account && t.amount != null && (t.step === 'complete' || availableBalance(account) >= t.amount),
    'user.confirmed': t.confirmedRevision != null,
    'user.authenticated': t.step === 'complete',
    'result.receipt': s.receipts.some(r => r.taskId === t.id),
  }, through);
}
function validate(s: BankState) {
  requireTask(s);
  if (s.routing?.unresolved.length) throw new BankError(s.routing.question || '请先澄清当前要办理的业务。');
  const run = transferChecklist(s, 'balance.sufficient')!;
  if (run.outcome !== 'proceed') throw new BankError(run.question || '请先完成前序检查。');
}
function transferSummary(s:BankState){
  const t=requireTask(s),c=contactsOf(s).find(c=>c.id===t.recipientId)!,a=s.accounts.find(a=>a.id===t.accountId)!;
  const fresh=c.previouslyUsed?'':'这是新收款人，请核对姓名、账户信息、金额和用途；备注或姓名一致都不能代替账户核验。新收款人按延迟到账处理，到账前可以撤销。';
  return fresh+'准备从'+a.name+'给'+c.label+c.name+'转 '+money(t.amount!)+' 元。核对无误可以说“确认转账”，之后只需在卡片完成演示认证。';
}
function prepare(s: BankState) {
  const t = requireTask(s); t.confirmedRevision = null; t.verificationId = null;
  t.step = !t.recipientId ? 'recipient' : t.amount == null || !t.accountId ? 'details' : 'review';
  const run = transferChecklist(s, 'balance.sufficient')!;
  t.reviewToken = run.outcome === 'proceed' ? crypto.randomUUID() : null;
  if (t.amountNeedsConfirmation && t.amount != null) s.lastReply = '你是要转 '+money(t.amount)+' 元，对吗？';
  else if (run.outcome !== 'proceed') {
    if (!t.recipientId) s.lastReply = (t.amount != null ? '好的，'+money(t.amount)+' 元。' : '') + (s.contacts ? (s.routing?.question || '想转给谁？请明确选择收款人。') : s.routing?.question?.includes('张三') ? '张三是室友还是房东？' : '想转给谁？可以说室友、房东，或者同学李四。');
    else if (t.amount == null) s.lastReply = '要转多少元？直接告诉我金额就可以。';
    else if (!t.accountId) s.lastReply = '想用日常账户还是储蓄账户？也可以问我有哪些账户。';
    else s.lastReply = run.question!;
  }
  else {
    s.lastReply = transferSummary(s);
  }
}
function confirmTransfer(s: BankState) {
  validate(s); const t=requireTask(s); t.step='authenticate'; t.confirmedRevision=s.revision; t.verificationId=crypto.randomUUID(); s.view='transfer';
  s.lastReply='信息已确认。请在卡片上输入演示验证码 123456，完成这笔模拟转账。';
}
function applyIntent(s: BankState, intent: Intent) {
  if (intent.kind === 'confirm_transfer') { confirmTransfer(s); return; }
  if (intent.kind === 'confirm_amount') { const t=requireTask(s); if (!t.amountNeedsConfirmation || t.amount == null) throw new BankError('当前没有待确认的金额。'); t.amountNeedsConfirmation=false; resolveFields(s,['amount']); prepare(s); return; }
  if (intent.kind === 'cancel') {
    if (s.task?.step === 'complete') { s.lastReply = '这笔模拟转账已完成，无法通过取消对话撤回。你可以查看回执。'; return; }
    if (s.task) { s.task.step = 'cancelled'; s.task.confirmedRevision = null; s.task.verificationId = null; }
    s.lastReply = '已取消这次办理，没有转出资金。'; return;
  }
  if (intent.kind === 'balance') { s.view = 'balance'; s.lastReply = '你有'+s.accounts.length+'个演示账户：'+s.accounts.map((a,i)=>(i+1)+'，'+a.name+'，尾号'+a.tail+'，余额'+money(a.balance)+'元').join('；')+'。'+(s.task && !['complete','cancelled'].includes(s.task.step) ? '这笔转账还在。可以说用日常账户、储蓄账户，或列表中的第几个。' : '账户明细已显示在页面。'); return; }
  if (intent.kind === 'help') { s.lastReply = '你想转账、查账单、管理订阅还是了解理财？'; return; }
  const active = s.task && !['complete','cancelled'].includes(s.task.step);
  if (!active) s.task = { policyVersion: POLICY_VERSION, id: crypto.randomUUID(), step: 'recipient', recipientId: null, amount: null, accountId: null, riskSignals: [], note: '', confirmedRevision: null, verificationId: null };
  const t = requireTask(s);
  const priorDetails=[t.recipientId,t.accountId,t.amount,t.note,!!t.amountNeedsConfirmation];
  if (intent.amount != null) { validAmount(intent.amount); t.amount = intent.amount; t.amountNeedsConfirmation=!!intent.amountInferred; }
  if (intent.recipientId) { if (!contactsOf(s).some(c=>c.id===intent.recipientId)) throw new BankError('找不到这位演示联系人，请从卡片选择。'); t.recipientId = intent.recipientId; }
  if (intent.accountId) { if (!s.accounts.some(a=>a.id===intent.accountId)) throw new BankError('找不到这个付款账户。'); t.accountId = intent.accountId; }
  if (intent.note !== undefined) { if (intent.note && /密码|验证码|身份证|\d{6,}/.test(intent.note)) throw new BankError('备注不能包含敏感身份或认证信息。'); t.note = (intent.note || '').slice(0,60); }
  s.view = 'transfer';
  const details=[t.recipientId,t.accountId,t.amount,t.note,!!t.amountNeedsConfirmation];
  if(active&&priorDetails.every((v,i)=>v===details[i])){
    if(['review','authenticate'].includes(t.step)&&transferChecklist(s,'balance.sufficient')!.outcome!=='proceed'){prepare(s);return;}
    if(t.step==='authenticate'){s.lastReply='信息已经确认，请直接在卡片完成演示认证，无需重新提供收款人或金额。';return;}
    if(t.step==='review'&&t.reviewToken){s.lastReply=transferSummary(s);return;}
  }
  prepare(s);
}
function resolveFields(s: BankState, fields: string[]) {
  if (s.routing?.workflowId === 'TF-T01') { s.routing.unresolved = s.routing.unresolved.filter(field => !fields.includes(field)); if (!s.routing.unresolved.length && s.routing.outcome !== 'unsupported') { s.routing.outcome = 'proceed'; s.routing.question = null; s.routing.checks = s.routing.checks.map(check => check.id === 'ROUTE.grounded' ? {...check,status:'passed',reason:'已通过用户卡片操作补全所需字段'} : check); } }
}
/** State changes and their rule results are saved together by the outer revision CAS. */
/** Every state change, from any entry (voice, delegation, tool call, card), gets the same prerequisite guidance. */
export function reduceBank(previous: BankState, action: BankAction, requestId: string): BankState {
  const next = reduceOnce(previous, action, requestId);
  if (next === previous || action.type === 'plan' && action.command.prerequisite) return next;
  const guide = prerequisiteAction(next, action.type === 'workflow' || action.type === 'plan' ? action.command.utterance || '' : '');
  if (!guide) return next;
  try { return reduceOnce(next, guide, requestId + ':guide'); } catch { return next; }
}
function reduceOnce(previous: BankState, action: BankAction, requestId: string): BankState {
  if(isDemoControl(previous,action))return reduceDemoControl(previous,action,requestId,liveInitialState());
  if(previous.recentRequestIds.includes(requestId))return previous;
  if(action.type==='delegation_request'){
   const s=structuredClone(previous),entry=action.request;
   if(entry.sceneEpoch!==s.sceneEpoch)throw new BankError('请求所属场景已改变。',409);
   const records=(s.delegationRequests||[]).filter(r=>r.id!==entry.id);
   if(entry.resumes){const parent=records.find(r=>r.id===entry.resumes);if(parent){parent.status=entry.status;parent.taskIds=[...entry.taskIds];}}
   const pending=records.filter(r=>r.kind==='business'&&r.status!=='done'&&!r.taskIds.length);
   if(pending.length>=32&&!records.some(r=>r.id===entry.resumes))throw new BankError('待恢复请求较多，请先继续已有请求。');
   s.delegationRequests=[...records.filter(r=>pending.includes(r)),...records.filter(r=>!pending.includes(r)).slice(-31),structuredClone(entry)];
   s.revision++;s.recentRequestIds=[...s.recentRequestIds.slice(-63),requestId];return s;
  }
  const bindRequest=(next:BankState)=>{
   const turnId=action.type==='plan'||action.type==='workflow'?action.command.turnId:undefined;
   const record=next.delegationRequests?.find(r=>r.turnId===turnId);if(!record)return next;
   const ids=next.workflows?.tasks.filter(t=>t.title!=='可办理功能'&&(!record.functions.length||record.functions.includes(t.functionId))&&(!previous.workflows?.tasks.some(old=>old.id===t.id)||t.id===(action.type==='workflow'?action.command.taskId:undefined))).map(t=>t.id)||[];
   record.taskIds=[...new Set([...record.taskIds,...ids])];
   const parent=next.delegationRequests?.find(r=>r.id===record.resumes);if(parent)parent.taskIds=[...record.taskIds];return next;
  };
  if(action.type==='plan')return bindRequest(reducePlan(normalizeState(previous),action.command,requestId,reduceSingleBank));
  assertPlanAccess(previous,action);
  const monthly=interceptMonthlyAction(previous,action,requestId);if(monthly)return monthly;
  if(previous.plan&&action.type==='workflow'&&action.command.source==='voice'&&action.command.turnId){previous=structuredClone(previous);previous.plan!.lastUserTurnId=action.command.turnId;}
  const refreshed=refreshPlanCalculation(previous,action,requestId,reduceSingleBank);if(refreshed)return refreshed;
  return bindRequest(reconcilePlan(reduceSingleBank(previous,action,requestId),action,reduceSingleBank,previous));
}
/** Inner checklist runner; scheduler calls cannot recursively advance the outer plan. */
function reduceSingleBank(previous: BankState, action: BankAction, requestId: string): BankState {
  if (previous.recentRequestIds.includes(requestId)) return previous;
  if (action.type === 'workflow') return reduceWorkflow(normalizeState(previous), action.command, requestId, reduceSingleBank);
  const s = normalizeState(previous), fromStep = s.task?.step || null; s.revision++;
  switch (action.type) {
    case 'reset': { const fresh = liveInitialState(); fresh.revision = s.revision; fresh.lastReply = '演示已重置，我们重新开始。'; fresh.recentRequestIds = [requestId]; return fresh; }
    case 'home': s.view = 'home'; break;
    case 'route': {
      s.routing = structuredClone(action.decision);
      if (s.task && !['complete','cancelled'].includes(s.task.step) && action.decision.riskSignals.length) {
        const risks=[...new Set([...(s.task.riskSignals || []),...action.decision.riskSignals])];
        if(risks.length!==s.task.riskSignals.length){s.task.riskSignals=risks;prepare(s);}
      }
      if (action.decision.draft) {
        applyIntent(s, action.decision.draft);
        if (['transfer','amend'].includes(action.decision.draft.kind) && s.task && !['complete','cancelled'].includes(s.task.step)) {
          const t = s.task;
          let invalidated=false;
          for(const [field,key]of [['recipient','recipientId'],['amount','amount'],['account','accountId']]as const)
            if(action.decision.unresolved.includes(field)&&t[key]!=null){t[key]=null;invalidated=true;}
          const risks=[...new Set([...(t.riskSignals || []),...action.decision.riskSignals])];
          if(risks.length!==t.riskSignals.length){t.riskSignals=risks;invalidated=true;}
          // applyIntent already prepared changed fields. Do not revoke a valid
          // summary/authentication again when nothing was invalidated here.
          if(invalidated)prepare(s);
        }
      } else s.lastReply = action.decision.question || '请先明确要办理的业务。';
      break;
    }
    case 'intent': applyIntent(s, action.intent); break;
    case 'select_recipient': resolveFields(s,['recipient']); applyIntent(s,{kind:'amend',recipientId:action.recipientId}); break;
    case 'edit': resolveFields(s,[...(action.amount != null?['amount']:[]),...(action.accountId?['account']:[]),...(action.note !== undefined?['note']:[])]); applyIntent(s,{...action,kind:'amend'}); if(fromStep==='authenticate'&&s.task?.step==='authenticate')prepare(s); break;
    case 'cancel': s.routing = null; applyIntent(s,{kind:'cancel'}); break;
    case 'confirm': confirmTransfer(s); break;
    case 'authenticate': {
      const t = requireTask(s);
      if (t.step !== 'authenticate' || !t.verificationId || t.verificationId !== action.verificationId || t.confirmedRevision == null) throw new BankError('转账信息已经变更，请重新核对并确认。',409);
      if (action.code !== '123456') throw new BankError('演示验证码是 123456，请重试。');
      validate(s);
      if (!contactsOf(s).find(c=>c.id===t.recipientId)!.previouslyUsed) { const record = scheduleDelayedTransfer(s,{id:t.id,recipientId:t.recipientId!,accountId:t.accountId!,amount:t.amount!,note:t.note}); t.step = 'complete'; t.verificationId = null; s.lastReply = '转账已受理。'+delayedNotice(record); break; }
      s.accounts.find(a=>a.id===t.accountId)!.balance -= t.amount!;
      s.receipts.unshift({id:'ZX'+Date.now()+crypto.randomUUID().slice(0,4).toUpperCase(),taskId:t.id,amount:t.amount!,accountId:t.accountId!,recipientId:t.recipientId!,note:t.note,createdAt:businessISO(s)});
      appendTransaction(s,{id:s.receipts[0].id,date:s.demoClock?businessDay(s):s.receipts[0].createdAt.slice(0,10),amount:t.amount!,accountId:t.accountId!,kind:'expense',merchant:contactsOf(s).find(c=>c.id===t.recipientId)!.name,category:'转账',note:t.note,relatedId:t.id,source:'沙箱转账执行记录'});
      t.step = 'complete'; t.verificationId = null; { const payee = contactsOf(s).find(c=>c.id===t.recipientId)!, shared = contactsOf(s).filter(c=>c.name===payee.name).length > 1; s.lastReply = money(t.amount!)+' 元已模拟转给'+(shared ? payee.label : '')+payee.name+'。回执在这里，余额也已更新。'; } break;
    }
    default: throw new BankError('暂不支持这个操作。');
  }
  s.checklist = transferChecklist(s);
  const cardEvidence = action.type === 'select_recipient' ? [{field:'recipient',value:action.recipientId,quote:'用户在联系人卡片中明确选择',source:'user-card' as const}] : action.type === 'edit' ? [
    ...(action.amount != null ? [{field:'amount',value:action.amount,quote:'用户在金额卡片中明确输入',source:'user-card' as const}] : []),
    ...(action.accountId ? [{field:'account',value:action.accountId,quote:'用户在付款账户卡片中明确选择',source:'user-card' as const}] : []),
  ] : [];
  if (s.routing?.workflowId === 'TF-T01') s.routing.evidence = [...s.routing.evidence.filter(e=>!cardEvidence.some(c=>c.field===e.field)),...cardEvidence];
  const routing = action.type === 'route' ? s.routing : null;
  const run = routing || s.checklist;
  s.audit = [...s.audit.slice(-99), {id:requestId,at:new Date().toISOString(),action:action.type,workflowId:run?.workflowId||'CORE-BAL',policyVersion:POLICY_VERSION,outcome:run?.outcome||'proceed',reason:run?.question||null,fromStep,toStep:s.task?.step||null,checks:structuredClone(run?.checks||[]),evidence:routing?.evidence||cardEvidence}];
  s.recentRequestIds = [...previous.recentRequestIds.slice(-63),requestId]; return s;
}

function chineseNumber(text: string): number | null {
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  let total = 0, section = 0, current = 0;
  for (const char of text) {
    if (char in digits) current = digits[char];
    else if (char === "万") { total += (section + current || 1) * 10000; section = 0; current = 0; }
    else { const unit = ({ 十: 10, 百: 100, 千: 1000 } as Record<string, number>)[char]; if (!unit) return null; section += (current || 1) * unit; current = 0; }
  }
  return (total + section + current) * 100;
}

/** Explicit offline demo grammar; production understanding is handled by the planner adapter. */
export function demoIntent(text: string, state: BankState): Intent {
  if (/取消|不转了|算了|别转/.test(text)) return { kind: "cancel" };
  if (/余额|多少钱|多少余额/.test(text)) return { kind: "balance" };
  const amountMatch = text.match(/(?:转(?:账|给)?|改成|改为|金额[是为]?|就转|转入|转出)\s*[¥￥]?\s*(\d+(?:\.\d{1,2})?)(?!\d)/) || text.match(/(\d+(?:\.\d{1,2})?)\s*(?:元|块)/) || text.match(/^\s*(\d+(?:\.\d{1,2})?)\s*$/);
  const cnMatch = text.match(/([零〇一二两三四五六七八九十百千万]+)\s*(?:元|块)/) || text.match(/(?:转|改成|改为)\s*([零〇一二两三四五六七八九十百千万]+)/);
  const amount = amountMatch ? Math.round(Number(amountMatch[1]) * 100) : cnMatch ? chineseNumber(cnMatch[1]) : null;
  const candidates=recipientCandidates(text, state.accounts.map(a=>a.tail), contactsOf(state));
  const recipientId=candidates.length===1?candidates[0].id:null;
  const accountId = /储蓄|另一张|另一个/.test(text) ? "savings" : /日常/.test(text) ? "daily" : null;
  const active = state.task && !["complete", "cancelled"].includes(state.task.step);
  if ((/转|改|储蓄|日常/.test(text)||recipientIdentityMentioned(text,state.accounts.map(a=>a.tail),contactsOf(state))) || (active && amount != null)) return { kind: active ? "amend" : "transfer", amount, recipientId, accountId };
  return { kind: "help" };
}

