import type {BankAction,BankState} from '../bank/types.ts';
import {activePlan,currentPlanStep} from './engine.ts';
import {inferFunction,isComplexRequest,extractParams} from './decompose.ts';
import {flattenPlan} from './materialize.ts';
import {isMonthlyRequest,familyBudgetAmount,hasFamilyBudgetContext} from './monthly.ts';
function flatState(s:BankState){if(s.plan&&s.plan.version!==3){s=structuredClone(s);flattenPlan(s);}return s;}
import {WorkflowError,type Params} from '../workflows/types.ts';
function assertFunctionIntent(text:string,id:string){
 const inferred=inferFunction(text);
 if(inferred&&inferred.slice(0,2)!==id.slice(0,2))throw new WorkflowError('所选业务与本轮要求不一致，请重新识别业务；尚未切换任务。',400,'functionId');
 if(inferred==='BI01'&&id==='BI02')throw new WorkflowError('本轮要求BI01账单明细，BI02仅提供收支统计，不能替代；尚未执行。',400,'functionId');
}

const INTO_GOAL=/(?:转|存|放|划)[^，。,；]{0,8}?(?:进|到|入)([^，。,；]{0,8}?)(?:储蓄|目标)(?!账户|卡)/;
/** Money moved into the user's own savings goal is a goal deposit (once) or the goal's auto-save rule (recurring),
 * never a transfer to a contact — whichever entry (realtime tool, delegation, JSON intent, text) proposed the transfer. */
function ownGoalDeposit(s:BankState,action:BankAction,raw:string):BankAction{
 if(action.type==='plan'&&action.command.tasks?.length)return {...action,command:{...action.command,tasks:action.command.tasks.map(task=>{const one=ownGoalDeposit(s,{type:'workflow',command:{operation:'run',functionId:task.functionId,params:task.params,source:'card'}},task.quote||'');return one.type==='workflow'?{...task,functionId:one.command.functionId!,params:one.command.params||{}}:task;})}};
 const cmd=action.type==='workflow'&&action.command.operation==='run'||action.type==='plan'&&['create','interrupt'].includes(action.command.operation)?action.command:undefined;
 const into=INTO_GOAL.exec(raw),fn=cmd?.functionId||'';
 if(!cmd||!into||!['TR03','TR04','IN02','IN04'].includes(fn)||(cmd.params as Params|undefined)?.recipientId)return action;
 const given=(cmd.params||{}) as Params,goals=(s.workflows?.records.goals||[]).filter(g=>g.status!=='closed');
 // The sum said with the move is the per-period amount, even when a model filed it as the goal's target.
 const p:Params={...given,...(given.amount==null&&fn==='IN04'&&given.target!=null?{amount:given.target}:{})};
 const named=goals.filter(g=>{const core=String(g.name||'').replace(/储蓄|目标|计划/g,'');return core&&raw.includes(core);});
 const goalId=(named.length===1?named[0]:goals.length===1?goals[0]:undefined)?.id;
 const recurring=fn==='TR04'||fn==='IN04'||p.schedule!=null||/每月|每周|每天|自动|定期/.test(raw);
 // No goal yet: open one with this auto-save rule; the card asks for its total and deadline.
 if(recurring&&!goals.length){const params:Params={name:(into[1]||'').trim()+'储蓄',autoSave:true,...(p.accountId?{accountId:p.accountId}:{}),...(p.amount!=null?{amount:p.amount}:{}),...(p.schedule?{schedule:p.schedule}:{})};return retarget(action,'IN01',params);}
 const params:Params=recurring?{action:'update',...(goalId?{goalId}:{}),...(p.accountId?{accountId:p.accountId}:{}),...(p.amount!=null?{amount:p.amount}:{}),...(p.schedule?{schedule:p.schedule}:{})}
  :{direction:'deposit',...(goalId?{goalId}:{}),...(p.accountId?{accountId:p.accountId}:{}),...(p.amount!=null?{amount:p.amount}:{})};
 return retarget(action,recurring?'IN04':'IN02',params);
}
function retarget(action:BankAction,functionId:string,params:Params):BankAction{
 if(action.type==='workflow')return {type:'workflow',command:{...action.command,functionId,params,source:'card'}};
 return action.type==='plan'?{type:'plan',command:{...action.command,functionId,params,source:'card'}}:action;
}

