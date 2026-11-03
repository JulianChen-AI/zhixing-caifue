import type { BankAction, BankState } from '../bank/types.ts';
import { functionById } from '../workflows/catalog.ts';
import { assertVoiceEvidence, normalizedParams } from '../workflows/fields.ts';
import {materialize,flattenPlan} from './materialize.ts';
import { isWrite, readTool } from '../workflows/adapters.ts';
import { WorkflowError, type FlowTask, type Params } from '../workflows/types.ts';
import { ambiguousRecipients, contactsOf, recipientChoiceQuestion } from '../bank/recipients.ts';
import { decompose, extractParams, inferFunction, isComplexRequest, hasFunctionScope } from './decompose.ts';
import type { Calculation, PlanCommand, PlanStep, TaskPlan } from './types.ts';
import { workflowTextAction } from '../workflows/offline.ts';
import {isBillingQuery,resolveBillingQuery} from '../workflows/billing-query.ts';
import { appendFamilyBudget, familyBudgetAmount, hasFamilyBudgetContext, isMonthlyRequest, openMonthlyPlan } from './monthly.ts';

type Reducer=(s:BankState,a:BankAction,id:string)=>BankState;
const terminal=(p:TaskPlan)=>['complete','cancelled'].includes(p.status);
export const STALE_PLAN_MS=10*60*1000;
export const activePlan=(s:BankState)=>s.plan&&!terminal(s.plan)?s.plan:undefined;
export const currentPlanStep=(s:BankState)=>activePlan(s)?.steps.find(x=>x.kind==='clarify'&&!['complete','cancelled'].includes(x.status))||activePlan(s)?.steps.find(x=>!['complete','cancelled'].includes(x.status));
const child=(s:BankState,step:PlanStep)=>s.workflows?.tasks.find(t=>t.id===step.taskId);
function calculationEvidence(task:FlowTask,binding:string){
 task.fieldEvidence||={};for(const key of ['amount','accountId'])task.fieldEvidence[key]={source:'calculation',quote:'外层步骤 '+binding+' 的账户余额比较和比例计算结果'};
}
function openSummary(p:TaskPlan,step:PlanStep){
 p.summaryTurnIds=[...new Set([...(p.summaryTurnIds||[]),...p.steps.flatMap(x=>x.openedTurnId?[x.openedTurnId]:[]),...(p.lastUserTurnId?[p.lastUserTurnId]:[])])];
 step.openedTurnId=p.lastUserTurnId;
}
function log(p:TaskPlan,event:string,reason:string,stepId?:string){p.log=[...p.log.slice(-99),{at:new Date().toISOString(),event,reason,stepId}];}
type RecipientAsk={question:string;choices:string[]};
/** A shared payee name drops the model's pick and returns the candidates to ask about. */
function evidence(s:BankState,step:PlanStep,params:Params,text:string,source:'voice'|'card'):RecipientAsk|undefined{
 if(source!=='voice')return;
 const task=child(s,step)||({functionId:step.functionId,params:{}} as FlowTask);
 const named=()=>{const same=step.functionId==='TR03'&&params.recipientId==null&&!task.params.recipientId?ambiguousRecipients(text,s.accounts.map(a=>a.tail),contactsOf(s)):[];return same.length>1?{question:recipientChoiceQuestion(same),choices:same.map(c=>c.id)}:undefined;};
 try{assertVoiceEvidence(s,task,params,text);return named();}
 catch(error){
  if(step.functionId!=='TR03'||!(error instanceof WorkflowError)||error.field!=='recipientChoice')throw error;
  delete params.recipientId;assertVoiceEvidence(s,task,params,text);
  return {question:error.message,choices:ambiguousRecipients(text,s.accounts.map(a=>a.tail),contactsOf(s)).map(c=>c.id)};
 }
}
function askRecipient(s:BankState,step:PlanStep|undefined,ask:RecipientAsk|undefined){
 const task=ask&&step&&child(s,step);if(!task)return;
 task.recipientChoices=ask.choices;
 if(task.status==='collecting'&&task.missing.includes('recipientId')){task.message=ask.question;if(s.plan)s.plan.message=ask.question;s.lastReply=ask.question;}
}
function calculate(s:BankState,step:PlanStep):Calculation|undefined{
 const f=step.formula!;
 const snapshot=(readTool(s,'T02') as {id:string;balance:number}[]).map(({id,balance})=>({id,balance}));
 let candidates=snapshot;
 if(f.selector==='explicit')candidates=snapshot.filter(a=>a.id===f.accountId);
 else {const extreme=(f.selector==='lowest'?Math.min:Math.max)(...snapshot.map(a=>a.balance));candidates=snapshot.filter(a=>a.balance===extreme);if(f.accountId)candidates=candidates.filter(a=>a.id===f.accountId);}
 if(candidates.length!==1){step.status='collecting';step.question=candidates.length>1?'账户余额相同，请明确选择用于计算的账户。':'请明确用于比例计算的账户，指定账户也必须符合比较条件。';return;}
 const a=candidates[0],product=BigInt(a.balance)*BigInt(f.numerator),amountCents=Number(product/BigInt(f.denominator));
 if(!Number.isSafeInteger(amountCents)||amountCents<=0)throw new WorkflowError('比例计算后不足一分钱，请修改比例或金额。');
 return {accountId:a.id,balanceCents:a.balance,amountCents,numerator:f.numerator,denominator:f.denominator,rounding:'down-to-cent',remainder:Number(product%BigInt(f.denominator)),snapshot,revision:s.revision};
}
function waitingExternal(s:BankState,t:FlowTask){
 if(['IN08','IN09'].includes(t.functionId)){
  const id=(t.result as {id?:string}|null)?.id,order=s.workflows?.records.orders.find(o=>o.id===id);
  if(order?.status==='cancelled')return 'cancelled';
  if(order?.status==='settled')return false;
  if(order?.status==='pending')return true;
 }
 return t.status==='external';
}
const unfinished=(x:PlanStep)=>!['complete','cancelled'].includes(x.status);
/**
 * A new request does not queue behind a one-item checklist whose card was never submitted. A blocked card ends;
 * an unfinished draft is set aside under 未完成业务 (answers kept, resumable) when the new request changes something
 * too. A quick question ("先查下余额") still returns to the draft, and multi-item checklists keep their order.
 */
