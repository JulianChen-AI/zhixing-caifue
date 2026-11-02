'use client';
import { useState, type ReactNode } from 'react';
import type { BankAction, BankState } from '@/lib/bank/types';
import { currentSurface } from '@/lib/ui/serial';
import { taskIdentity } from '@/lib/ui/business';
import type { Badge } from '@/lib/ui/desk';
import { Chip } from './desk';
import { ListChecks, MessagesSquare, PauseCircle, Search } from 'lucide-react';
import { FlowSelect } from './flow-select';
import { WorkflowPanel, WorkflowOutcome, BusinessResult } from './workflow-panel';

type Props = { bank: BankState; busy: boolean; onAction: (action: BankAction) => Promise<void>; legacy?: ReactNode };
export function SerialStage({ bank, busy, onAction, legacy }: Props) {
  const surface = currentSurface(bank);
  if (surface === 'welcome') return null;
  if (surface === 'paused') return <section className="business-card serial-card" aria-label="当前步骤"><div className="card-head"><PauseCircle aria-hidden size={20}/><h2>{bank.plan?.monthly?'本月安排已展示':'办理已暂停'}</h2><span className="card-head-end"><Chip badge={{label:'信息已保留',tone:'muted'}}/></span></div><p className="card-description">{bank.plan?.monthly?'上方已展示保存的安排和依据。仅查看不会付款；需要办理时再逐项核对。':'已填写的信息会保留。'}</p><button className="primary-button" disabled={busy} onClick={() => void onAction({type:'plan',command:{operation:'resume',source:'card'}})}>继续办理</button><button className="text-button" disabled={busy} onClick={()=>void onAction({type:'plan',command:{operation:'cancel',source:'card'}})}>取消剩余任务</button></section>;
  if (surface === 'question') return <PlanQuestion key={bank.plan?.currentTaskId} bank={bank} busy={busy} onAction={onAction}/>;
  if (surface === 'workflow') return <WorkflowPanel bank={bank} busy={busy} onAction={onAction} serial/>;
  return legacy;
}

function PlanQuestion({bank,busy,onAction}: Props) {
  const [text,setText]=useState('');
  const step=bank.plan?.steps.find(item=>item.id===bank.plan?.currentTaskId||item.taskId===bank.plan?.currentTaskId);
  if(!step)return null;
  const submit=(params?:Record<string,unknown>)=>onAction({type:'plan',command:{operation:'amend',taskId:step.taskId||step.id,...(params?{params}:{clarification:text}),source:'card'}});
  return <section className="business-card serial-card" aria-label="当前步骤"><div className="card-head"><Search aria-hidden size={20}/><h2>{step.question||step.title}</h2></div><form onSubmit={event=>{event.preventDefault();event.currentTarget.querySelector('input')?.blur();void submit();}}>{step.kind==='calculation'?<div className="flow-field"><span>账户</span><FlowSelect label="账户" placeholder="请选择账户" disabled={busy} value="" onChange={accountId=>void submit({accountId})} options={bank.accounts.map(account=>({value:account.id,label:account.name+' · '+account.tail}))}/></div>:<><label className="flow-field">补充信息<input value={text} onChange={event=>setText(event.target.value)} disabled={busy}/></label><button className="primary-button" disabled={busy||!text.trim()}>继续</button></>}</form></section>;
}

