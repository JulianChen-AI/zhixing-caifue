import type {BankState} from '../bank/types.ts';
import type {ToolCall} from '../bank/tool-action.ts';
import {clauses,extractParams,inferFunction} from '../plans/decompose.ts';
import {currentPlanStep} from '../plans/engine.ts';
import {familyBudgetAmount,hasFamilyBudgetContext} from '../plans/monthly.ts';
import type {FlowTask} from '../workflows/types.ts';
import {delegationGaps} from './delegation-progress.ts';

export type DelegationStopReason='completed'|'awaiting_input'|'awaiting_confirmation'|'awaiting_authentication'|'awaiting_external'|'blocked'|'user_paused'|'unknown_result'|'call_budget'|'no_progress';
export type DelegationCheckpoint=
 | {kind:'continue';gaps:string[];next?:{name:string;arguments:Record<string,unknown>}}
 | {kind:'stop';reason:DelegationStopReason;summary:string;taskId?:string;verifiedSummary?:boolean};

const unfinished=(task:FlowTask)=>!['complete','cancelled'].includes(task.status);
const monthlyRequest=(text:string)=>/老规矩/.test(text)||/工资|月度/.test(text)&&/安排|计划/.test(text);
const startsPlan=(text:string)=>/逐项办理|开始办理|开始执行|继续办理|继续逐项|先开始|按.*办理/.test(text)&&!/不要|别|不按|如果|假设|[?？]/.test(text);

/** A turn can yield only at a persisted business boundary, never merely because
 * a model produced prose. Historical completed tasks cannot satisfy a new query.
 * This function only reads state; proposed next calls still pass ordinary guards. */