/** All application business starts enter a persisted outer plan, including one-item requests. */
export function dispatchAction(s:BankState,action:BankAction,text='',turnId?:string):BankAction{
 s=flatState(s);const raw=action.type==='workflow'||action.type==='plan'?action.command.utterance||text:text;
 if(s.plan?.monthly&&familyBudgetAmount(raw,hasFamilyBudgetContext(s))!=null&&(action.type==='workflow'&&action.command.operation==='run'||action.type==='plan'&&['create','interrupt'].includes(action.command.operation)))return {type:'plan',command:{operation:'interrupt',source:'voice',utterance:raw,turnId}};
 if(isMonthlyRequest(raw)&&(action.type==='workflow'&&action.command.operation==='run'||action.type==='plan'&&action.command.operation==='create'))return {type:'plan',command:{operation:'create',source:'voice',utterance:raw,turnId}};
 if(action.type==='workflow'&&['run','resume','status'].includes(action.command.operation)||action.type==='plan'&&['create','interrupt'].includes(action.command.operation)){const resume=resumeAction(s,raw);if(resume)return resume;}
 let a=ownGoalDeposit(s,action,raw);const p=activePlan(s),step=currentPlanStep(s);
 // A model may label a correction as a new interrupt. Explicit edits bind to the
 // existing task; otherwise a second draft loses the original fields and token history.
 if(a.type==='plan'&&a.command.source==='voice'&&['create','interrupt'].includes(a.command.operation)){const correction=explicitTaskAmendment(s,raw,a.command.turnId||turnId);if(correction)return correction;}
 if(a.type==='plan'&&a.command.source==='voice'&&['create','interrupt'].includes(a.command.operation)&&a.command.functionId)assertFunctionIntent(raw,a.command.functionId);
 if(a.type==='route'){
  const d=a.decision.draft;if(!d||a.decision.outcome==='unsupported')return a;
  const base={source:'voice' as const,utterance:text,turnId};
  if(d.kind==='balance')a={type:'workflow',command:{operation:'run',functionId:'TR02',params:{},...base}};
  else if(['transfer','amend'].includes(d.kind)){
   const params:Params={};for(const k of ['recipientId','accountId','note'] as const)if(d[k]!=null)params[k]=d[k];if(d.amount!=null)params.amount=d.amount/100;
   a={type:'workflow',command:{operation:step?.functionId==='TR03'?'amend':'run',...(step?.functionId==='TR03'?{taskId:step.taskId}:{functionId:'TR03'}),params,...base}};
  }else if(step?.functionId==='TR03'&&['confirm_transfer','cancel'].includes(d.kind)){
   const task=s.workflows?.tasks.find(t=>t.id===step.taskId);
   a={type:'workflow',command:{operation:d.kind==='cancel'?'cancel':'confirm',taskId:task?.id,token:task?.reviewToken||undefined,...base}};
  }
 }
 if(a.type==='workflow'&&a.command.operation!=='run'){
  const c=a.command;
  // The backend binds omitted IDs to the current task. Explicit IDs remain validated.
  if(!c.taskId&&step?.taskId&&!['list','describe','settle'].includes(c.operation))a={...a,command:{...c,taskId:step.taskId}};
  const cmd=a.command,target=s.plan?.steps.find(x=>x.taskId===cmd.taskId);
  const existing=s.workflows?.tasks.find(t=>t.id===cmd.taskId&&['queued','collecting','review','blocked'].includes(t.status));
  if(!target&&existing&&['resume','status'].includes(cmd.operation))return {type:'plan',command:{operation:p?'interrupt':'create',functionId:existing.functionId,adoptTaskId:existing.id,source:cmd.source==='card'?'card':'voice',utterance:cmd.utterance}};
  if(target&&['resume','amend'].includes(cmd.operation))return {type:'plan',command:{operation:cmd.operation as 'resume'|'amend',taskId:target.taskId,params:cmd.params,source:cmd.source==='card'?'card':'voice',utterance:cmd.utterance,turnId:cmd.turnId}};
 }
 if(a.type!=='workflow'||a.command.operation!=='run')return a;
 const c=a.command,utterance=c.utterance||text||'',id=c.functionId!;
 if(c.source==='voice')assertFunctionIntent(utterance,id);
 // Same business continuing a saved draft must not create a duplicate task.
 if(step?.functionId===id&&s.workflows?.tasks.find(t=>t.id===step.taskId)?.status!=='blocked'&&!/新建|创建|另一笔|重新开始|新的一份/.test(utterance)&&!(id==='IN05'&&c.params?.action==='status'))return {type:'workflow',command:{operation:Object.keys(c.params||{}).length?'amend':'resume',taskId:step.taskId,params:c.params,source:c.source,utterance,turnId:c.turnId||turnId}};
 const complex=c.source==='voice'&&isComplexRequest(utterance,s);
 return {type:'plan',command:{operation:p?'interrupt':'create',source:c.source==='card'?'card':'voice',utterance:utterance||id,turnId:c.turnId||turnId,...(!complex?{functionId:id,params:c.params||{}}:{})}};
}

/** Only explicit corrections to a known active task; execution still validates field evidence. */
export function explicitTaskAmendment(s:BankState,text:string,turnId?:string):BankAction|undefined{
 s=flatState(s);const step=currentPlanStep(s);
 if(!activePlan(s)||!step?.functionId||!/改成|改为|修改|调整为|改口/.test(text)||/新建|创建|另一笔|新的一份|不要改|别改|为什么|解释|如果|假设|[?？]/.test(text)||isComplexRequest(text,s))return;
 const requested=inferFunction(text),params=extractParams(text,step.functionId,s);
 if((!requested||requested===step.functionId)&&Object.keys(params).length)return {type:'plan',command:{operation:'amend',taskId:step.taskId,params,source:'voice',utterance:text,turnId}};
}

/** Match a unique existing task; do not allocate another instance or rewrite saved answers. */
export function resumeAction(s:BankState,text:string):BankAction|undefined{
 s=flatState(s);if(isComplexRequest(text,s)||/解释|为什么|区别|如果|假设|[?？]/.test(text))return;
 if(!/继续|恢复|回到|(?:查看|检查).*原.*草稿/.test(text)||/不要(?:继续|恢复|回到)|别(?:继续|恢复|回到|切换)|不再|不想|取消|改成|改为|选[择一二三四五12345]/.test(text))return;
 const id=inferFunction(text),candidates=s.plan?.steps.filter(x=>!['complete','cancelled'].includes(x.status)&&(x.functionId===id||typeof x.params.name==='string'&&text.includes(x.params.name)))||[];
 if(candidates.length!==1)return;
 return {type:'plan',command:{operation:'resume',taskId:candidates[0].taskId||candidates[0].id,source:'voice',utterance:text}};
}