const INSERT_FIRST=/先插|插一个|插个|顺便|等会儿?(?:再)?继续|回头(?:再)?继续|办完再继续|中间先/;
function setAsideLoneDraft(s:BankState,cmd:PlanCommand,reducer:Reducer):{state:BankState;note:string}|undefined{
 const p=s.plan;if(!p||p.monthly||terminal(p))return;
 const open=p.steps.filter(unfinished);if(open.length!==1||open[0].kind!=='workflow')return;
 const task=child(s,open[0]);if(!task||!['collecting','review','blocked'].includes(task.status))return;
 const incoming=cmd.tasks?.map(t=>({functionId:t.functionId,params:t.params||{}}))||(cmd.functionId?[{functionId:cmd.functionId,params:cmd.params||{}}]:[]);
 // A prerequisite (测评 before 申购, 挂失 before 补卡) is inserted on purpose so the blocked card can continue after it.
 if(!incoming.length||cmd.adoptTaskId||cmd.prerequisite)return;
 const drop=(note:string)=>{
  const state=reducer(s,{type:'workflow',command:{operation:'cancel',taskId:task.id,source:'card'}},'drop-draft-'+crypto.randomUUID());
  state.plan!.steps.find(x=>x.id===open[0].id)!.status='cancelled';state.plan!.status='cancelled';state.plan!.currentTaskId=undefined;
  return {state,note};
 };
 if(task.status==='blocked')return drop('');
 // Saying so ("先插一个…", "顺便…", "等会继续") keeps the old behaviour: the new business runs first, then the draft returns.
 if(!incoming.some(t=>isWrite(t))||incoming.some(t=>t.functionId===task.functionId)||INSERT_FIRST.test(cmd.utterance||''))return;
 // The transfer engine keeps one open transfer at a time, so an unsubmitted transfer is dropped rather than parked.
 if(task.functionId==='TR03')return drop(`上一笔“${task.title}”还没提交，已放下，没有扣款。`);
 return {state:s,note:`上一项“${task.title}”还没提交，已先放到“未完成业务”，需要时可以继续。`};
}
function focus(s:BankState,entry?:PlanStep){
 s.plan!.currentTaskId=entry?.taskId||entry?.id;
 if(entry?.taskId)s.workflows!.currentTaskId=entry.taskId;
 s.view='workflow';
}
function trimHistory(p:TaskPlan){
 const needed=new Set(p.steps.filter(unfinished).flatMap(x=>x.binding?[x.binding]:[]));
 const history=p.steps.filter(x=>!unfinished(x)&&!needed.has(x.id));const removed=new Set(history.slice(0,-30).map(x=>x.id));
 p.steps=p.steps.filter(x=>!removed.has(x.id));for(const x of p.steps)x.dependsOn=x.dependsOn.filter(id=>!removed.has(id));
 p.taskIds=p.steps.filter(x=>x.kind==='workflow'&&x.taskId).map(x=>x.taskId!);
}
/** A single queue owns activation; creating a saved checklist never executes it. */
function pump(input:BankState,reducer:Reducer):BankState{
 let s=input,p=s.plan!;p.announcements||=[];
 if(terminal(p)||p.status==='paused')return s;
 const unclear=p.steps.find(x=>x.kind==='clarify'&&unfinished(x));
 if(unclear){unclear.status='collecting';p.status='collecting';focus(s,unclear);p.message=unclear.question||'请先明确业务用途，尚未执行。';s.lastReply=p.message;return s;}
 for(let remaining=24;remaining>0;remaining--){
  p=s.plan!;const entry=p.steps.find(unfinished);
  if(!entry){p.status=p.steps.every(x=>x.status==='cancelled')?'cancelled':'complete';p.currentTaskId=undefined;p.message=p.monthly?'月度计划各项已处理；投资申请若已受理仍待结算，并非持仓确认。':(p.announcements||[]).join('')+'这份任务清单已结束，各任务结果已保存。';s.lastReply=p.message;trimHistory(p);return s;}
  if(entry.dependsOn.some(id=>p.steps.find(x=>x.id===id)?.status!=='complete')){p.status='blocked';p.message='前序任务未完成，后续任务暂停。';s.lastReply=p.message;return s;}
  const switching=p.currentTaskId!==(entry.taskId||entry.id);p.status='running';p.currentTaskId=entry.taskId||entry.id;
  if(entry.kind==='calculation'){
   try{const result=calculate(s,entry);if(!result){p.message=entry.question!;s.lastReply=p.message;return s;}entry.calculation=result;entry.status='complete';entry.question=undefined;log(p,'calculated','后台按当前余额计算，尚未授权执行。',entry.id);continue;}
   catch(e){entry.status='blocked';entry.question=(e as Error).message;p.status='blocked';p.message=entry.question;s.lastReply=p.message;return s;}
  }
  if(!child(s,entry))materialize(s,p,'card',[entry]);
  let task=child(s,entry)!;
  // A step left blocked behind a prerequisite that was inserted and has now completed gets one fresh check.
  const before=p.steps[p.steps.indexOf(entry)-1];
  if(switching&&task.status==='blocked'&&before?.inserted&&before.status==='complete'){s=reducer(s,{type:'workflow',command:{operation:'resume',taskId:task.id,source:'plan'}},'plan-recheck-'+crypto.randomUUID());p=s.plan!;task=child(s,p.steps.find(x=>x.id===entry.id)!)!;}
  if(task.status==='queued'){
   if(entry.binding){const calc=p.steps.find(x=>x.id===entry.binding)?.calculation;if(!calc)throw new WorkflowError('缺少已完成的计算依据。');entry.params={...entry.params,accountId:calc.accountId,amount:calc.amountCents/100};task.params={...entry.params};}
   s=reducer(s,{type:'workflow',command:{operation:'resume',taskId:task.id,source:'plan'}},'plan-activate-'+crypto.randomUUID());
   p=s.plan!;task=child(s,p.steps.find(x=>x.id===entry.id)!)!;const live=p.steps.find(x=>x.id===entry.id)!;
   openSummary(p,live);if(live.binding)calculationEvidence(task,live.binding);p.announcements||=[];p.announcements.push('现在办理“'+live.title+'”。');
   log(p,'activated','进入已保存的 Checklist，使用同一个任务编号。',live.id);
  }
  const live=s.plan!.steps.find(x=>x.id===entry.id)!;if(switching&&task.status!=='queued'&&!['complete','cancelled'].includes(task.status)&&!s.plan!.announcements!.some(x=>x.includes(live.title)))s.plan!.announcements!.push('继续办理“'+live.title+'”，已填信息保留。');focus(s,live);
  const external=p.monthly&&task.functionId==='IN08'&&task.status==='complete'?false:waitingExternal(s,task);live.status=external==='cancelled'?'blocked':external?'external':task.status==='unsupported'?'blocked':task.status==='queued'?'pending':task.status;live.result=task.result;
  if(live.status==='complete'||live.status==='cancelled'){
   s.plan!.announcements!.push('“'+live.title+'”'+(live.status==='complete'?(s.plan!.monthly&&live.functionId==='IN08'?'已受理，等待结算。':!isWrite(task)&&task.message&&s.plan!.steps.some(unfinished)?'：'+task.message.trim().replace(/[。.]?$/,'。'):'已完成。'):'已取消。'));log(s.plan!,live.status,'后台检查清单中的下一项。',live.id);
   if((live.pauseAfter||live.status==='cancelled'&&!live.inserted)&&s.plan!.steps.some(unfinished)){s.plan!.status='paused';focus(s,s.plan!.steps.find(unfinished));s.plan!.message=(s.plan!.announcements||[]).join('')+'任务清单仍暂停，进度已保留。';s.lastReply=s.plan!.message;return s;}
   continue;
  }
  if(['blocked','external'].includes(live.status)){s.plan!.status='blocked';s.plan!.message=external?'当前任务仍在等待实际结算或外部办理。':task.message;}
  else s.plan!.message=(s.plan!.announcements||[]).join('')+task.message;
  s.lastReply=s.plan!.message;trimHistory(s.plan!);return s;
 }
 throw new WorkflowError('任务调度超出预设上限，已停止。');
}
/** Move an existing eligible task, never another Plan, into the current queue position. */
function selectTask(s:BankState,id:string){
 const p=s.plan!,entry=p.steps.find(x=>x.id===id||x.taskId===id);if(!entry||!unfinished(entry))throw new WorkflowError('请选择清单中尚未完成的任务。');
 const active=currentPlanStep(s),t=active&&child(s,active);
 if(t?.status==='authenticate'&&entry!==active)throw new WorkflowError('当前业务正在等待认证，请先完成或取消认证再切换。');
 if(entry.dependsOn.some(id=>p.steps.find(x=>x.id===id)?.status!=='complete'))throw new WorkflowError('前序任务尚未完成，不能提前执行这项业务。');
 const index=p.steps.findIndex(unfinished);p.steps.splice(p.steps.indexOf(entry),1);p.steps.splice(index,0,entry);focus(s,entry);p.taskIds=p.steps.filter(x=>x.taskId).map(x=>x.taskId!);return entry;
}