const historyBadge:Record<string,Badge>={complete:{label:'已完成',tone:'ok'},review:{label:'待确认',tone:'active'},collecting:{label:'补充信息',tone:'active'},authenticate:{label:'验证身份',tone:'active'},pending:{label:'待办理',tone:'muted'},queued:{label:'等待前序业务',tone:'muted'},blocked:{label:'暂无法办理',tone:'risk'},external:{label:'待处理',tone:'pending'},cancelled:{label:'已取消',tone:'muted'}};
export function TaskHistory({bank,busy,onAction,onClose}:{bank:BankState;busy:boolean;onAction:Props['onAction'];onClose:()=>void}) {
  const [selected,setSelected]=useState<string|null>(null);
  const tasks=bank.workflows?.tasks||[];
  const task=tasks.find(item=>item.id===selected);
  const entries=bank.plan?.steps.filter(step=>step.kind==='workflow')||[];
  const saved=entries.find(step=>step.taskId===selected||step.id===selected);
  if(task||saved)return <section className="business-card serial-card" aria-label="业务结果"><div className="card-top"><h2>{task?.title||saved!.title}</h2><button className="text-button" onClick={()=>setSelected(null)}>返回进度</button></div>{task?<WorkflowOutcome bank={bank} task={task}/>:<BusinessResult functionId={saved!.functionId||''} value={saved!.result} bank={bank}/>}</section>;
  const authenticating=tasks.find(item=>item.id===bank.workflows?.currentTaskId&&item.status==='authenticate');
  const rows=entries.map(step=>{const item=tasks.find(task=>task.id===step.taskId);return {id:step.taskId||step.id,...taskIdentity(bank,item||{title:step.title,functionId:step.functionId||'',params:step.params}),status:item?.status||step.status,ready:(!authenticating||step.taskId===authenticating.id)&&step.dependsOn.every(id=>bank.plan!.steps.find(item=>item.id===id)?.status==='complete')};});
  const previous=tasks.filter(item=>!entries.some(step=>step.taskId===item.id)).map(item=>({id:item.id,...taskIdentity(bank,item),status:item.status,ready:!authenticating||item.id===authenticating.id}));
  const render=(row:typeof rows[number])=><div className="task-history-row" key={row.id}><strong>{row.title}</strong>{row.detail&&<p>{row.detail}</p>}<span><Chip badge={historyBadge[row.status]||{label:'待办理',tone:'muted'}}/></span>{['complete','external','unsupported'].includes(row.status)?<button onClick={()=>setSelected(row.id)}>查看结果</button>:row.ready&&row.status!=='cancelled'?<button disabled={busy} onClick={()=>void onAction({type:'workflow',command:{operation:'resume',taskId:row.id,source:'card'}}).then(onClose)}>继续</button>:null}</div>;
  const activePlan=bank.plan&&!['complete','cancelled'].includes(bank.plan.status);
  return <section className="business-card serial-card" aria-label="办理进度"><div className="card-top card-head"><ListChecks aria-hidden size={20}/><h2>办理记录</h2><span className="card-head-end"><button className="text-button" onClick={onClose}>返回</button></span></div>{rows.map(render)}{!rows.length&&!previous.length&&<p className="card-description">还没有办理记录。</p>}{activePlan&&<div className="serial-actions"><button className="text-button" disabled={busy} onClick={()=>void onAction({type:'plan',command:{operation:bank.plan!.status==='paused'?'resume':'pause',source:'card'}})}>{bank.plan!.status==='paused'?'继续任务':'暂停任务'}</button><button className="text-button" disabled={busy} onClick={()=>void onAction({type:'plan',command:{operation:'cancel',source:'card'}})}>取消剩余任务</button></div>}{previous.length>0&&(rows.length?<details className="previous-tasks"><summary>其他记录</summary>{previous.map(render)}</details>:previous.map(render))}</section>;
}

export function ConversationHistory({messages,onClose}:{messages:{id:string;speaker:'user'|'assistant';text:string}[];onClose:()=>void}) {
  return <section className="business-card serial-card" aria-label="对话记录"><div className="card-top card-head"><MessagesSquare aria-hidden size={20}/><h2>对话记录</h2><span className="card-head-end"><button className="text-button" onClick={onClose}>返回</button></span></div>{messages.length?messages.map(item=><div className={`message ${item.speaker}`} key={item.id} aria-label={item.speaker==='user'?'你':'知行'}><p>{item.text}</p></div>):<p className="card-description">还没有对话。</p>}</section>;
}

