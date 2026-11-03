import {completeAnswers,questionnaire} from './questionnaire.ts';
import type { BankAction, BankState } from '../bank/types.ts';
import { ambiguousRecipients, contactsOf } from '../bank/recipients.ts';
import { availableFunctions, functionById, toolById, UNSUPPORTED_FUNCTIONS, WORKFLOW_VERSION } from './catalog.ts';
import { estimate, type EstimateItem } from './adapters.ts';
import { ACTIONS, cents, executeBusiness, isWrite, needsAuth, preflight, queryBusiness, readTool, rows, settleOrders, step, suitabilityStop } from './adapters.ts';
import { choices, validateVoiceDraft, FIELDS, LABELS, normalizedParams, requiredFields } from './fields.ts';
import { acknowledgesReview, workflowReview } from './review.ts';
import { readSummary } from './summaries.ts';
import { initialFlowStore } from './seed.ts';
import { goalPlan } from './business-lite.ts';
import { aaShares, reminderDrafts, type AaItem } from './aa.ts';
import { delayedNotice } from '../demo/schedule.ts';
import { redemptionQuote, transferView } from './presentation-lite.ts';
import { WorkflowError, type FlowTask, type Params, type WorkflowCommand } from './types.ts';
import {isBillingQuery,resolveBillingQuery} from './billing-query.ts';

