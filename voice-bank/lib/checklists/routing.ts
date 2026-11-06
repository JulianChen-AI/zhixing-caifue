import { type BankState, type Intent } from '../bank/types.ts';
import { amountFromText } from './amount.ts';
import { POLICY_VERSION, DEMO_POLICY, workflowById } from './catalog.ts';
import type { CheckResult, ChecklistRun } from './evaluate.ts';
import { contactsOf, recipientCandidates, recipientIdentityMentioned, recipientNamesMentioned, recipientAliasQuote, recipientChoiceQuestion, hasRecipientTail } from '../bank/recipients.ts';
export type Evidence = { field: string; value: string | number; quote: string; source: 'utterance' | 'existing-task' | 'user-card' | 'model-proposal' };
export type RoutingDecision = ChecklistRun & { candidates: string[]; evidence: Evidence[]; unresolved: string[]; draft?: Intent; riskSignals: string[] };
const source = (id: string) => workflowById(id)?.sources || [];
export { amountFromText };
export function routeRequest(text: string, state: BankState, proposal?: Intent): RoutingDecision {
  const contacts = contactsOf(state), raw = text.trim(), active = state.task && !['complete','cancelled'].includes(state.task.step);
  const evidence: Evidence[] = [], checks: CheckResult[] = [], riskSignals = [...new Set(raw.match(/刷单|解冻费|安全账户|保证金|跑分|兼职返利|洗钱|涉嫌|配合调查|公检法/g) || [])];
  const finish = (workflowId: string, candidates: string[], outcome: RoutingDecision['outcome'], question: string | null, unresolved: string[], draft?: Intent): RoutingDecision => ({ workflowId, candidates, outcome, question, unresolved, draft, evidence, checks, riskSignals, policyVersion: POLICY_VERSION });
  const stop = (question: string, candidates: string[] = [], field='intent') => finish('',candidates,'clarify',question,[field]);
  if (!raw) return stop('请说说想办理什么业务。');
  if (/不要改|别改|不改|不要换|别换/.test(raw)) return stop('你是要保留当前内容，还是修改某项信息？请明确后再继续。');
  if (/不要取消|别取消|不取消|不用取消|不要退订/.test(raw)) return stop('你是要保留订阅，还是调整续费提醒？');
  if (/密码|验证码|身份证/.test(raw) && /\d{4,}/.test(raw)) return stop('请不要在对话中提供真实密码、验证码或证件号码；认证只通过页面演示卡片完成。');
  const normalized = raw.replace(/[，,。！!？?\s]/g,'');
  const accountQuery = /(?:有哪些|有哪几|有什么|有几个|看看|查看|列出|显示).{0,6}(?:账户|银行卡)|(?:账户|银行卡).{0,5}(?:有哪些|列表|有哪几)/.test(raw);
  if (accountQuery && !/转账|给.+转|取消|理财|订阅|账单/.test(raw)) {
    checks.push({id:'ROUTE.accounts',title:'查询本人演示账户',status:'passed',reason:'显示账户列表，不变更当前转账',sources:[]});
    return finish('CORE-BAL',['CORE-BAL'],'proceed',null,[],{kind:'balance'});
  }
  const affirmative = /^(?:是|是的|对|对的|没错|好的|好|可以|确定|确认|没问题|确认转账|确认办理|核对无误|继续)$/.test(normalized);
  if (active && affirmative) {
    if (state.view === 'transfer' && /元，对吗/.test(state.lastReply) && state.task!.amountNeedsConfirmation && state.task!.amount != null) {
      evidence.push({field:'amount',value:state.task!.amount,quote:raw,source:'utterance'});
      checks.push({id:'ROUTE.amount.confirm',title:'确认省略单位的金额',status:'passed',reason:'用户回答了当前金额核对问题',sources:source('TF-T01')});
      return finish('TF-T01',['TF-T01'],'proceed',null,[],{kind:'confirm_amount'});
    }
    if (state.view === 'transfer' && state.task!.step === 'review' && !state.routing?.unresolved.length) {
      checks.push({id:'ROUTE.confirm.explicit',title:'用户明确确认本笔转账',status:'passed',reason:'对当前完整转账摘要作出确认；仍需卡片认证',sources:source('TF-T01')});
      evidence.push({field:'confirmation',value:state.task!.id,quote:raw,source:'utterance'});
      return finish('TF-T01',['TF-T01'],'proceed',null,[],{kind:'confirm_transfer'});
    }
    return stop(state.task!.step === 'authenticate' ? '信息已经确认，请只在认证卡片输入演示验证码。' : '还需要补全收款人、准确金额和付款账户，确认不会跳过这些步骤。',['TF-T01']);
  }
  const parsedAmount = amountFromText(raw);
  const selectionOrdinal = normalized.match(/^(?:用|选|选择|就用)?第?([一二三123])(?:个|张)(?:账户|银行卡|联系人|那个)?$/);
  const ordinal = selectionOrdinal ? ({一:0,二:1,三:2,'1':0,'2':1,'3':2} as Record<string,number>)[selectionOrdinal[1]] : null;
  if(state.sceneEpoch&&state.sceneId!=='default'&&active&&state.view==='transfer'&&state.task!.step==='recipient'&&ordinal!=null)return stop('请在当前场景卡片选择收款人；语音序号需等待列表版本核验。',['TF-T01'],'recipient');
  const ordinalAccount = state.view === 'balance' && ordinal != null ? state.accounts[ordinal] : null;
  const ordinalRecipient = active && state.view === 'transfer' && state.task!.step === 'recipient' && ordinal != null ? contacts[ordinal] : null;
  const transfer = /转账|给.+转|(?:转|改成|改为)\s*[¥￥]?\s*[\d零〇一二两三四五六七八九十百千万]|transfer|付款账户/i.test(raw);
  const subscription = /订阅|代扣|自动续费|会员|退订/.test(raw);
  const investment = /理财|基金|债基|货基|定投|赎回|持仓|净值|小金库|目标储蓄|风险测评/.test(raw);
  const billing = /账单|支出|花了|消费统计|消费分类|查账|异常扣款/.test(raw);
  const domains = [transfer&&'transfer',subscription&&'subscription',investment&&'investment',billing&&'billing'].filter(Boolean);
  if (domains.length > 1 && !(/账单.*订阅|自动续费/.test(raw) && !transfer && !investment)) return stop('这句话涉及多个业务。请先选一项：转账、账单分析、订阅管理或理财。');
  let workflowId = '';
  if (subscription) workflowId = /取消|解除|退订/.test(raw) && /贷款|助贷|分期|社保|医保|物业|学费|房租|合约期/.test(raw) ? 'SD-S08' : /取消|解除|退订/.test(raw) ? (/微信|支付宝|苹果|App Store|应用商店/i.test(raw) ? 'SD-S06' : 'SD-S05') : /报告|月报/.test(raw) ? 'SD-S09' : /提醒|续费日期/.test(raw) ? 'SD-S03' : 'SD-S02';
  else if (investment) workflowId = /学理财|理财.*(?:是什么|是啥)|理财启蒙/.test(raw) ? 'TF-05' : /撤单|取消.*订单|撤销.*申购/.test(raw) ? 'TF-16' : /小金库|目标储蓄/.test(raw) ? (/创建|建个|新建/.test(raw) ? 'TF-01' : /取|赎回/.test(raw) ? 'TF-03' : /存|转入/.test(raw) ? 'TF-02' : 'TF-04') : /赎回|卖了|卖掉/.test(raw) ? 'TF-10' : /买|申购|投|定投/.test(raw) ? 'TF-09' : /测评/.test(raw) ? 'TF-06' : /持仓|赚|亏/.test(raw) ? 'TF-14' : /对比|比较|哪个好/.test(raw) ? 'TF-08' : 'TF-22';
  else if (billing) workflowId = /分享|海报|发朋友圈/.test(raw) ? 'BA-B08-share' : /导入/.test(raw) ? 'BA-B09' : /年度|去年|今年/.test(raw) ? 'BA-B08' : /异常|扣款是什么|刚才.*扣款|这笔.*问题|那笔.*问题/.test(raw) ? 'BA-B05' : /分类|归类/.test(raw) ? 'BA-B03' : /月报|报告|分析|比上月|支出.*(?:问题|不对劲)/.test(raw) ? 'BA-B07' : 'BA-B01';
  else if (/余额|account balance|my balance/i.test(raw)) workflowId = 'CORE-BAL';
  else if (/取消|不转了|别转|算了/.test(raw)) {
    if (!active || !/^(?:取消(?:这笔|当前)?(?:办理|转账)?|不转了|别转了?|算了)[。！!\s]*$/.test(raw)) return stop('你想取消哪项业务？请明确要取消的对象。');
    checks.push({id:'ROUTE.cancel.explicit',title:'明确取消当前未完成业务',status:'passed',reason:'用户明确要求取消当前转账',sources:source('TF-T01')});
    return finish('TF-T01',['TF-T01'],'proceed',null,[],{kind:'cancel'});
  } else if (transfer || (active && ((/改|换|日常|储蓄|继续这笔|继续办理转账|尾号/.test(raw)||recipientIdentityMentioned(raw,state.accounts.map(a=>a.tail),contacts)) || parsedAmount.amount != null || parsedAmount.uncertain || !!ordinalAccount || !!ordinalRecipient))) workflowId = /每月|每周|定时|明天|后天|月底|下个月/.test(raw) ? 'TF-T04' : /1[3-9]\d{9}/.test(raw) ? 'TF-T02' : /AA|均分|平摊/i.test(raw) ? 'TF-T05' : 'TF-T01';
  else if (/AA|均分|平摊/i.test(raw)) workflowId = 'TF-T05';
  else return stop(active ? (state.task!.amountNeedsConfirmation ? '你是要转 '+(state.task!.amount! / 100).toFixed(2)+' 元，对吗？' : state.task!.step === 'recipient' ? '收款人没听清。这笔转账还在，你想转给室友、房东，还是同学李四？' : !state.task!.amount ? '这笔转账还在，要转多少元？' : !state.task!.accountId ? '这笔转账还在，想用日常账户还是储蓄账户？也可以问我有哪些账户。' : '这笔转账还在。你想修改内容、查看账户，还是确认转账？') : '你想转账、查账单、管理订阅，还是了解理财？请先明确一项业务。');
  const flow = workflowById(workflowId)!;
  checks.push({id:'ROUTE.single',title:'选择预设业务检查单',status:'passed',reason:flow.title,sources:source(workflowId)});
  if (flow.capability !== 'demo-ready') {
    checks.push({id:'ROUTE.capability',title:'检查执行能力',status:'blocked',reason:'该场景已建检查单，执行适配器尚未接入',sources:source(workflowId)});
    return finish(workflowId,[workflowId],'unsupported','已识别为“'+flow.title+'”。这项业务已建立检查单，当前演示尚未接入执行能力。',[]);
  }
  if (workflowId === 'CORE-BAL') return finish(workflowId,[workflowId],'proceed',null,[],{kind:'balance'});
  if (active && /另一笔|再给|新建一笔|再转|新增|重新发起/.test(raw)) return stop('当前还有一笔未完成转账。请先取消或完成，再发起新的一笔。',['TF-T01']);
  const amount = parsedAmount, unresolved: string[] = [];
  if ((amount.amount == null && /改成|改为|一半|全部|全额|剩下/.test(raw)) || (amount.amount != null && (!Number.isSafeInteger(amount.amount) || amount.amount <= 0 || amount.amount > DEMO_POLICY.maxTransferCents))) { amount.amount = null; amount.uncertain = true; unresolved.push('amount'); }
  const mentioned = recipientCandidates(raw,state.accounts.map(a=>a.tail),contacts);
  let recipientId = ordinalRecipient?.id || (mentioned.length === 1 ? mentioned[0].id : null);
  if (mentioned.length > 1) unresolved.push('recipient');
  const nameMatches=recipientNamesMentioned(raw,contacts);
  const namedZhang=nameMatches.some(c=>nameMatches.filter(n=>n.name===c.name).length>1);
  if (namedZhang && !mentioned.length) unresolved.push('recipient');
  if(hasRecipientTail(raw,state.accounts.map(a=>a.tail))&&!mentioned.length)unresolved.push('recipient');
  if ((new Set(nameMatches.map(c=>c.name)).size>1 && /和|分别|各|每人|and/i.test(raw)) || mentioned.length > 1) return stop('一次先办理一位收款人的转账。请明确这笔转给谁。',['TF-T01'],'recipient');
  const accountMatches = [...new Set([ordinalAccount?.id, ...state.accounts.filter(a => raw.includes(a.name) || raw.includes('尾号'+a.tail) || raw.includes('尾号 '+a.tail) || (a.id === 'daily' ? /日常|daily/i : /储蓄|savings/i).test(raw)).map(a=>a.id)].filter(Boolean))] as string[];
  const accountId = accountMatches.length === 1 ? accountMatches[0] : null;
  if (accountMatches.length > 1) unresolved.push('account');
  if (amount.uncertain) unresolved.push('amount');
  if (proposal?.amount != null && proposal.amount !== amount.amount && !(active && amount.amount == null && !amount.uncertain && proposal.amount === state.task?.amount)) unresolved.push('amount');
  if (proposal?.recipientId && proposal.recipientId !== recipientId && !(active && !namedZhang && !mentioned.length && proposal.recipientId === state.task?.recipientId)) unresolved.push('recipient');
  if (proposal?.accountId && proposal.accountId !== accountId && !(active && !accountMatches.length && proposal.accountId === state.task?.accountId)) unresolved.push('account');
  if (recipientId) evidence.push({field:'recipient',value:recipientId,quote:ordinalRecipient ? raw : recipientAliasQuote(raw,contacts.find(c=>c.id===recipientId)!),source:'utterance'});
  if (amount.amount != null) evidence.push({field:'amount',value:amount.amount,quote:amount.quote,source:'utterance'});
  if (accountId) evidence.push({field:'account',value:accountId,quote:raw,source:'utterance'});
  const mentionsRecipient = !!ordinalRecipient || namedZhang || mentioned.length > 0 || hasRecipientTail(raw,state.accounts.map(a=>a.tail)) || /换个人|换收款人/.test(raw);
  const nextRecipient = recipientId || (active && !mentionsRecipient ? state.task?.recipientId : null);
  const nextAmount = amount.amount ?? (active && !amount.uncertain ? state.task?.amount : null);
  const nextAccount = accountId || (active && accountMatches.length === 0 ? state.task?.accountId : null);
  if (!nextRecipient) unresolved.push('recipient');
  if (nextAmount == null) unresolved.push('amount');
  if (!nextAccount) unresolved.push('account');
  for (const [field,value] of [['recipient',nextRecipient],['amount',nextAmount],['account',nextAccount]] as const) {
    if (value != null && !evidence.some(e=>e.field===field)) evidence.push({field,value,quote:'当前未完成任务中已由用户明确的值',source:'existing-task'});
  }
  const noteMatch = raw.match(/备注(?:写|是|为)?[：:\s]*([^，。！？]+)/);
  const note = noteMatch?.[1]?.trim();
  if (note && (/密码|验证码|身份证/.test(note) || /\d{6,}/.test(note))) return stop('备注不能包含密码、验证码、证件号或完整卡号，请修改备注。',['TF-T01'],'note');
  const fields = [...new Set(unresolved)];
  const question = fields.includes('recipient') ? (namedZhang ? (state.contacts?recipientChoiceQuestion(nameMatches):'你说的张三是室友还是房东？可以直接告诉我。') : (state.contacts?'想转给谁？请明确选择收款人。':'想转给谁？可以说室友、房东，或者同学李四。')) : fields.includes('amount') ? '请明确准确金额；检测到多个或不确定的金额时不会代你选择。' : fields.includes('account') ? '想用日常账户还是储蓄账户？也可以问我有哪些账户。' : null;
  checks.push({id:'ROUTE.grounded',title:'核对字段来源与歧义',status:fields.length?'clarify':'passed',reason:question||'字段来自用户原话或已确认的当前任务',sources:source(workflowId)});
  const draft: Intent = {kind:active?'amend':'transfer',amount:amount.amount,recipientId,accountId,amountInferred: amount.amount != null && !/(?:元|块|yuan|[¥￥])/i.test(amount.quote),...(note?{note:note.slice(0,60)}:{})};
  return finish(workflowId,[workflowId],fields.length?'clarify':'proceed',question,fields,draft);
}
