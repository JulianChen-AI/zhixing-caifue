'use client';
import { useState } from 'react';
import type { BankAction, BankState } from '@/lib/bank/types';
import type { PlanStep } from '@/lib/plans/types';
import {BusinessResult} from './workflow-panel';
import {FlowSelect} from './flow-select';

const labels:Record<string,string>={pending:'待办理',collecting:'补充信息',review:'待确认',authenticate:'验证身份',complete:'已完成',blocked:'暂无法办理',external:'待你处理',cancelled:'已取消'};
export function PlanPanel({bank,busy,onAction}:{bank:BankState;busy:boolean;onAction:(a:BankAction)=>Promise<void>}){
 const p=bank.plan;if(!p)return null;
 if(p.steps.length===1&&p.steps[0].kind==='workflow')return null;
 if(['complete','cancelled'].includes(p.status)&&!p.steps.some(x=>x.taskId===bank.workflows?.currentTaskId))return null;
 const command=(c:Record<string,unknown>)=>onAction({type:'plan',command:{...c,source:'card'} as Extract<BankAction,{type:'plan'}>['command']});
 const done=p.steps.filter(x=>x.status==='complete').length;
 return <section className="plan-panel" aria-label="任务清单">
  <div className="plan-heading"><h2>办理进度</h2><span>{done} / {p.steps.length} 已完成</span></div>
  <ol className="plan-steps">{p.steps.map((step,i)=><li key={step.id} data-status={step.status}>
   <div className="plan-step-heading"><strong>{step.status==='complete'?'✓':i+1} · {step.title}</strong><span>{labels[step.status]}</span></div>
   {step.functionId&&step.result!=null&&['complete','external'].includes(step.status)&&<details className="flow-result" aria-label={step.title+'的办理结果'}><summary>查看本项结果</summary><BusinessResult functionId={step.functionId} value={step.result}/></details>}
   {step.dependsOn.length>0&&<small>在第 {p.steps.findIndex(x=>x.id===step.dependsOn[0])+1} 步完成后办理</small>}
   {step.calculation&&<p className="plan-calculation">{bank.accounts.find(a=>a.id===step.calculation!.accountId)?.name}余额 ¥{(step.calculation.balanceCents/100).toFixed(2)} × {step.calculation.numerator}/{step.calculation.denominator} = ¥{(step.calculation.amountCents/100).toFixed(2)}</p>}
   {step.kind==='clarify'&&!['complete','cancelled'].includes(p.status)&&<Clarification key={step.id} step={step} busy={busy||p.status==='paused'} submit={text=>command({operation:'amend',taskId:step.taskId||step.id,clarification:text})}/>}
   {step.kind==='calculation'&&step.status==='collecting'&&<div className="flow-field"><span>{step.question}</span><FlowSelect label="比例计算账户" placeholder="请选择账户" disabled={busy||p.status==='paused'} value="" onChange={accountId=>void command({operation:'amend',taskId:step.taskId||step.id,params:{accountId}})} options={bank.accounts.map(a=>({value:a.id,label:a.name+' · 尾号'+a.tail}))}/></div>}
  </li>)}</ol>
  {!['complete','cancelled'].includes(p.status)&&<div className="plan-controls"><button className="secondary-button" disabled={busy} onClick={()=>void command({operation:p.status==='paused'||p.status==='blocked'?'resume':'pause'})}>{p.status==='paused'||p.status==='blocked'?'继续任务':'暂停任务'}</button><button className="text-button" disabled={busy} onClick={()=>void command({operation:'cancel'})}>取消剩余步骤</button></div>}
  {p.steps.filter(x=>x.taskId&&x.taskId!==bank.workflows?.currentTaskId&&!['complete','cancelled'].includes(x.status)).map(x=><button key={x.id} className="text-button" disabled={busy} onClick={()=>void command({operation:'resume',taskId:x.taskId})}>继续：{x.title}</button>)}
 </section>;
}
function Clarification({step,busy,submit}:{step:PlanStep;busy:boolean;submit:(text:string)=>Promise<void>}){
 const [text,setText]=useState('');
 return <form className="plan-clarification" onSubmit={e=>{e.preventDefault();void submit(text);}}><label>{step.question}<input aria-label="补充步骤用途" value={text} onChange={e=>setText(e.target.value)} placeholder="例如：把500元存入旅行目标，用日常账户" disabled={busy}/></label><button className="secondary-button" disabled={busy||!text.trim()}>补充这一步</button></form>;
}