type LegacyReducer=(s:BankState,a:BankAction,id:string)=>BankState;
const current=(s:BankState,id?:string)=>s.workflows!.tasks.find(t=>t.id===(id||s.workflows!.currentTaskId));
function evidence(t:FlowTask,params:Record<string,unknown>,cmd:WorkflowCommand){
 t.fieldEvidence||={};
 if(Array.isArray(params.answers))params.answers.forEach((value,index)=>{
  const key=`answers.${index}`;if(!value||t.fieldEvidence![key]?.value===value)return;
  t.fieldEvidence![key]={value,source:cmd.source==='card'?'user-card':'utterance',quote:cmd.source==='card'?'用户在问卷明确选择':(cmd.utterance||'').replace(/\d{6,}/g,'[已脱敏]').slice(-400)};
 });
 for(const key of Object.keys(params))if(!['answers','code'].includes(key))t.fieldEvidence[key]={source:cmd.source==='card'?'user-card':'model-proposal',quote:cmd.source==='card'?'用户在业务卡片明确输入或选择':([...(cmd.history||[]),cmd.utterance||''].join('\n').replace(/\d{6,}/g,'[已脱敏]').slice(-400))};
 if(['TR03','TR04'].includes(t.functionId))t.riskSignals=[...new Set([...(t.riskSignals||[]),...([...(cmd.history||[]),cmd.utterance||'',String(params.note||'')].join(' ').match(FRAUD_WORDS)||[])])];
}
// Scam scripts a transfer must never follow: paying to “unfreeze” or “verify” funds, or impersonated police.
export const FRAUD_WORDS=/刷单|解冻费|安全账户|保证金|跑分|兼职返利|洗钱|涉嫌|配合调查|公检法|网恋|网上认识|才能见面/g;
/** A question that names what is missing and, for a short list of options, the options themselves. */
function askFor(s:BankState,missing:string[]){
 const label=(k:string)=>(LABELS[k]||k).replace('（可选）','').replace('（元）','');
 const first=missing[0],options=choices(s,first);
 const offer=options.length>1&&options.length<=4&&!['category','action'].includes(first)?`：${options.map(o=>o.label.replace(' · ','（').replace(/$/,o.label.includes(' · ')?'）':'')).join('、')}，选哪个？`:'';
 const rest=missing.slice(1).map(label);
 return '请补充'+label(first)+(offer||'。')+(rest.length?`另外还需要${rest.join('、')}。`:'');
}
function invalidate(t:FlowTask){t.reviewToken=null;t.verificationId=null;t.confirmedToken=null;t.result=null;}
function finish(t:FlowTask,result:unknown,message=''){
 message||=readSummary(t.functionId,result)||'查询完成，结果来自当前合成演示数据。';
 if((isBillingQuery(t.functionId)||t.functionId==='IN15')&&result&&typeof result==='object'&&'spokenSummary' in result&&typeof result.spokenSummary==='string')message=result.spokenSummary;
 t.status='complete';t.result=result;t.message=message;t.verificationId=null;t.reviewToken=null;
 for(const x of t.steps)if(x.status==='pending'){x.status='skipped';x.reason='本次参数或路径未触发，无需调用';}
}
function markFailure(t:FlowTask,error:unknown){t.status=error instanceof WorkflowError&&error.status===501?'unsupported':'blocked';t.message=error instanceof Error?error.message:'操作未确认成功。';t.reviewToken=null;t.verificationId=null;}
function shareTransferRisk(s:BankState,t:FlowTask,legacy:LegacyReducer):BankState{
 if(t.functionId==='TR03'&&s.task&&s.task.id===t.legacyTaskId&&!['complete','cancelled'].includes(s.task.step)&&t.riskSignals?.some(r=>!s.task!.riskSignals.includes(r))){
  s.task.riskSignals=[...new Set([...s.task.riskSignals,...t.riskSignals])];
  s=legacy(s,{type:'intent',intent:{kind:'amend'}},'flow-risk-'+crypto.randomUUID());
 }
 return s;
}
/** Repeating collected facts is not an edit, but current conditions still apply. */
function retainProgress(s:BankState,t:FlowTask,legacy:LegacyReducer):BankState{
 try{
  s=shareTransferRisk(s,t,legacy);t=current(s,t.id)!;
  preflight(s,t);
  if(t.functionId==='TR03'){
   if(!s.task||s.task.id!==t.legacyTaskId||s.task.reviewToken!==t.legacyReviewToken||s.task.step!==t.status||t.status==='authenticate'&&s.task.verificationId!==t.verificationId)throw new WorkflowError('原转账状态已变更，请重新核对当前草稿。');
   s=legacy(s,{type:'intent',intent:{kind:'amend'}},'flow-recheck-'+crypto.randomUUID());
   t=current(s,t.id)!;
   if(s.task!.step!==t.status||s.task!.reviewToken!==t.legacyReviewToken)throw new WorkflowError(s.lastReply);
  }
  if(t.status==='authenticate')t.message='信息已经确认，请在卡片完成演示认证，不需要重复确认。';
 }catch(error){markFailure(current(s,t.id)||t,error);}
 return s;
}
function validateDraftVoice(s:BankState,t:FlowTask,params:Params,cmd:WorkflowCommand):{params:Params;unverifiedParticipants:boolean;clearTotal:boolean;recipientChoice?:string}{
 try{validateVoiceDraft(s,t,params,cmd.utterance||'');return{params,unverifiedParticipants:false,clearTotal:false};}
 catch(error){
  // A shared name keeps the draft and lists every candidate instead of accepting the model's pick.
  if(cmd.source==='voice'&&t.functionId==='TR03'&&['run','amend'].includes(cmd.operation)&&error instanceof WorkflowError&&error.field==='recipientChoice'){
   const rest={...params};delete rest.recipientId;validateVoiceDraft(s,t,rest,cmd.utterance||'');
   t.recipientChoices=ambiguousRecipients(cmd.utterance||'',s.accounts.map(a=>a.tail),contactsOf(s)).map(c=>c.id);
   return{params:rest,unverifiedParticipants:false,clearTotal:false,recipientChoice:error.message};
  }
  if(cmd.source!=='voice'||t.functionId!=='TR05'||!['run','amend'].includes(cmd.operation)||!(error instanceof WorkflowError)||error.field!=='participants')throw error;
  const safe:Params={...params,participants:[]};let clearTotal=false;
  try{validateVoiceDraft(s,t,safe,cmd.utterance||'');}
  catch(recheck){if(!(recheck instanceof WorkflowError)||recheck.field!=='total')throw recheck;delete safe.total;clearTotal=true;validateVoiceDraft(s,t,safe,cmd.utterance||'');}
  return{params:safe,unverifiedParticipants:true,clearTotal};
 }
}
function evidenceParams(params:Params,unverifiedParticipants:boolean){
 return unverifiedParticipants?Object.fromEntries(Object.entries(params).filter(([key])=>key!=='participants')):params;
}
function askRecipient(task:FlowTask,question?:string){
 if(question&&task.status==='collecting'&&task.missing.includes('recipientId'))task.message=question;
}
function clarifyUnverifiedAa(task:FlowTask){
 if(task.status==='collecting'&&task.clarificationFields?.includes('participants'))task.message='成员称呼没听清，名单尚未核实或保存。请重新说出成员姓名/称呼，或在卡片核对后填写；不要重复提交同一转写上的猜测。其他已独立核实的信息会保留。'+(task.missing.includes('total')?'总额也需要补充。':'');
}
function billingParams(s:BankState,t:FlowTask,params:Params,cmd:WorkflowCommand){
 if(!isBillingQuery(t.functionId))return params;
 let pending=t.queryClarifications|| (t.queryClarification?[t.queryClarification]:[]);
 const resolvedBy=(p:Params,field:string)=>typeof p[field]==='string'||field==='merchant'&&typeof p.category==='string'&&!!p.category;
 let bound=params;
 if(cmd.source!=='card'&&cmd.utterance){
  const resolved=resolveBillingQuery(s,params,cmd.utterance);
  bound=resolved.params;
  pending=pending.filter(issue=>!resolvedBy(bound,issue.field)&&!resolved.clarifications.some(next=>next.field===issue.field));
  pending.push(...resolved.clarifications);
 }else pending=pending.filter(issue=>!resolvedBy(params,issue.field));
 if(pending.length){t.queryClarifications=pending;t.queryClarification=pending[0];}else{delete t.queryClarifications;delete t.queryClarification;}
 return bound;
}
function prepare(s:BankState,t:FlowTask,legacy:LegacyReducer):BankState{
 s=shareTransferRisk(s,t,legacy);t=current(s,t.id)!;
 invalidate(t);t.steps.forEach(x=>{x.status='pending';x.reason='等待前序条件';});
 const skip=(id:string,reason:string)=>{const x=t.steps.find(x=>x.toolId===id);if(x){x.status='skipped';x.reason=reason;}};
 if(!t.params.note)skip('T16','未提供可选备注，直接跳过，不追问。');
 if(t.functionId==='TR03'&&t.params.saveRecipient!==true)skip('T14','未请求保存联系人。');
 if(t.functionId==='IN01'&&t.params.autoSave!==true)skip('T10','未请求自动转存，不建立资金规则。');
 if(!t.params.share)skip('S15','未请求分享。');
 if(!t.params.file)skip('S14','未上传文件，无需提取。');
 if(UNSUPPORTED_FUNCTIONS.has(t.functionId)){t.status='unsupported';t.message='该功能需要设备/外部通道适配器，当前未接入；没有执行。';return s;}
 if(t.queryClarification){t.status='collecting';t.missing=[t.queryClarification.field];t.message=t.queryClarification.message;return s;}
 const required=requiredFields(t.functionId,t.params);
 // A single AA session is the only one a reminder can be about.
 if(t.functionId==='TR05'&&required.includes('sessionId')&&t.params.sessionId==null&&rows(s,'aa').length===1)t.params.sessionId=rows(s,'aa')[0].id;
 // With exactly one own account there is nothing to choose; it is still shown for review.
 if(required.includes('accountId')&&t.params.accountId==null&&s.accounts.length===1){t.params.accountId=s.accounts[0].id;(t.fieldEvidence||={}).accountId={source:'calculation',quote:'当前只有一个付款账户，自动带入'};}
 // Risk wording stops a transfer before collecting the rest; it is never completed by asking more.
 if(['TR03','TR04'].includes(t.functionId)&&t.riskSignals?.length&&required.some(k=>t.params[k]==null||t.params[k]==='')){t.status='blocked';t.missing=[];t.message=`这笔涉及“${t.riskSignals.join('、')}”：向个人账户先付钱，不是平台订单付款。请先核实交易、收款信息和退还条件。本次转账没有提交，也没有扣款。`;return s;}
 // An unsuitable purchase stops before its amount is asked; the message names the assessment so the prerequisite flow can offer it.
 {const stop=suitabilityStop(s,t);if(stop){t.status='blocked';t.missing=[];t.message=stop;return s;}}
 t.missing=required.filter(k=>t.params[k]==null||t.params[k]===''||k==='answers'&&!completeAnswers(t.params[k])||Array.isArray(t.params[k])&&!(t.params[k]as unknown[]).length);
 // AA with a head count: names said so far are kept and only the missing ones are asked for.
 const headcount=t.functionId==='TR05'&&t.params.action==='create'&&typeof t.params.headcount==='number'?t.params.headcount:0;
 // The payer is the user: a head count with no names yet starts the list with “我”.
 if(headcount&&!(Array.isArray(t.params.participants)&&(t.params.participants as unknown[]).length)){t.params.participants=['我'];(t.fieldEvidence||={}).participants={source:'calculation',quote:'AA 的付款人是你自己'};}
 const named=Array.isArray(t.params.participants)?t.params.participants as string[]:[];
 if(headcount&&named.length!==headcount&&!t.missing.includes('participants'))t.missing.push('participants');
 if(t.missing.length){const asked=t.message;t.status='collecting';t.message=askFor(s,t.missing);
  // The same question twice in a row reads as stuck; say how to leave.
  if(asked===t.message||asked.startsWith(t.message))t.message+='不想办了也可以说“结束这个业务”。';
  if(headcount&&t.missing.includes('participants'))t.message=named.length<headcount?`这次 AA 一共 ${headcount} 人，${named.length?`已记下${named.join('、')}，`:''}还差 ${headcount-named.length} 位，请说一下他们的称呼。`:`你说一共 ${headcount} 人，但名单里有 ${named.length} 位，请核对人数或名单。`;if(t.functionId==='IN05'){const questions=questionnaire(t.params.answers),q=questions.find(q=>q.status==='missing')!;const filled=questions.filter(q=>q.status==='filled').length;t.message=`${filled?`已保存${filled}题。`:`风险测评共 ${questions.length} 题，答案只用于判断能买哪类产品。`}第${q.index}题：${q.title} ${q.choices.map(c=>c.value+'：'+c.label).join('；')}。`;}return s;}
 try{
  step(t,'S07','白名单参数及后台事实检查',()=>preflight(s,t));
  if(t.functionId==='TR03'){
   if(!t.legacyTaskId&&s.task&&!['complete','cancelled'].includes(s.task.step))throw new WorkflowError('已有未完成转账，请先继续或取消原转账。');
   if(t.legacyTaskId&&(!s.task||s.task.id!==t.legacyTaskId||['complete','cancelled'].includes(s.task.step)))throw new WorkflowError('原转账已结束或被其他草稿替换，请查询结果后明确发起新转账。');
   const p=t.params;if(!contactsOf(s).some(c=>c.id===p.recipientId))throw new WorkflowError('请选择有用户依据的演示收款人。');
   if(p.note!=null)step(t,'T16','仅处理明确提供的备注，不主动生成',()=>true);
   s=legacy(s,{type:'intent',intent:{kind:'transfer',recipientId:String(p.recipientId),accountId:String(p.accountId),amount:cents(p.amount),...(Object.hasOwn(p,'note')?{note:p.note==null?null:String(p.note)}:{})}},'flow-draft-'+crypto.randomUUID());
   if(s.task?.step==='authenticate')s=legacy(s,{type:'edit',amount:s.task.amount!},'flow-review-'+crypto.randomUUID());
   const live=current(s,t.id)!;s.routing=null;
   const ready=s.task?.step==='review'&&!!s.task.reviewToken;
   step(live,'T05','复用原转账草稿，修改撤销旧授权',()=>true);
   step(live,'T02','复用账户余额工具，读取会话真实可用余额',()=>readTool(s,'T02',{accountId:p.accountId}));
   if(s.task)live.legacyTaskId=s.task.id;
   if(!ready)throw new WorkflowError(s.lastReply);
   step(live,'T06','原转账执行器已检查风险、限额与账户',()=>true);
   live.legacyTaskId=s.task!.id;live.legacyReviewToken=s.task!.reviewToken!;
   live.status='review';live.reviewToken=crypto.randomUUID();live.message=s.lastReply+(s.task!.note?' 备注：'+s.task!.note:'（无备注）');s.view='workflow';return s;
  }
  if(!isWrite(t)){finish(t,queryBusiness(s,t));return s;}
  if(t.functionId==='IN01')t.result=step(t,'I01','目标计划由程序计算；不假设收益',()=>({...goalPlan(s,t.params),autoSave:t.params.autoSave===true}));
  if(t.functionId==='IN04'&&t.params.action==='update'){
   // A fixed per-run amount on a goal without a deadline has no monthly figure to recompute; the review shows the rule's own bounds.
   const goal=s.workflows!.records.goals?.find(g=>g.id===t.params.goalId),fixed=t.params.amount!=null&&!t.params.deadline&&!goal?.deadline;
   t.result=step(t,'I02','目标变更重算月供；不移动资金，确认后才更新关联规则',()=>fixed&&goal?{...goal,fixedAmount:true}:goalPlan(s,t.params));
  }
  if(['IN08','IN09'].includes(t.functionId))t.result=step(t,'I10','沙箱费率为合成0费率；到账须实际结算',()=>t.functionId==='IN09'?redemptionQuote(s,t.params):({amount:cents(t.params.amount),fee:0,synthetic:true,notice:'合成产品和费用，仅演示；受理不等于结算'}));
  let preview='';
  if(t.functionId==='TR05'&&t.params.action==='create'){const plan=step(t,'T11','整数分分摊且总额守恒',()=>aaShares(cents(t.params.total),t.params.participants as string[],(t.params.adjustments as AaItem[])||[]));t.result={participants:plan.shares,total:cents(t.params.total),receivable:plan.receivable,rule:plan.rule};preview=plan.summary+'请确认名单和规则。';}
  if(t.functionId==='BI08'&&t.params.action==='estimate'){const e=estimate(t.params.items as EstimateItem[]),yuan=(c:number)=>(c/100).toLocaleString('zh-CN',{maximumFractionDigits:2});t.result=e;preview=`${e.items.length}项合计${yuan(e.total)}元：${e.items.map(i=>i.label+yuan(i.amount)).join('、')}。这是你的估算，不是实时价格；不订房、不扣款。请确认后保存。`;}
  if(t.functionId==='IN13'&&t.params.action==='create'){const product=rows(s,'products').find(r=>r.id===t.params.productId),acc=s.accounts.find(a=>a.id===t.params.accountId);preview=`将建立定投规则：${t.params.schedule}从${acc?.name||'所选账户'}投${t.params.amount}元到${product?.name||'所选产品'}。这只是授权规则，现在不会扣款；每期执行、受理和份额确认分别记录，可随时暂停、修改或终止。确认后在卡片完成演示认证。`;}
  if(t.functionId==='SU04'){const sub=rows(s,'subscriptions').find(r=>r.id===t.params.subscriptionId)!,yuan=(c:unknown)=>(Number(c)/100).toFixed(Number(c)%100?2:0);t.result={name:sub.name,amount:sub.amount,cycle:sub.cycle,nextChargeAt:sub.nextChargeAt,benefitUntil:sub.benefitUntil,channel:sub.channel};preview=sub.channel==='bank'?`将停止${sub.name}（每月${yuan(sub.amount)}元${sub.nextChargeAt?`，下次${sub.nextChargeAt}续费`:''}）的后续续费。以前的扣款不会退还${sub.benefitUntil?`，本期权益到${sub.benefitUntil}`:''}。确认后在卡片完成演示认证。`:`${sub.name}需要到服务方那里取消，银行不能代你退订；确认后给出官方操作步骤。`;}
  if(t.functionId==='TR05'&&t.params.action==='remind'){const drafts=reminderDrafts(rows(s,'aa').find(r=>r.id===t.params.sessionId)!);t.result={reminders:drafts,channel:'模拟通道（演示）'};preview=`将分别给${drafts.map(d=>`${d.to}（${(d.amount/100).toFixed(d.amount%100?2:0)}元）`).join('、')}发一条私密提醒，内容：“${drafts[0].text.replace(/\d+(?:\.\d+)?元/,'……元')}”已付款的人不会收到。请确认后发送。`;}
  t.status='review';t.reviewToken=crypto.randomUUID();
  // Name what is being confirmed, so a listener knows without looking at the card.
  const facts=workflowReview(s,t).entries.filter(e=>!['无','否',''].includes(e.value)&&!['note','saveRecipient','autoSave'].includes(e.key)).slice(0,4).map(e=>e.label+'：'+e.value).join('；');
  t.message='请核对“'+t.title+'”'+(facts?'——'+facts+'。':'的当前信息。')+(t.functionId==='SU04'?'解除代扣不等于商户退订或退款。':t.functionId==='CA07'?'正式挂失后旧卡不可临时解冻恢复。':t.functionId==='IN08'?'产品和费率均为合成数据；可能亏损，申购受理不等于份额确认。':'本次仅操作沙箱数据。')+'确认后'+(needsAuth(t)?'在专门卡片完成演示认证。':'提交。');
  if(preview)t.message=preview;
 }catch(error){markFailure(current(s,t.id)||t,error);}
 return s;
}