export function assertPlanAccess(s:BankState,a:BankAction){
 const p=activePlan(s);if(!p||a.type==='plan'||['home','reset'].includes(a.type))return;
 if(a.type==='workflow'&&['status','list','describe','settle'].includes(a.command.operation))return;
 if(a.type==='route'&&a.decision.draft?.kind==='balance')return;
 const step=currentPlanStep(s);
 if(p.monthly?.rentUnknown&&step?.functionId==='TR03'&&a.type==='workflow'&&!['status','list','describe'].includes(a.command.operation))throw new WorkflowError('房租结果待核对，请回查原订单，不能重复付款。');
 if(p.status==='paused'||p.status==='collecting')throw new WorkflowError('外层步骤尚未明确或已暂停，请先补充或恢复任务清单。');
 if(a.type!=='workflow'||!step?.taskId||a.command.taskId!==step.taskId)throw new WorkflowError('请继续当前外层步骤对应的业务清单，不能跳过依赖或另外发起任务。');
 if(a.command.operation==='confirm'&&a.command.source==='voice'){
  const cmd=a.command,used=p.confirmations?.find(x=>x.turnId===cmd.turnId);
  if(!cmd.turnId||p.summaryTurnIds?.includes(cmd.turnId)||p.steps.some(x=>x.openedTurnId===cmd.turnId)||used&&(used.taskId!==cmd.taskId||used.token!==cmd.token))throw new WorkflowError('请先向用户核对本步骤的新摘要，再等待新一轮明确确认；之前的确认不能授权下一步。');
 }
 if(step.dependsOn.some(id=>p.steps.find(x=>x.id===id)?.status!=='complete'))throw new WorkflowError('前序步骤未完成，不能执行当前业务。');
}
/** Re-read derived amounts before confirmation/authentication. Never execute against stale facts. */
export function refreshPlanCalculation(previous:BankState,a:BankAction,id:string,reducer:Reducer):BankState|null{
 const step=currentPlanStep(previous),p=activePlan(previous);
 if(!p||!step?.binding||a.type!=='workflow'||!['confirm','authenticate'].includes(a.command.operation))return null;
 const old=p.steps.find(x=>x.id===step.binding)?.calculation;
 if(old&&old.snapshot.length===previous.accounts.length&&old.snapshot.every(x=>previous.accounts.some(a=>a.id===x.id&&a.balance===x.balance)))return null;
 let s=structuredClone(previous);const calc=s.plan!.steps.find(x=>x.id===step.binding)!;
 let result:Calculation|undefined,failed=false;
 try{result=calculate(s,calc);}catch(e){failed=true;calc.status='blocked';calc.question=(e as Error).message;}
 if(!result){
  calc.calculation=undefined;
  const t=child(s,step)!;s=reducer(s,{type:'workflow',command:{operation:'cancel',taskId:t.id,source:'card'}},'plan-revoke-'+crypto.randomUUID());
  const live=s.plan!.steps.find(x=>x.id===step.id)!,saved=child(s,live)!;saved.status='queued';saved.reviewToken=null;saved.verificationId=null;saved.confirmedToken=null;saved.result=null;delete saved.legacyTaskId;delete saved.legacyReviewToken;live.status='pending';s.plan!.status=failed?'blocked':'running';s.plan!.message=calc.question!;
 }else{
  calc.calculation=result;calc.status='complete';
  s=reducer(s,{type:'workflow',command:{operation:'amend',taskId:step.taskId,params:{accountId:result.accountId,amount:result.amountCents/100},source:'plan'}},'plan-recalculate-'+crypto.randomUUID());
  const live=s.plan!.steps.find(x=>x.id===step.id)!,t=child(s,live)!;calculationEvidence(t,step.binding);live.params={...live.params,accountId:result.accountId,amount:result.amountCents/100};live.status=t.status==='blocked'?'blocked':'review';openSummary(s.plan!,live);
  s.plan!.message='账户余额发生变化，已重新计算比例金额。请重新核对当前摘要；本次没有执行转账。';
 }
 s.lastReply=s.plan!.message;s.view='workflow';log(s.plan!,'facts_changed',s.plan!.message,step.id);s.revision++;s.recentRequestIds=[...s.recentRequestIds.slice(-63),id];return s;
}
export function reconcilePlan(s:BankState,a:BankAction,reducer:Reducer,previous?:BankState):BankState{
 if(a.type==='workflow'&&['list','describe'].includes(a.command.operation))return s;
 flattenPlan(s);if(!activePlan(s)||a.type==='home')return s;
 s.plan!.announcements=[];
 if(a.type==='workflow'&&a.command.operation==='confirm'&&a.command.source==='voice'&&a.command.turnId){
  const cmd=a.command,t=s.workflows?.tasks.find(t=>t.id===cmd.taskId);
  if(t&&cmd.turnId&&cmd.token&&t.confirmedToken===cmd.token&&['authenticate','complete'].includes(t.status)&&!s.plan!.confirmations?.some(x=>x.turnId===cmd.turnId)){
   s.plan!.confirmations=[...(s.plan!.confirmations||[]),{turnId:cmd.turnId,taskId:t.id,token:cmd.token}];
  }
 }
 const step=currentPlanStep(s);
 if(step?.taskId&&a.type==='workflow'&&a.command.taskId===step.taskId&&a.command.operation==='amend'){
  const updated=child(s,step)!;
  if(step.binding&&['amount','accountId'].some(k=>Object.hasOwn(a.command.params||{},k)&&JSON.stringify(step.params[k])!==JSON.stringify(updated.params[k]))){step.binding=undefined;log(s.plan!,'user_override','用户明确修改计算结果，后续使用新的固定字段。',step.id);}
  if(JSON.stringify(step.params)!==JSON.stringify(updated.params)||previous&&child(previous,step)?.reviewToken!==updated.reviewToken)openSummary(s.plan!,step);
  step.params={...updated.params};
 }
 const settlement=a.type==='workflow'&&a.command.operation==='settle'?s.workflows?.currentTaskId:undefined;
 const reconciled=pump(s,reducer);
 // Advance dependencies using the settled order facts, while showing the result
 // of the user's explicit settlement action instead of the old acceptance card.
 if(settlement&&reconciled.workflows){reconciled.workflows.currentTaskId=settlement;reconciled.view='workflow';reconciled.lastReply=reconciled.workflows.tasks.find(task=>task.id===settlement)!.message;}
 return reconciled;
}

