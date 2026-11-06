import { z } from 'zod';
import { CONTACTS, type Contact, type BankState, type Intent } from './types.ts';
import { POLICY_VERSION, workflowById } from '../checklists/catalog.ts';
import { amountFromText } from '../checklists/amount.ts';
import type { RoutingDecision, Evidence } from '../checklists/routing.ts';
import { contactsOf, recipientCandidates, recipientIdentityMentioned, recipientNamesMentioned, hasRecipientTail } from './recipients.ts';
import { acknowledgesReview } from '../workflows/review.ts';

export const realtimeToolArguments = z.object({
  operation:z.enum(['get_state','list_accounts','update_transfer','confirm_transfer','cancel_transfer','select_workflow']),
  amount:z.preprocess(v=>typeof v==='string'&&/^\d+(?:\.\d{1,2})?$/.test(v.trim())?Number(v.trim()):v,z.number().finite().positive().max(100000).nullable().optional()),
  recipientId:z.enum(['zhang-roommate','zhang-landlord','li-friend']).nullable().optional(),
  accountId:z.enum(['daily','savings']).nullable().optional(),
  workflowId:z.string().max(60).nullable().optional(),
  confirmationToken:z.string().uuid().nullable().optional(),
  note:z.string().max(60).nullable().optional(),
}).strict();
export const realtimeToolArgumentsEnvelope=realtimeToolArguments.extend({recipientId:z.string().max(60).nullable().optional()}).strict();
export const realtimeToolArgumentsFor=(contacts:readonly Contact[])=>realtimeToolArgumentsEnvelope.refine(args=>args.recipientId==null||contacts.some(c=>c.id===args.recipientId),{message:'收款人不在当前场景中',path:['recipientId']});
export type RealtimeToolArguments=z.infer<typeof realtimeToolArgumentsEnvelope>;
const clean=(s:string)=>s.replace(/[，,。.!！?？、\s]/g,'');
/** Ground numeric fields after Omni has chosen a tool, never route conversation by these patterns. */
export function spokenAmount(text:string) {
  const normalized=text.trim().replace(/[。！!？?，,]+$/g,'').trim();
  const correction=normalized.match(/(?:不对|改口|改成|改为|应该是)[，,：:\s]*(?:是)?\s*([零〇一二两三四五六七八九十百千万]+|\d+(?:\.\d{1,2})?)\s*(?:元|块)?$/);
  if(correction)return amountFromText(correction[1]+'元');
  const bareChinese=/^[零〇一二两三四五六七八九十百千万]+$/.test(normalized);
  const value=amountFromText(bareChinese?normalized+'元':normalized);
  return value;
}
/** Explicitly grounded proposals plus executable checklist, not a second conversational router. */
export function realtimeToolDecision(args:RealtimeToolArguments,state:BankState,utterance:string,history:string[]=[]):RoutingDecision {
  const contacts=contactsOf(state),evidence:Evidence[]=[],raw=utterance.trim(),active=!!state.task&&!['complete','cancelled'].includes(state.task.step);
  const turns=[...history.slice(-8).filter(t=>t!==raw&&!(/密码|验证码|身份证/.test(t)&&/\d{4,}/.test(t))),raw];
  // Current user edits override a field; collected fields override older history.
  // A model restating stale params is not a user edit to those fields.
  const currentRecipient=recipientIdentityMentioned(raw,state.accounts.map(a=>a.tail),contacts)||/换个人|(?:换|改).{0,5}收款人|收款人.{0,6}(?:改|换|不对|听错)/.test(raw)||state.view==='transfer'&&state.task?.step==='recipient'&&/第?[一二三123](?:个|位)/.test(raw);
  const currentAccount=/日常|储蓄|daily|savings/i.test(raw)||state.accounts.some(a=>clean(raw).includes('尾号'+a.tail))||state.view==='balance'&&/第?[一二三123](?:个|张)/.test(raw)||/(?:换|改|选|用)(?:个|一张|一个|另一张|另一个)?(?:付款)?账户|账户.{0,3}(?:改|换)/.test(raw);
  const currentAmount=spokenAmount(raw);
  const moneySpeech=raw.split(/备注/)[0].replace(/尾号\s*\d+/g,'');
  const amountEdit=currentAmount.amount!=null||currentAmount.uncertain||/金额.{0,5}(?:改|换|不对)|(?:改|换).{0,5}金额/.test(raw)||/(?:转|改成|改为|改口|金额|不对)/.test(moneySpeech)&&/\d/.test(moneySpeech);
  const retainRecipient=active&&state.task!.recipientId!=null&&!currentRecipient;
  const retainAccount=active&&state.task!.accountId!=null&&!currentAccount;
  const arithmetic=/减(?:少|去)?|加(?:上)?|多(?:转)?|少(?:转)?|降低|增加/.test(raw);
  const retainAmount=active&&state.task!.amount!=null&&!amountEdit&&!arithmetic;
  const recipientText=currentRecipient?raw:retainRecipient?'':[...turns].reverse().find(t=>recipientIdentityMentioned(t,state.accounts.map(a=>a.tail),contacts))||raw;
  const accountText=currentAccount?raw:retainAccount?'':[...turns].reverse().find(t=>/日常|储蓄|daily|savings|尾号/i.test(t))||raw;
  const amountText=amountEdit?raw:retainAmount?'':[...turns].reverse().find(t=>{const a=spokenAmount(t);return a.amount!=null||a.uncertain})||raw;
  const risks=[...new Set(turns.join(' ').match(/刷单|解冻费|安全账户|保证金|跑分|兼职返利/g)||[])];
  const decision=(draft?:Intent,unresolved:string[]=[],question:string|null=null,workflowId='TF-T01',outcome:RoutingDecision['outcome']=unresolved.length?'clarify':'proceed'):RoutingDecision=>({
    workflowId,policyVersion:POLICY_VERSION,candidates:[workflowId],outcome,question,unresolved,draft,evidence,riskSignals:risks,
    checks:[{id:'ROUTE.realtime.tool',title:'Omni 选择受控业务工具',status:outcome==='unsupported'?'blocked':unresolved.length?'clarify':'passed',reason:question||'自然对话选择操作，后台校验字段来源和执行前置条件',sources:workflowById(workflowId)?.sources||[]}],
  });
  if(args.operation==='get_state')return decision(undefined,[],null,'CORE-BAL');
  if(/密码|验证码|身份证/.test(raw)&&/\d{4,}/.test(raw))return decision(undefined,['intent'],'认证信息只允许通过页面演示卡片输入。');
  if(args.operation==='list_accounts')return decision({kind:'balance'},[],null,'CORE-BAL');
  if(!raw)return decision(undefined,['intent'],'没有可核对的用户发言，请先询问用户想办理什么。');
  if(args.operation==='select_workflow'){
    const flow=workflowById(args.workflowId||'');
    if(!flow)return decision(undefined,['intent'],'没有这个预设流程，请澄清用户要办理哪项业务。');
    if(flow.id==='TF-T01')return decision({kind:active?'amend':'transfer'});
    if(flow.id==='CORE-BAL')return decision({kind:'balance'},[],null,'CORE-BAL');
    return decision(undefined,[],'已识别为“'+flow.title+'”，检查单已建立，执行能力尚未接入。',flow.id,'unsupported');
  }
  if(args.operation==='cancel_transfer'){
    if(!active||!/取消|不转|算了|别转/.test(raw)||/会员|订阅|代扣|理财|基金|贷款|不要取消|别取消/.test(raw))return decision(undefined,['intent'],'请明确是否取消当前这笔未完成转账。');
    return decision({kind:'cancel'});
  }
  if(args.operation==='confirm_transfer'){
    const t=state.task;
    const namedRecipients=recipientCandidates(raw,state.accounts.map(a=>a.tail),contacts),namedAccounts=state.accounts.filter(a=>raw.includes(a.name)||raw.includes(a.tail));
    if(t&&(currentAmount.amount!=null&&currentAmount.amount!==t.amount||currentRecipient&&(namedRecipients.length!==1||namedRecipients[0].id!==t.recipientId)||currentAccount&&(namedAccounts.length!==1||namedAccounts[0].id!==t.accountId)))return decision(undefined,['intent'],'确认内容与当前卡片不同，请先修改草稿再核对。');

    const affirm=acknowledgesReview(raw);
    if(active&&t!.step==='authenticate'&&t!.verificationId&&t!.reviewToken===args.confirmationToken&&affirm&&!state.routing?.unresolved.length)
      return decision(undefined,[],'这笔信息已经确认，请直接在卡片完成演示认证，不需要重复确认。');
    if(!active||!(state.view==='transfer'||state.view==='workflow'&&state.workflows?.tasks.find(x=>x.id===state.workflows?.currentTaskId)?.functionId==='TR03')||t!.step!=='review'||!t!.reviewToken||args.confirmationToken!==t!.reviewToken||!affirm||state.routing?.unresolved.length)
      return decision(undefined,['intent'],'请先核对当前完整转账摘要，再明确确认；旧摘要或仅确认金额不能授权整笔转账。');
    evidence.push({field:'confirmation',value:t!.id,quote:raw,source:'utterance'});
    return decision({kind:'confirm_transfer'});
  }
  const unresolved:string[]=[];
  if(/不要改|别改|不改|不要换|别换/.test(raw))return decision(undefined,['intent'],'请先明确要保留还是修改当前内容。');
  const ordinal=clean(raw).match(/^(?:用|选|选择|就用)?第?([一二三123])(?:个|张)(?:账户|银行卡|联系人|那个)?$/);
  const index=ordinal?({'一':0,'二':1,'三':2,'1':0,'2':1,'3':2} as Record<string,number>)[ordinal[1]]:null;
  if(state.sceneEpoch&&state.sceneId!=='default'&&state.view==='transfer'&&state.task?.step==='recipient'&&index!=null)return decision(undefined,['recipient'],'请在当前场景卡片选择收款人；语音序号需等待列表版本核验。');
  const matchedContacts=recipientCandidates(recipientText,state.accounts.map(a=>a.tail),contacts);
  let recipientId:string|null=null,accountId:string|null=null,amount:number|null=null;
  if(retainRecipient){ /* Keep the persisted selection; do not re-ground it. */ }
  else if(args.recipientId){
    if(!contacts.some(c=>c.id===args.recipientId))return decision(undefined,['recipient'],'收款人不在当前场景中，请明确选择。');
    const ordinalContact=state.view==='transfer'&&state.task?.step==='recipient'&&index!=null?contacts[index]?.id:null;
    if((matchedContacts.length===1&&matchedContacts[0].id===args.recipientId)||ordinalContact===args.recipientId)recipientId=args.recipientId;
    else if(active&&state.task!.recipientId===args.recipientId&&!recipientIdentityMentioned(raw,state.accounts.map(a=>a.tail),contacts)&&!/收款人/.test(raw)&&!matchedContacts.length)recipientId=null;
    else if(!matchedContacts.length&&!currentRecipient&&/他|她|那位|合租|一起住/.test(raw))recipientId=args.recipientId;
    else unresolved.push('recipient');
  }else if(matchedContacts.length===1)recipientId=matchedContacts[0].id;
  else if(recipientNamesMentioned(recipientText,contacts).length>1||matchedContacts.length>1)unresolved.push('recipient');
  else if(currentRecipient&&(/换个人|收款人/.test(raw)||hasRecipientTail(raw,state.accounts.map(a=>a.tail))))unresolved.push('recipient');
  const matchedAccounts=state.accounts.filter(a=>(a.id==='daily'?/日常|daily/i:/储蓄|savings/i).test(accountText)||clean(accountText).includes('尾号'+a.tail));
  if(retainAccount){ /* An amount correction does not change the funding account. */ }
  else if(args.accountId){
    const ordinalAccount=state.view==='balance'&&index!=null?state.accounts[index]?.id:null;
    if((matchedAccounts.length===1&&matchedAccounts[0].id===args.accountId)||ordinalAccount===args.accountId)accountId=args.accountId;
    else if(!matchedAccounts.length&&!currentAccount&&/账户|平常|零钱|工资/.test(raw))accountId=args.accountId;
    else if(!(active&&state.task!.accountId===args.accountId&&!matchedAccounts.length))unresolved.push('account');
  }else if(matchedAccounts.length===1)accountId=matchedAccounts[0].id;
  else if(matchedAccounts.length>1)unresolved.push('account');
  else if(currentAccount)unresolved.push('account');
  const parsed=spokenAmount(amountText);
  if(retainAmount){ /* A recipient/account edit does not replay an old amount. */ }
  else if(args.amount!=null){
    const cents=Math.round(args.amount*100);
    if(!Number.isSafeInteger(cents)||Math.abs(args.amount*100-cents)>1e-6)unresolved.push('amount');
    else if(parsed.amount===cents&&!parsed.uncertain||arithmetic&&!/美元|港币|欧元|日元|分之|\d\s*\/\s*\d/i.test(raw))amount=cents;
    else if(!(active&&state.task!.amount===cents&&parsed.amount==null&&!parsed.uncertain))unresolved.push('amount');
  }else if(parsed.amount!=null&&!parsed.uncertain)amount=parsed.amount;
  else if(parsed.uncertain)unresolved.push('amount');
  if(recipientId)evidence.push({field:'recipient',value:recipientId,quote:recipientText,source:matchedContacts.length===1?'utterance':'model-proposal'});
  if(accountId)evidence.push({field:'account',value:accountId,quote:accountText,source:matchedAccounts.length===1?'utterance':'model-proposal'});
  if(amount!=null)evidence.push({field:'amount',value:amount,quote:amountText,source:parsed.amount===amount?'utterance':'model-proposal'});
  for(const [field,value]of [['recipient',state.task?.recipientId],['account',state.task?.accountId],['amount',state.task?.amount]]as const)
    if(active&&value!=null&&!evidence.some(e=>e.field===field)&&!unresolved.includes(field))evidence.push({field,value,quote:'用户此前已明确的当前草稿字段',source:'existing-task'});
  if(!recipientId&&!(active&&state.task!.recipientId)&&!unresolved.includes('recipient'))unresolved.push('recipient');
  if(amount==null&&!(active&&state.task!.amount!=null)&&!unresolved.includes('amount'))unresolved.push('amount');
  if(!accountId&&!(active&&state.task!.accountId)&&!unresolved.includes('account'))unresolved.push('account');
  if(args.note&&/密码|验证码|身份证|\d{6,}/.test(args.note))return decision(undefined,['note'],'备注不能包含认证或身份信息。');
  if(Object.hasOwn(args,'note')&&args.note===null&&state.task?.note&&!/清空|删除.*备注|不要.*备注|不用.*备注/.test(raw))return decision(undefined,['note'],'清空备注需要用户明确表达；未修改时请省略 note。');
  const question=unresolved.includes('recipient')?(state.contacts?'收款人还不明确，请明确选择。':'收款人还不明确，请自然询问是室友、房东还是同学李四。'):unresolved.includes('amount')?'请询问准确金额；当前没有足够依据确认金额。':unresolved.includes('account')?'请询问使用哪个账户，也可以先调用 list_accounts 显示列表。':null;
  return decision({kind:active?'amend':'transfer',recipientId,accountId,amount,amountInferred:false,...(Object.hasOwn(args,'note')?{note:args.note}:{})},unresolved,question);
}

/** Compact tool result: no raw transcript, code, verification token, or entire audit/history. */
export { bankToolResult } from './tool-state.ts';