export function delegationCheckpoint(start:BankState,state:BankState,text:string,successful:ToolCall[]):DelegationCheckpoint {
 if(clauses(text).length===1&&/^(?:请|帮我|给我)?(?:解释|介绍|说明|什么是|为什么|如何|怎么)/.test(text.trim()))return {kind:'stop',reason:'completed',summary:''};
 // Catalog descriptions may carry a real functionId, but are not instances of
 // that business and cannot count as a query result or a transfer draft.
 const tasks=(state.workflows?.tasks||[]).filter(t=>t.title!=='可办理功能'&&t.functionId!=='catalog'),before=new Map((start.workflows?.tasks||[]).map(t=>[t.id,t]));
 const touched=new Set(tasks.filter(t=>JSON.stringify(t)!==JSON.stringify(before.get(t.id))&&!(before.get(t.id)?.status==='complete'&&t.status==='complete'&&JSON.stringify(t.result)===JSON.stringify(before.get(t.id)?.result))).map(t=>t.id));
 for(const tool of successful)if('taskId'in tool.arguments&&tool.arguments.taskId){
  const previous=before.get(tool.arguments.taskId);
  // Reading an old completed query's status only returns its saved snapshot.
  // It is valid for a history/receipt request, never evidence of a fresh balance query.
  if(previous?.status!=='complete'||/原订单|回执|记录|进度|当时|刚才的/.test(text))touched.add(tool.arguments.taskId);
 }
 const original=start.workflows?.tasks.find(t=>t.id===start.workflows?.currentTaskId);
 if(original&&unfinished(original)&&(
  Object.keys(extractParams(text,original.functionId,start)).length||/确认|确定|取消|不转了|不办了|继续|恢复|回到/.test(text)
 ))touched.add(original.id);
 const monthly=monthlyRequest(text),budget=state.plan?.monthly?familyBudgetAmount(text,hasFamilyBudgetContext(state)):undefined;
 const expected=monthly?[]:clauses(text).map(inferFunction).filter((id):id is string=>!!id);
 if(budget!=null){expected.length=0;expected.push('BI08');}
 if(budget!=null&&successful.some(t=>t.arguments.operation==='interrupt'||t.arguments.operation==='run')){
  const saved=state.plan?.steps.find(s=>s.functionId==='BI08'&&s.params.amount===budget&&s.params.category==='聚餐'&&s.status!=='cancelled');
  if(saved?.taskId)touched.add(saved.taskId);
 }
 const relevant=tasks.filter(t=>touched.has(t.id)&&(!expected.length||expected.includes(t.functionId)));
 const gaps=delegationGaps(state,text);
 const needed=new Map<string,number>();for(const id of expected)needed.set(id,(needed.get(id)||0)+1);
 const missingFunctions=[...needed].filter(([id,count])=>relevant.filter(t=>t.functionId===id).length<count).map(([id])=>id);
 for(const id of missingFunctions)gaps.push('本轮原请求尚未完整进入Checklist：'+id+'；先前同类业务或仅查余额不算本轮已办理。保留全部原话，建立或补齐对应任务。'+(id==='TR02'?'重新调用bank_request list_accounts读取最新余额；旧查询任务的status只返回历史快照。':''));
 const opened=successful.some(t=>t.name==='bank_plan'&&(t.arguments.operation==='open_saved'||t.arguments.operation==='create'&&!!state.plan?.monthly));
 if(monthly&&!opened&&!(startsPlan(text)&&successful.some(t=>t.name==='bank_plan'&&t.arguments.operation==='resume')))gaps.push('本轮月度安排尚未读取。先用bank_plan open_saved读取已保存安排或取得缺少模板的实际结果。');
 if(monthly&&startsPlan(text)&&state.plan?.status==='paused')gaps.push('用户要求逐项办理，清单仍暂停。应resume进入当前Checklist，不能把已展示模板当成已开始。');
 if(state.plan?.monthly?.rentUnknown&&/原订单|回查|查.*房租/.test(text)&&!successful.some(t=>t.name==='bank_plan'&&t.arguments.operation==='status'))gaps.push('本轮尚未回查房租原订单；get_state或复述旧的blocked状态不等于回查。使用bank_plan status读取原订单，不得新建或重付。');
 if(gaps.length){
  // Register a clearly requested but absent checklist using the existing raw-
  // utterance decomposer. No model parameters, confirmation or authentication
  // are synthesized. Existing registered work is never recreated this way.
  const register=missingFunctions.length>0&&!relevant.length&&!/不要|别|不用|如果|假设|[?？]|吗/.test(text)&&!/^(?:请|帮我)?(?:确认|确定|取消|不转了|不办了|继续|恢复|回到)/.test(text.trim());
  const target=tasks.find(t=>t.id===original?.id&&['collecting','review'].includes(t.status));
  const supplied=target&&(!inferFunction(text)||inferFunction(text)===target.functionId)&&budget==null&&!/不要|别|不用|如果|假设|[?？]|吗/.test(text)?extractParams(text,target.functionId,state):{};
  const patch=target?Object.fromEntries(Object.entries(supplied).filter(([key,value])=>JSON.stringify(value)!==JSON.stringify(target.params[key]))):{};
  const next=monthly&&!opened?{name:'bank_plan',arguments:{operation:'open_saved'}}
   :state.plan?.status==='paused'&&startsPlan(text)?{name:'bank_plan',arguments:{operation:'resume'}}
   :missingFunctions.includes('TR02')?{name:'bank_request',arguments:{operation:'list_accounts'}}
   :state.plan?.monthly?.rentUnknown&&/原订单|回查|查.*房租/.test(text)?{name:'bank_plan',arguments:{operation:'status'}}
   :target&&Object.keys(patch).length?{name:'bank_function',arguments:{operation:'amend',taskId:target.id,params:patch}}
   :register?{name:'bank_plan',arguments:{operation:state.plan&&!['complete','cancelled'].includes(state.plan.status)?'interrupt':'create'}}:undefined;
  return {kind:'continue',gaps,next};
 }

 if(monthly&&opened&&!state.plan?.monthly)return {kind:'stop',reason:'awaiting_input',summary:state.lastReply};
 if(monthly&&state.plan?.monthly&&!startsPlan(text))return {kind:'stop',reason:'completed',summary:'已展示本月保存的安排和进度，金额和对象来自已保存模板；尚未执行付款或申购。',verifiedSummary:true};

 // The active queue position wins over a completed side query when the whole
 // request was registered as a multi-step plan. An independent inserted task
 // may instead be resumed by its own ID, retaining a blocked original order.
 const step=currentPlanStep(state),active=tasks.find(t=>t.id===step?.taskId);
 const pending=relevant.filter(unfinished);
 const task=active&&relevant.some(t=>t.id===active.id)?active:pending[0]||relevant.at(-1);
 if(task){
  const entry=state.plan?.steps.find(s=>s.taskId===task.id);
  if(task.status==='queued')return {kind:'continue',gaps:['清单中还有已保存但未激活的步骤；应恢复该taskId，继续进入Checklist。'],next:{name:'bank_plan',arguments:{operation:'resume',taskId:task.id}}};
  if(state.plan?.status==='paused'&&entry&&unfinished(task)){
   if(/暂停|先不办|暂时不办/.test(text))return {kind:'stop',reason:'user_paused',summary:state.plan.message,taskId:task.id};
   return {kind:'continue',gaps:['当前任务所在清单仍暂停，不能当作已继续办理。'],next:{name:'bank_plan',arguments:{operation:'resume',taskId:task.id}}};
  }
  if(task.status==='collecting'&&(task.missing.length||task.queryClarification||task.clarificationFields?.length))return {kind:'stop',reason:'awaiting_input',summary:task.message,taskId:task.id};
  if(task.status==='review'&&task.reviewToken)return {kind:'stop',reason:'awaiting_confirmation',summary:task.message,taskId:task.id};
  if(task.status==='authenticate'&&task.verificationId)return {kind:'stop',reason:'awaiting_authentication',summary:'信息已确认，请在业务卡片完成演示认证；当前业务尚未执行。',taskId:task.id};
  if(task.status==='external')return {kind:'stop',reason:'awaiting_external',summary:task.message,taskId:task.id};
  if(task.status==='blocked'||task.status==='unsupported')return {kind:'stop',reason:(task.result as {status?:string}|null)?.status==='unknown'?'unknown_result':'blocked',summary:task.message,taskId:task.id};
  if(!unfinished(task)){
   const spoken=(task.result as {spokenSummary?:unknown}|null)?.spokenSummary;
   const balance=task.functionId==='TR02'&&Array.isArray(task.result)?task.result.map((a:{name:string;balance:number;available?:number})=>a.name+'余额'+(a.balance/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})+'元'+(a.available!=null?'，可用'+(a.available/100).toFixed(2)+'元':'')).join('；')+'。':undefined;
   return {kind:'stop',reason:'completed',summary:balance||typeof spoken==='string'&&spoken||task.message,taskId:task.id,verifiedSummary:!!balance||typeof spoken==='string'};
  }
  return {kind:'continue',gaps:['当前Checklist没有完成，也没有缺项、确认、认证或外部等待依据，需读取任务并继续处理。']};
 }
 if(step?.kind==='clarify'&&step.question&&state.plan?.id!==start.plan?.id)return {kind:'stop',reason:'awaiting_input',summary:step.question};
 if(successful.some(t=>['status','get_state','list','describe'].includes(t.arguments.operation))&&!expected.length&&!monthly)return {kind:'stop',reason:'completed',summary:state.lastReply};
 if(!successful.length&&!expected.length&&!monthly&&/解释|区别|什么意思|什么是|为什么|介绍|复述/.test(text))return {kind:'stop',reason:'completed',summary:''};
 return {kind:'continue',gaps:['尚无本轮业务结果或可核对的用户等待点。不能以“稍等”、承诺或无工具回复结束；需要实际保存/查询，或取得明确缺项。']};
}