export function reducePlan(previous:BankState,cmd:PlanCommand,id:string,reducer:Reducer):BankState{
 if(cmd.operation==='interrupt'&&cmd.source==='voice'&&!cmd.functionId&&!cmd.params&&!cmd.steps&&!cmd.tasks){
  const amount=familyBudgetAmount(cmd.utterance||'',hasFamilyBudgetContext(previous));const entry=previous.plan?.monthly&&amount!=null?previous.plan.steps.find(x=>x.functionId==='BI08'&&x.params.category==='聚餐'&&x.params.period==='本周'&&!['complete','cancelled'].includes(x.status)):undefined;
  if(entry&&entry.params.amount!==amount)return reducePlan(previous,{operation:'amend',taskId:entry.id,params:{amount},source:'voice',utterance:cmd.utterance},id,reducer);
  const added=appendFamilyBudget(previous,cmd.utterance||'',id);if(added)return added;
 }
 if(cmd.operation==='open_saved'||cmd.operation==='create'&&cmd.source==='voice'&&isMonthlyRequest(cmd.utterance||'')){
  if(cmd.functionId||cmd.params||cmd.steps||cmd.tasks||cmd.adoptTaskId)throw new WorkflowError('月度模板只能从已保存数据读取。');
  // “做本月安排，再留400请爸妈吃饭”: the extra budget joins the opened plan as its own unpaid draft.
  const opened=openMonthlyPlan(previous,id);
  const clause=(cmd.utterance||'').split(/[，,。；;]/).find(part=>{try{return familyBudgetAmount(part)!=null;}catch{return false;}});
  const s=clause?appendFamilyBudget(opened,clause.trim(),id+'-family')||opened:opened;
  const known=[previous.plan?.id,...Object.values(previous.monthlyHistory||{}).map(x=>x.id)];
  if(s.plan?.monthly&&!known.includes(s.plan.id))s.lastReply='先看数据范围和计划，现在还没有执行任何付款或申购。'+(clause?'已按模板列出各项，并追加本周聚餐预算草稿（不付款、不冻结）。':'已按模板列出各项。')+'先保障必要支出，每项都能修改或删除。';
  return s;
 }
 let s=structuredClone(previous);flattenPlan(s);s.revision++;if(s.plan)s.plan.announcements=[];let asideNote='';
 // A checklist left untouched for a while is no longer this conversation's: a new request starts its own and the old tasks wait under 未完成业务.
 let existing=activePlan(s);
 // A user's new request joins the checklist only while they are filling its current card (so a quick question
 // returns to it). A blocked or waiting card, or one left alone for a while, is not "this" task: the request starts
 // its own checklist and the old card waits under 未完成业务 instead of coming back by itself.
 if(existing&&!existing.monthly&&(cmd.operation==='create'||cmd.operation==='interrupt')&&!cmd.prerequisite){
  const at=currentPlanStep(s),task=at&&child(s,at);
  if(Date.now()-Date.parse(existing.log.at(-1)?.at||existing.createdAt)>STALE_PLAN_MS||!task||!['collecting','review','queued'].includes(task.status))existing=undefined;
 }
 if(cmd.operation==='create'||cmd.operation==='interrupt'){const aside=setAsideLoneDraft(s,cmd,reducer);if(aside){s=aside.state;existing=undefined;asideNote=aside.note;}}
 if(cmd.planId&&s.plan&&cmd.planId!==s.plan.id)throw new WorkflowError('任务清单已更新，请读取最新状态。',409);
 if(cmd.operation==='create'||cmd.operation==='interrupt'){
  if(existing&&cmd.operation==='create')throw new WorkflowError('已有任务清单，请插入新业务或继续当前任务。');
  if(existing&&currentPlanStep(s)&&child(s,currentPlanStep(s)!)?.status==='authenticate')throw new WorkflowError('当前业务正在等待认证，请先完成或取消认证再切换。');
  const adopted=cmd.adoptTaskId?s.workflows?.tasks.find(t=>t.id===cmd.adoptTaskId&&t.functionId===cmd.functionId&&['queued','collecting','review','blocked'].includes(t.status)):undefined;
  if(cmd.adoptTaskId&&!adopted)throw new WorkflowError('原任务已变化，请刷新。',409);
  if(!existing&&s.task&&!['complete','cancelled'].includes(s.task.step)&&adopted?.legacyTaskId!==s.task.id)throw new WorkflowError('已有未完成转账，请先恢复原任务。');
  const text=cmd.utterance||cmd.clarification||'';
  if(cmd.functionId&&(!functionById(cmd.functionId)||cmd.source==='voice'&&inferFunction(text)&&inferFunction(text)!.slice(0,2)!==cmd.functionId.slice(0,2)))throw new WorkflowError('所选业务与本轮要求不一致，未建立任务。');
  // A model may select the right business while omitting fields already said
  // by the user. Preserve those fields through the same parser and evidence
  // checks used by multi-step decomposition; proposed conflicting values still fail.
  const initialParams=cmd.functionId?normalizedParams(cmd.functionId,{...(cmd.source==='voice'?extractParams(text,cmd.functionId,s):{}),...cmd.params}):{};
  const incoming=cmd.functionId?{id:crypto.randomUUID(),layer:'double' as const,status:'collecting' as const,steps:[{id:adopted?.id||crypto.randomUUID(),kind:'workflow' as const,title:functionById(cmd.functionId)!.title,quote:text,functionId:cmd.functionId,params:adopted?.params||initialParams,...(adopted?{taskId:adopted.id}:{}),dependsOn:[],status:'pending' as const}],message:'正在安排任务。',createdAt:new Date().toISOString(),log:[]}:decompose(text,s,cmd.tasks||cmd.steps);
  if(existing?.monthly?.rentUnknown&&incoming.steps.some(x=>x.functionId==='TR03'))throw new WorkflowError('房租原订单结果待核对，不能另建转账；请先回查原订单。');
  const asks=new Map<string,RecipientAsk>();
  if(!adopted)for(const entry of incoming.steps.filter(x=>x.kind==='workflow')){
   if(cmd.source==='voice'&&isBillingQuery(entry.functionId||''))entry.params=resolveBillingQuery(s,entry.params,entry.quote).params;
   const ask=evidence(s,{...entry,params:{}},entry.params,entry.quote,cmd.source);if(ask)asks.set(entry.id,ask);
  }
  let p:TaskPlan=incoming;
  if(existing){
   p=s.plan!;const paused=p.status==='paused',at=p.steps.findIndex(unfinished);
   for(const x of incoming.steps)x.inserted=true;
   incoming.steps.at(-1)!.pauseAfter=paused;
   p.steps.splice(at<0?p.steps.length:at,0,...incoming.steps);p.status='running';
  }else {
   if(s.plan?.monthly){s.monthlyHistory||={};s.monthlyHistory[s.plan.monthly.period]=structuredClone(s.plan);}
   s.plan=p;
  }
  materialize(s,p,cmd.source,incoming.steps);p.lastUserTurnId=cmd.turnId||id;p.summaryTurnIds=[...new Set([...(p.summaryTurnIds||[]),p.lastUserTurnId])];
  log(p,existing?'inserted':'created','已创建并保存所有业务实例，尚未执行后续任务。');s.view='workflow';s=pump(s,reducer);
  for(const [stepId,ask] of asks)askRecipient(s,s.plan?.steps.find(x=>x.id===stepId),ask);
  if(asideNote)s.lastReply=asideNote+s.lastReply;
 }else{
  const p=s.plan;if(!p)throw new WorkflowError('尚无任务清单，请先描述业务。');
  if(cmd.source==='voice'&&cmd.turnId)p.lastUserTurnId=cmd.turnId;
  if(cmd.operation==='status'){
   if(p.monthly?.rentUnknown){const entry=p.steps.find(x=>x.functionId==='TR03'),task=child(s,entry!),original=task?.legacyTaskId,order=s.workflows?.records.transfers?.find(x=>x.id===original&&x.status==='unknown');
    if(order&&task){task.result={...order};task.message='已回查原模拟订单，结果仍待核对，未确认扣款；不会创建新订单。';s.lastReply=task.message;s.view='workflow';s.workflows!.currentTaskId=task.id;s.recentRequestIds=[...s.recentRequestIds.slice(-63),id];return s;}
   }
   return previous;
  }
  if(terminal(p))throw new WorkflowError('任务清单已结束，不会重做已完成业务。');
  const targetId=cmd.taskId||cmd.stepId;
  if(cmd.operation==='pause'){p.status='paused';p.message='任务已暂停，已填字段和当前任务保留。';log(p,'paused',p.message);}
  else if(cmd.operation==='cancel'){
   if(p.monthly?.rentUnknown&&(!targetId||p.steps.some(x=>(x.id===targetId||x.taskId===targetId)&&x.functionId==='TR03')))throw new WorkflowError('房租原订单结果待核对，不能通过取消清单抹去或重付。');
   if(cmd.source==='voice'&&(!/取消|不办|算了|结束(?!日期|时间)|停止|退出|不弄了|不做了|先这样|放弃/.test(cmd.utterance||'')||/不(?:要|用|必)?(?:取消|结束|退出|放弃)|别.{0,6}(?:取消|结束|退出|放弃)|不是要(?:取消|结束|退出|放弃)|不要不办|不要算了/.test(cmd.utterance||'')))throw new WorkflowError('请明确是否取消剩余任务。');
   const all=!targetId&&(cmd.source==='card'||/取消(?:全部|所有|剩余|整份|整个|整张)|取消.*(?:全部|所有|剩余)(?:任务|步骤|业务)|^(?:不办了|算了)/.test(cmd.utterance||''));
   let entries=p.steps.filter(unfinished);
   if(!all){
    const inferred=inferFunction(cmd.utterance||''),matches=entries.filter(x=>x.functionId===inferred||typeof x.params.name==='string'&&(cmd.utterance||'').includes(x.params.name));
    const target=targetId?entries.find(x=>x.id===targetId||x.taskId===targetId):matches.length===1?matches[0]:/这|当前|该/.test(cmd.utterance||'')?currentPlanStep(s):undefined;
    if(!target)throw new WorkflowError('请明确要取消哪项任务，或明确取消全部剩余任务。');entries=[target];
   }
   for(const entry of entries){
    const task=child(s,entry);if(entry.status==='external'||task?.status==='external')continue;
    if(task&&task.status==='queued'){task.status='cancelled';entry.status='cancelled';}
    else if(task&&!['complete','cancelled'].includes(task.status))s=reducer(s,{type:'workflow',command:{operation:'cancel',taskId:task.id,source:'card'}},'plan-cancel-'+crypto.randomUUID());
    // Leave the active entry pending until pump observes the cancelled child and restores the next task.
    if(all||entry.id!==currentPlanStep(s)?.id||!task)s.plan!.steps.find(x=>x.id===entry.id)!.status='cancelled';
   }
   if(all){s.plan!.status='cancelled';s.plan!.currentTaskId=undefined;s.plan!.message='剩余任务没有提交，已放下；已提交的业务不会撤回。';}
   else{s=pump(s,reducer);}
  }else if(cmd.operation==='amend'){
   const paused=p.status==='paused';let entry=p.steps.find(x=>x.id===targetId||x.taskId===targetId)||(!targetId?currentPlanStep(s):undefined);
   if(!entry||!unfinished(entry))throw new WorkflowError('只能补充尚未完成的任务。');
   if(p.monthly?.rentUnknown&&entry.functionId==='TR03')throw new WorkflowError('房租结果待核对，请回查原订单，不能修改或重付。');
   const text=cmd.source==='voice'?cmd.utterance||'':cmd.clarification||'';let ask:RecipientAsk|undefined;const askStep=entry?.id;
   if(entry.kind==='calculation'){
    const accountId=String(cmd.params?.accountId||extractParams(text,'TR03',s).accountId||'');
    if(!s.accounts.some(a=>a.id===accountId)||Object.keys(cmd.params||{}).some(k=>k!=='accountId'))throw new WorkflowError('请明确选择计算账户。');
    evidence(s,{...entry,params:{}},{accountId},text,cmd.source);entry.formula={...entry.formula!,selector:'explicit',accountId};entry.status='pending';
   }else{
    const functionId=cmd.functionId||entry.functionId||inferFunction(text);
    if(!functionId||!functionById(functionId)||!entry.functionId&&cmd.source==='voice'&&!hasFunctionScope(text,functionId)){p.message='请说明这项任务的具体用途。';s.lastReply=p.message;return s;}
    if(p.monthly?.rentUnknown&&functionId==='TR03')throw new WorkflowError('房租原订单结果待核对，不能另建转账。');
    if(entry.functionId&&entry.functionId!==functionId)throw new WorkflowError('已创建任务不能改成另一项业务，请插入新任务。');
    const task=child(s,entry),facts=task?{...s,workflows:{...s.workflows!,currentTaskId:task.id}}:s;
    const patch=normalizedParams(functionId,{...extractParams(text,functionId,facts),...cmd.params});ask=evidence(s,{...entry,functionId},patch,text,cmd.source);
    entry.kind='workflow';entry.functionId=functionId;entry.title=functionById(functionId)!.title;
    if(!task||task.status==='queued'){
     if(entry.binding&&['amount','accountId'].some(k=>Object.hasOwn(patch,k)&&JSON.stringify(entry!.params[k])!==JSON.stringify(patch[k]))){
      const calc=p.steps.find(x=>x.id===entry!.binding);entry.binding=undefined;
      if(calc&&calc.status!=='complete'&&!p.steps.some(x=>x.binding===calc.id)){calc.status='cancelled';calc.question=undefined;entry.dependsOn=entry.dependsOn.flatMap(id=>id===calc.id?calc.dependsOn:[id]);}
     }
     entry.params={...entry.params,...patch};entry.quote=[entry.quote,text].filter(Boolean).join('\n').slice(-2000);materialize(s,p,cmd.source,[entry]);
     const saved=child(s,entry)!;saved.params={...entry.params};
    }else{
     selectTask(s,entry.id);const old=task.reviewToken;
     s=reducer(s,{type:'workflow',command:{operation:'amend',taskId:task.id,params:patch,source:cmd.source,utterance:text,turnId:cmd.turnId}},'plan-amend-'+crypto.randomUUID());
     entry=s.plan!.steps.find(x=>x.id===entry!.id)!;const updated=child(s,entry)!;
     if(entry.binding&&['amount','accountId'].some(k=>Object.hasOwn(patch,k)&&JSON.stringify(entry!.params[k])!==JSON.stringify(updated.params[k])))entry.binding=undefined;
     if(old!==updated.reviewToken)openSummary(s.plan!,entry);entry.params={...updated.params};
    }
    entry.question=undefined;entry.status='pending';
   }
   s.plan!.status=paused?'paused':'running';if(paused)s.plan!.message='补充信息已保存，清单仍暂停。';s=pump(s,reducer);
   if(ask)askRecipient(s,s.plan?.steps.find(x=>x.id===askStep),ask);
  }else if(cmd.operation==='resume'){
   const entry=targetId?selectTask(s,targetId):currentPlanStep(s);
   if(p.monthly?.rentUnknown&&entry?.functionId==='TR03')throw new WorkflowError('原房租订单结果待核对，请回查原订单，不得再次付款。');
   p.status='running';const task=entry&&child(s,entry);
   if(task?.status==='blocked')s=reducer(s,{type:'workflow',command:{operation:'resume',taskId:task.id,source:'plan'}},'plan-resume-'+crypto.randomUUID());
   s=pump(s,reducer);s.plan!.message='已恢复保存的任务。'+s.plan!.message;
  }
  s.lastReply=s.plan!.message;
 }
 trimHistory(s.plan!);s.recentRequestIds=[...s.recentRequestIds.slice(-63),id];return s;
}
export function planTextAction(s:BankState,text:string):BankAction|null{
 if(s.plan?.monthly&&familyBudgetAmount(text,hasFamilyBudgetContext(s))!=null)return {type:'plan',command:{operation:'interrupt',source:'voice',utterance:text}};
 if(isMonthlyRequest(text))return {type:'plan',command:{operation:'create',source:'voice',utterance:text,turnId:crypto.randomUUID()}};
 const p=activePlan(s);if(!p)return null;const step=currentPlanStep(s);
 if(/^(?:暂停|停一下|等一下)[。！!\s]*$/.test(text))return {type:'plan',command:{operation:'pause',source:'voice',utterance:text}};
 if(/^(?:继续|恢复|继续办理)[。！!\s]*$/.test(text)&&p.status==='paused')return {type:'plan',command:{operation:'resume',source:'voice',utterance:text}};
 if(/^(?:取消(?:(?:全部|所有|剩余|全部剩余)(?:的)?(?:计划|任务|清单|业务|步骤)?|当前(?:任务|业务)|这次办理|任务|清单|计划)?|不办了|算了)[。！!\s]*$/.test(text)){
  const current=/^(?:取消(?:当前(?:任务|业务)|这次办理)?)[。！!\s]*$/.test(text);
  return {type:'plan',command:{operation:'cancel',...(current&&step?{taskId:step.taskId||step.id}:{}),source:'voice',utterance:text}};
 }
 // Use the existing workflow confirmation grammar and the current task's token.
 // This retains the same turn, risk and authentication checks as a native tool call.
 const continuation=workflowTextAction(s,text);
 if(continuation?.operation==='confirm'&&continuation.taskId===step?.taskId)return {type:'workflow',command:continuation};
 if(isComplexRequest(text,s))return {type:'plan',command:{operation:'interrupt',source:'voice',utterance:text}};
 const requested=inferFunction(text);if(requested&&requested!==step?.functionId)return {type:'plan',command:{operation:'interrupt',functionId:requested,params:extractParams(text,requested,s),source:'voice',utterance:text}};
 const unclear=p.steps.find(x=>x.kind==='clarify');
 return {type:'plan',command:{operation:'amend',taskId:unclear?.taskId||unclear?.id||step?.taskId||step?.id,source:'voice',utterance:text,turnId:crypto.randomUUID()}};
}

