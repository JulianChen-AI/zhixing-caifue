import {taskChecklist} from './checklist.ts';
import { z } from 'zod';
import type { BankState } from '../bank/types.ts';
import { currentWorkflow } from './current.ts';
import { choices, FIELDS, LABELS, requiredFields } from './fields.ts';
import { ACTIONS } from './write-kind.ts';
import type { FlowTask } from './types.ts';
import { workflowReview } from './review.ts';

const fields={functionId:z.string().regex(/^(TR|BI|SU|IN|CA)\d{2}$/).optional(),taskId:z.string().uuid().optional(),params:z.record(z.string(),z.unknown()).optional(),token:z.string().uuid().optional()};
export const workflowToolArguments=z.object({operation:z.enum(['list','describe','run','amend','confirm','cancel','resume','status']),...fields}).strict();
export const workflowCardArguments=z.object({operation:z.enum(['list','describe','run','amend','confirm','authenticate','cancel','resume','status','settle']),...fields,code:z.string().regex(/^\d{6}$/).optional()}).strict();
export type WorkflowToolArguments=z.infer<typeof workflowToolArguments>;
const moneyKeys=new Set(['goalBalance','assets','budget','unallocated','planned','available','held','receivable','received','outstanding','amount','balance','target','value','cost','limit','expenses','grossExpenses','netExpenses','refunds','income','remaining','total','fee','netAmount','changeAmount','baselineNetExpenses','profit','projectedMonthlyReduction','moved','monthlyAmount','reservedCost']);
export function publicValue(value:unknown,key=''):unknown{
 if(typeof value==='number'&&moneyKeys.has(key))return value/100;
 if(Array.isArray(value))return value.slice(0,30).map(v=>publicValue(v));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!['answers','verificationId','code'].includes(k)).map(([k,v])=>[k,publicValue(v,k)]));
 return value;
}
export function workflowToolResult(state:BankState,taskId?:string){
 const t=taskId?state.workflows?.tasks.find(t=>t.id===taskId):currentWorkflow(state);if(!t)return undefined;
 const progress=(task:FlowTask)=>({
  nextAction:task.status==='review'?'review_current_summary':task.status==='authenticate'?'complete_page_authentication':task.status==='collecting'?'ask_missing_fields':task.status==='blocked'?'explain_block':task.status==='unsupported'||task.status==='external'?'explain_limit':'show_result',
  amendRequest:['collecting','review'].includes(task.status)?{name:'bank_function',arguments:{operation:'amend',taskId:task.id}}:undefined,
  confirmationRequest:task.status==='review'&&task.reviewToken?{name:'bank_function',arguments:{operation:'confirm',taskId:task.id,token:task.reviewToken}}:undefined,
 });
 const taskInstruction=t.status==='review'?'这仅是待确认草稿，尚未创建或提交业务。用户补充或改口时必须先复制amendRequest并用operation:amend、原taskId及本轮params保存，再用更新后的卡片核对；不能只口头复述成已更新。等待本轮明确确认后，再原样使用confirmationRequest中的工具名和arguments调用；token字段不可改成confirmationToken。':t.status==='collecting'&&t.clarificationFields?.includes('participants')?'参与者名单未核实，不能沿用或重复提交同一转写上的猜测。明确告诉用户成员称呼没听清，请其重新说或在卡片核对填写；等待新的输入后用amendRequest更新。其他已独立核实字段保留，工具成功返回前不得说名单已填。':t.status==='collecting'?'这是一张已建立但仍缺字段的草稿卡。只询问missing；用户补充或改口后必须复制amendRequest，向bank_function提交operation:amend、原taskId和本轮明确params。等待工具成功返回后才能说字段已填或卡片已更新，不可只口头承诺。':t.status==='authenticate'?'已经确认，等待页面认证，尚未执行。请直接引导用户在下方卡片填写演示验证码123456并点击“验证并办理”，不要重复确认或重新建任务。':t.status==='blocked'?'当前条件阻断，解释message中的实际原因，等待用户修改或取消；不要重复确认或循环resume。':'仅依据实际状态解释。complete表示本步骤已返回，订单pending仍是受理待确认，不能声称到账。查询后继续原任务时按pendingTasks中的原taskId恢复，不重新创建。';
 return {version:state.workflows!.version,taskId:t.id,functionId:t.functionId,title:t.title,status:t.status,
  ...progress(t),checklist:taskChecklist(state,t),
  params:Object.fromEntries(Object.entries(t.params).filter(([k])=>k!=='answers')),amountUnit:'yuan',currency:'CNY',
  review:['review','authenticate'].includes(t.status)?workflowReview(state,t):undefined,
  missing:t.missing,requiredFields:requiredFields(t.functionId,t.params),fieldSources:Object.fromEntries(Object.entries(t.fieldEvidence||{}).map(([k,v])=>[k,{source:v.source}])),fields:(FIELDS[t.functionId]||[]).map(key=>({key,label:LABELS[key]||key,required:requiredFields(t.functionId,t.params).includes(key),choices:key==='action'?(ACTIONS[t.functionId]||[]).map(value=>({value,label:value})):choices(state,key)})),
  confirmationToken:t.status==='review'?t.reviewToken:null,needsUserConfirmation:t.status==='review',effectCommitted:t.status==='complete'&&t.confirmedToken!=null,message:t.message,limitations:t.limitations||[],
  preview:['review','authenticate'].includes(t.status)?publicValue(t.result):undefined,
  result:['complete','external'].includes(t.status)?t.functionId==='catalog'&&Array.isArray(t.result)?t.result.map(f=>({id:f.id,title:f.title,moduleId:f.moduleId,capability:f.capability})):publicValue(t.result):undefined,
  steps:t.steps.map(({toolId,status,reason})=>({toolId,status,reason})),
  pendingTasks:state.workflows!.tasks.filter(x=>['queued','collecting','review','authenticate','blocked'].includes(x.status)).slice(-8).map(x=>({taskId:x.id,functionId:x.functionId,title:x.title,status:x.status,params:Object.fromEntries(Object.entries(x.params).filter(([k])=>k!=='answers')),missing:x.missing,...progress(x)})),
  instruction:taskInstruction+(['BI01','BI02'].includes(t.functionId)?'本轮账单查询的范围和数字以result.scope及result.spokenSummary为准；直接播报spokenSummary，不改写范围、金额或笔数，不添加消费事实。查询待澄清时只按message补问，不报告数字。':'')+'参数金额与本输出金额均为人民币元。认证只能通过页面。只按missing补必要字段；missing为空不要追问其他字段。required:false是可选项，IN01未开启autoSave时不需要关联账户或周期。省略备注等可选参数不反复追问。未接入或待外部办理不能说已成功。',
 };
}