/** Allocate a saved checklist without reading accounts, generating authorization, or executing a business. */
export function queueWorkflow(s:BankState,id:string,functionId:string,params:Params,cmd:WorkflowCommand):FlowTask{
 s.workflows ||= initialFlowStore();
 const f=functionById(functionId);if(!f)throw new WorkflowError('没有这个用户功能，请先澄清业务。');
 const existing=s.workflows.tasks.find(t=>t.id===id);if(existing){
  if(existing.status==='queued'){const patch=billingParams(s,existing,normalizedParams(functionId,params),cmd),changed=Object.fromEntries(Object.entries(patch).filter(([key,value])=>JSON.stringify(value)!==JSON.stringify(existing.params[key])));existing.params=patch;evidence(existing,changed,cmd);existing.missing=requiredFields(functionId,existing.params).filter(k=>existing.params[k]==null||existing.params[k]===''||k==='answers'&&!completeAnswers(existing.params[k]));}
  return existing;
 }
 if(s.workflows.tasks.filter(t=>!['complete','cancelled','external','unsupported'].includes(t.status)).length>=20)throw new WorkflowError('未完成任务较多，请先完成或取消已有任务。');
 const task:FlowTask={id,functionId,title:f.title,params:normalizedParams(functionId,params),status:'queued',missing:[],steps:[...new Set([...f.tools,'S07','S05','S06','S08','S11'])].map(toolId=>({toolId,title:toolById(toolId)?.title||toolId,status:'pending',reason:'尚未进入任务'})),reviewToken:null,verificationId:null,confirmedToken:null,result:null,message:'任务已保存，尚未开始。',createdAt:new Date().toISOString()};
 task.params=billingParams(s,task,task.params,cmd);
 task.missing=requiredFields(functionId,task.params).filter(k=>task.params[k]==null||task.params[k]===''||k==='answers'&&!completeAnswers(task.params[k]));
 evidence(task,task.params,cmd);s.workflows.tasks.push(task);return task;
}

