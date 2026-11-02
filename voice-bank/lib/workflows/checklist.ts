import type { BankState } from '../bank/types.ts';
import type { FlowTask } from './types.ts';
import {FIELDS,LABELS,requiredFields,choices} from './fields.ts';
import {ACTIONS} from './adapters.ts';
import {questionnaire} from './questionnaire.ts';

/** A live view of the persisted task, not another copy of its business facts. */
export function taskChecklist(state:BankState,task:FlowTask){
 const required=[...new Set([...requiredFields(task.functionId,task.params),...task.missing])];
 const fields=(FIELDS[task.functionId]||[]).filter(key=>key!=='answers').map(key=>{
  const value=task.params[key],filled=value!=null&&value!==''&&(!Array.isArray(value)||value.length>0);
  return {key,label:LABELS[key]||key,required:required.includes(key),value:value??null,status:task.clarificationFields?.includes(key)?'needs_clarification':filled?'filled':required.includes(key)?'missing':'optional',choices:key==='action'?(ACTIONS[task.functionId]||[]).map(value=>({value,label:value})):choices(state,key)};
 });
 const questions=task.functionId==='IN05'&&task.params.action!=='status'?questionnaire(task.params.answers).map((q,i)=>({...q,source:task.fieldEvidence?.[`answers.${i}`]?.source})):undefined;
 return {taskId:task.id,stage:task.status,fields,questions,finalStep:{key:'check_plan',label:'检查外层任务清单',handledBy:'backend',when:'业务实际完成后；填写齐全或待确认不算完成'},nextQuestion:questions?.find(q=>q.status==='missing'),
  updateRequest:['collecting','review','blocked'].includes(task.status)?{name:'bank_function',arguments:{operation:'amend',taskId:task.id}}:undefined,
  instruction:'用户提供或修改信息时，先通过updateRequest保存本轮字段，再依据工具结果回复。只补missing，optional可跳过；filled不重复追问。填写不是授权执行。'+(questions?'逐题询问nextQuestion及其全部choices。answers按三题顺序保存，未答用0，保留其他已保存题；不可等三题齐全才保存。三题齐全只核对摘要，等待用户确认。':'')};
}