/** Persisted state machine; models propose parameters but cannot authenticate or set passed flags. */
export function reduceWorkflow(previous:BankState,cmd:WorkflowCommand,requestId:string,legacy:LegacyReducer):BankState{
 let s=structuredClone(previous);s.workflows ||= initialFlowStore();s.workflows.version=WORKFLOW_VERSION;s.revision++;
 if(s.recentRequestIds.includes(requestId))return previous;
 const store=s.workflows;let task=current(s,cmd.taskId);
 if(cmd.operation==='settle'){
  if(cmd.source!=='card')throw new WorkflowError('推进沙箱结算只能通过页面明确操作。',403);
  const result=settleOrders(s);
  task={id:crypto.randomUUID(),functionId:'sandbox',title:'沙箱结算结果',params:{},status:'complete',missing:[],steps:[],reviewToken:null,verificationId:null,confirmedToken:null,result,message:'模拟结算已推进，请查询订单、持仓或余额。',createdAt:new Date().toISOString()};store.tasks.push(task);store.currentTaskId=task.id;
 }else if(cmd.operation==='list'||cmd.operation==='describe'){
  const definition=functionById(cmd.functionId||'');
  const result=cmd.operation==='list'?availableFunctions():definition?{...definition,acceptedFields:FIELDS[definition.id],actions:ACTIONS[definition.id]||[],capability:UNSUPPORTED_FUNCTIONS.has(definition.id)?'unavailable':'sandbox'}:undefined;
  if(!result)throw new WorkflowError('没有这个用户功能。');
  const f={id:crypto.randomUUID(),functionId:cmd.operation==='list'?'catalog':cmd.functionId||'catalog',title:'可办理功能',params:{},status:'complete',missing:[],steps:[],reviewToken:null,verificationId:null,confirmedToken:null,result,message:'功能目录已更新；sandbox 仅代表沙箱适配器，unavailable 尚未接入。',createdAt:new Date().toISOString()}as FlowTask;
  store.tasks.push(f);store.currentTaskId ||= f.id;task=f;
 }else if(cmd.operation==='run'){
  if(store.tasks.filter(t=>!['complete','cancelled','external','unsupported'].includes(t.status)).length>=20)throw new WorkflowError('未完成任务较多，请先继续或取消现有任务。');
  const f=functionById(cmd.functionId||'');if(!f)throw new WorkflowError('没有这个用户功能，请先查目录。');
  if(f.id==='TR03'&&s.task&&!['complete','cancelled'].includes(s.task.step))throw new WorkflowError('已有未完成转账，请继续修改或取消原任务，不并行创建第二份扣款草稿。');
  const params=normalizedParams(f.id,cmd.params||{});
  task={id:crypto.randomUUID(),functionId:f.id,title:f.title,params:{},status:'collecting',missing:[],steps:[...new Set([...f.tools,'S07','S05','S06','S08','S11'])].map(id=>({toolId:id,title:toolById(id)?.title||id,status:'pending',reason:'等待条件'})),reviewToken:null,verificationId:null,confirmedToken:null,result:null,message:'',createdAt:new Date().toISOString()};
  const bound=billingParams(s,task,params,cmd);
  const validated=cmd.source==='voice'?validateDraftVoice(s,task,bound,cmd):{params:bound,unverifiedParticipants:false,clearTotal:false};
  task.params=validated.params;if(validated.unverifiedParticipants)task.clarificationFields=['participants'];
  evidence(task,evidenceParams(task.params,validated.unverifiedParticipants),cmd);store.tasks.push(task);store.currentTaskId=task.id;s=prepare(s,task,legacy);clarifyUnverifiedAa(current(s,task.id)!);askRecipient(current(s,task.id)!,validated.recipientChoice);
 }else{
  if(!task)throw new WorkflowError('找不到当前办理任务，请先选择功能。');
  if(task.status==='queued'&&cmd.source!=='plan'&&!['status','cancel'].includes(cmd.operation))throw new WorkflowError('请通过任务清单进入待开始任务。');
  store.currentTaskId=task.id;
  if(cmd.operation==='status'){task.message=task.message||'当前状态已读取。';}
  else if(cmd.operation==='resume'){
   if(['complete','cancelled','external'].includes(task.status))throw new WorkflowError('该任务已结束或需要外部办理；请查询实际结果。');
   s=['review','authenticate'].includes(task.status)?retainProgress(s,task,legacy):prepare(s,task,legacy);
  }else if(cmd.operation==='amend'){
   if(['complete','cancelled','external'].includes(task.status))throw new WorkflowError('该任务已结束，不能修改为另一笔操作。');
   if(task.functionId==='IN05'&&task.params.action!=='status'&&cmd.params?.action==='status')throw new WorkflowError('查询测评记录请另建只读查询，正在填写的问卷会保留。');
   const params=normalizedParams(task.functionId,cmd.params||{});
   const bound=billingParams(s,task,params,cmd);
   const validated=cmd.source==='voice'?validateDraftVoice(s,task,bound,cmd):{params:bound,unverifiedParticipants:false,clearTotal:false};
   const patch=validated.params;
   const changed=Object.fromEntries(Object.entries(patch).filter(([key,value])=>JSON.stringify(value)!==JSON.stringify(task!.params[key])));
   Object.assign(task.params,patch);if(validated.clearTotal){delete task.params.total;delete task.fieldEvidence?.total;}
   if(validated.unverifiedParticipants){task.params.participants=[];task.clarificationFields=['participants'];delete task.fieldEvidence?.participants;}
   else if(Object.hasOwn(patch,'participants'))delete task.clarificationFields;
   evidence(task,evidenceParams(changed,validated.unverifiedParticipants),cmd);
   s=cmd.source==='voice'&&!Object.keys(changed).length&&!validated.clearTotal&&!validated.unverifiedParticipants&&['review','authenticate'].includes(task.status)?retainProgress(s,task,legacy):prepare(s,task,legacy);clarifyUnverifiedAa(current(s,task.id)!);askRecipient(current(s,task.id)!,validated.recipientChoice);
   if(task.params.recipientId)delete current(s,task.id)!.recipientChoices;
  }else if(cmd.operation==='cancel'){
   if(['complete','external'].includes(task.status))throw new WorkflowError('业务已提交/完成；取消对话不会撤回该结果。');
   if(cmd.source==='voice'&&(!/取消|不办|别.*办|不转|别转|结束(?!日期|时间)|停止|退出|不弄了|不做了|先这样|放弃|算了|不要了|换一个|换个业务/.test(cmd.utterance||'')||/不(?:要|用|必)?(?:取消|结束|退出|放弃)|别.{0,6}(?:取消|结束|退出|放弃)|不是要(?:取消|结束|退出|放弃)|不要不办|不要不转/.test(cmd.utterance||'')))throw new WorkflowError('需要明确取消当前业务，否定取消的表达不会执行取消。');
   if(task.functionId==='TR03'&&s.task?.id===task.legacyTaskId&&s.task&&!['complete','cancelled'].includes(s.task.step))s=legacy(s,{type:'cancel'},'flow-cancel-'+crypto.randomUUID());
   task=current(s,task.id)!;invalidate(task);task.status='cancelled';task.message='这项业务没有提交，已放下；没有扣款或改动，已完成的业务不受影响。';
  }else if(cmd.operation==='confirm'){
   if(cmd.source==='voice'&&!acknowledgesReview(cmd.utterance||''))throw new WorkflowError('请核对卡片后确认；有修改先更新草稿。');
   if(cmd.source==='voice')validateVoiceDraft(s,task,task.params,cmd.utterance||'');
   if(cmd.source==='voice'&&task.functionId==='CA06'&&(/解冻/.test(cmd.utterance||'')&&task.params.action==='freeze'||/冻结/.test(cmd.utterance||'')&&task.params.action==='unfreeze'))throw new WorkflowError('确认的操作与卡片不一致，请先修改草稿。');
   if(task.status==='authenticate'&&task.verificationId&&task.reviewToken&&task.reviewToken===cmd.token&&task.confirmedToken===task.reviewToken){s=retainProgress(s,task,legacy);return finalized(s,cmd,requestId,task.id);}
   if(task.status!=='review'||!task.reviewToken||cmd.token!==task.reviewToken)throw new WorkflowError('摘要已过期，请先核对当前版本。',409);
   if(task.functionId==='TR03'&&(!s.task||s.task.id!==task.legacyTaskId||s.task.reviewToken!==task.legacyReviewToken||s.task.step!=='review')){
    markFailure(task,new WorkflowError('转账草稿已被其他入口修改，请重新核对本任务参数后再确认。'));return finalized(s,cmd,requestId,task.id);
   }
   try{preflight(s,task);}catch(error){markFailure(task,error);s.lastReply=task.message;return finalized(s,cmd,requestId,task.id);}
   step(task,'S05','用户明确确认当前不可变摘要',()=>true);task.confirmedToken=task.reviewToken;
   if(needsAuth(task)){
    if(task.functionId==='TR03'){s=legacy(s,{type:'confirm'},'flow-confirm-'+crypto.randomUUID());task=current(s,task.id)!;task.verificationId=s.task!.verificationId;}
    else task.verificationId=crypto.randomUUID();
    task.status='authenticate';task.message='请在专门卡片输入演示验证码；模型不能代填或代认证。';
   }else s=perform(s,task.id,legacy);
  }else if(cmd.operation==='authenticate'){
   if(cmd.source!=='card')throw new WorkflowError('认证只能通过专门页面完成。',403);
   if(task.status!=='authenticate'||!task.verificationId||cmd.token!==task.verificationId||task.confirmedToken!==task.reviewToken)throw new WorkflowError('认证已失效，请重新核对当前摘要。',409);
   if(cmd.code!=='123456')throw new WorkflowError('演示验证码是 123456，请勿输入真实密码。');
   s=perform(s,task.id,legacy,cmd.code);
  }else throw new WorkflowError('不支持的任务操作。');
 }
 const id=task?.id||s.workflows!.currentTaskId!;return finalized(s,cmd,requestId,id);
}
function perform(original:BankState,id:string,legacy:LegacyReducer,code?:string){
 let s=structuredClone(original);const t=current(s,id)!;
 try{
  preflight(s,t);
  if(code)step(t,'S06','专门页面演示认证通过，仅返回认证结果',()=>true);
  const scheduled=t.functionId==='TR07'?rows(s,'transfers').find(r=>r.id===t.params.transferId&&r.status==='scheduled'):undefined;
  if(scheduled){
   step(t,'T09','延迟到账前撤销：释放占用，未转出资金',()=>true);const acc=s.accounts.find(a=>a.id===scheduled.accountId)!;acc.held=(acc.held||0)-Number(scheduled.amount);scheduled.status='revoked';
   finish(t,{...scheduled},'延迟到账前已撤销，占用的资金已释放，没有转出。');
  }else if(t.functionId==='TR07'){
   s=legacy(s,{type:'cancel'},'flow-cancel-draft-'+crypto.randomUUID());const live=current(s,id)!;step(live,'T09','只取消当前未完成草稿，不撤回已结算资金',()=>true);finish(live,{cancelled:true,transferId:live.params.transferId},'当前未完成转账草稿已取消，未转出资金。');
  }else if(t.functionId==='TR03'){
   s=legacy(s,{type:'authenticate',code:code!,verificationId:t.verificationId!},'flow-auth-'+crypto.randomUUID());
   const live=current(s,id)!;step(live,'T07','复用原转账受控提交，幂等更新余额',()=>true);
   const archive=typeof live.params.archive==='string'?live.params.archive:undefined;
   const delayed=rows(s,'transfers').find(r=>r.taskId===live.legacyTaskId&&r.status==='scheduled');
   if(delayed){if(archive)delayed.archive=archive;finish(live,{...delayed,status:'pending',executionState:'scheduled',executionNotice:delayedNotice(delayed)},s.lastReply);}
   else{if(archive)s.receipts[0].archive=archive;finish(live,transferView(s.receipts[0]),s.lastReply+(archive?`凭证已归档到“${archive}”。`:''));}
   if(live.params.saveRecipient===true)step(live,'T14','仅明确请求保存时追加个人联系人',()=>rows(s,'contacts').push({id:crypto.randomUUID(),recipientId:live.params.recipientId,name:contactsOf(s).find(c=>c.id===live.params.recipientId)?.name||'',source:'用户确认保存'}));
  }else{
   const result=executeBusiness(s,t);
   if(t.status!=='external')finish(t,result,'已完成当前沙箱操作。资金或订单的后续状态以明细为准。');
   else{t.result=result;t.message='请到官方平台亲自办理；当前未取消、未核验。';t.verificationId=null;}
  }
 }catch(error){s=structuredClone(original);markFailure(current(s,id)!,error);}
 return s;
}
function finalized(s:BankState,cmd:WorkflowCommand,requestId:string,id:string){
 const t=current(s,id)!;s.view='workflow';s.lastReply=t.message;
 // Optional capabilities must report their actual limits without undoing a successful core action.
 const optional:Record<string,[string,string,string][]>= {
  TR01:[['accountType','T01','账户类型筛选尚未接入，本次返回全部演示账户。']],
  TR05:[['reminder','T13','AA 提醒交付尚未接入，未发送提醒。']],
  BI04:[['prepareEvidence','S16','争议材料导出尚未接入，本次只返回核对线索。']],
  BI06:[['peerComparison','B08','匿名群体数据尚未接入，未生成分位。'],['share','S15','分享物料尚未接入，未生成或发布海报。']],
  SU04:[['verifyReminder','D10','后续核验提醒尚未自动建立。'],['evidenceExport','S16','争议材料导出尚未接入。']],
  SU05:[['prepareEvidence','S16','争议材料导出尚未接入，本次只返回当前状态。']],
  SU08:[['incomeDates','D11','到账日与资金缺口联算尚未接入。'],['reserveReminder','D10','资金预留提醒尚未建立。']],
  IN03:[['includeProjection','I01','目标进度预测尚未接入，本次只返回已入账余额和实际进度。']],
  CA02:[['includeSafetyHistory','C12','守护历史数据尚未接入，本次只返回当前卡片信息。']],
  CA07:[['expiryReminder','D10','挂失到期提醒尚未建立。']],
 };
 const requested=(v:unknown)=>v!==undefined&&v!==null&&v!==false&&v!==''&&(!Array.isArray(v)||v.length>0);
 const limitations=(optional[t.functionId]||[]).filter(([key])=>requested(t.params[key]));
 if(requested(t.params.receiptExport))limitations.push(['receiptExport','S09','回执文件导出尚未接入，当前只能查看已保存的业务结果。']);
 t.limitations=limitations.map(([, ,reason])=>reason);
 for(const [,toolId,reason]of limitations){const item=t.steps.find(x=>x.toolId===toolId);if(item&&item.status!=='passed'){item.status='blocked';item.reason=reason;}}
 if(t.limitations.length&&['complete','external'].includes(t.status)&&!t.message.includes('部分附加请求尚未完成')){
  t.message+=' 部分附加请求尚未完成，详情见能力说明；已提交业务不会重复执行。';s.lastReply=t.message;
 }
 const audit=t.steps.find(x=>x.toolId==='S11');if(audit){audit.status='passed';audit.reason='随会话状态和 revision 一起原子保存';}
 s.workflows!.log=[...s.workflows!.log.slice(-199),{id:requestId,at:new Date().toISOString(),taskId:id,operation:cmd.operation,status:t.status,reason:t.message,revision:s.revision}];
 s.recentRequestIds=[...s.recentRequestIds.slice(-63),requestId];
 // Keep pending tasks for resumption; bound only completed history.
 const terminal=['complete','cancelled','unsupported','external'];
 const pending=s.workflows!.tasks.filter(x=>!terminal.includes(x.status));
 s.workflows!.tasks=[...s.workflows!.tasks.filter(x=>terminal.includes(x.status)).slice(-30),...pending];
 return s;
}
export const currentWorkflow=(s:BankState)=>s.workflows?current(s):undefined;
export { ACTIONS };

