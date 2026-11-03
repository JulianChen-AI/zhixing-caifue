'use client';
import {useState} from 'react';
import type {BankAction,BankState} from '@/lib/bank/types';
import type {PlanStep} from '@/lib/plans/types';
import {availableBalance} from '@/lib/bank/accounts';
import {monthlyBudgetTotal} from '@/lib/plans/monthly';
import {FlowSelect} from './flow-select';

type Props={bank:BankState;busy:boolean;onAction:(a:BankAction)=>Promise<void>};
const money=(n:number)=>(n/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const labels:Record<string,string>={pending:'未执行',queued:'未执行',collecting:'待补充',review:'待确认',authenticate:'待演示认证',complete:'已返回结果',blocked:'失败 / 暂停',external:'待核对',cancelled:'未办理'};
/** A saved template is visibly distinct from a payment and each inner authorization. */
export function MonthlyPlan({bank,busy,onAction}:Props){
 const p=bank.plan;if(!p?.monthly)return null;
 const cash=bank.accounts.reduce((n,a)=>n+a.balance,0),available=bank.accounts.reduce((n,a)=>n+availableBalance(a),0);
 const goals=(bank.workflows?.records.goals||[]).reduce((n,g)=>n+Number(g.balance||0),0);
 const budgets=monthlyBudgetTotal(p);
 return <details className="business-card serial-card monthly-plan" aria-label="本月安排" open={p.status==='blocked'}>
  <summary><span>{p.monthly.period} 各项明细</span><small>{p.steps.length} 项 · 可修改金额、账户和对象</small></summary>
  <p className="monthly-note" aria-label="安排依据">逐项确认，不是汇总授权。金额和对象沿用已保存的模板；模板与预算不扣款，投资仅受理。</p>
  <ol className="plan-steps">{p.steps.map(step=><MonthlyItem key={step.id+JSON.stringify(step.params)} {...{bank,busy,onAction,step}}/>)}</ol>
  <p role="status">{p.message}</p>{p.monthly.rentUnknown&&<p className="card-description">账面为最近已确认的记录；房租结果未知不代表已确认未扣款，资金步骤保持暂停。</p>}
  <div className="details-list"><div><span>活期账面 / 可用</span><strong>¥{money(cash)} / ¥{money(available)}</strong></div><div><span>目标余额 / 模拟资产合计</span><strong>¥{money(goals)} / ¥{money(cash+goals)}</strong></div><div><span>计划未分配（可用减本计划预算，非银行余额）</span><strong>¥{money(available-budgets)}</strong></div></div>
 </details>;
}
function MonthlyItem({bank,busy,onAction,step}:Props&{step:PlanStep}){
 const [amount,setAmount]=useState(String(step.params.amount??''));
 const task=bank.workflows?.tasks.find(t=>t.id===step.taskId),p=bank.plan!;
 const account=bank.accounts.find(a=>a.id===step.params.accountId),payee=bank.contacts?.find(c=>c.id===step.params.recipientId);
 const product=bank.workflows?.records.products.find(x=>x.id===step.params.productId),goal=bank.workflows?.records.goals.find(x=>x.id===step.params.goalId);
 const result=task?.result as {status?:string;originalTransferId?:string;reason?:string}|null;
 const status=result?.status==='unknown'?'结果未知 · 回查原订单':result?.status==='failed'?'失败 · 未划款':result?.status==='pending'?'申请已受理 · 待结算':step.functionId==='BI08'&&task?.status==='complete'?'预算已保存 · 未扣款未占用':step.functionId==='BI06'&&task?.status==='complete'?'报告已生成 · 仅含已取得记录':labels[task?.status||step.status];
 const editable=!['complete','cancelled','authenticate','external'].includes(task?.status||step.status)&&result?.status!=='unknown';
 const command=(operation:'amend'|'resume'|'status',params?:Record<string,unknown>)=>onAction({type:'plan',command:{operation,taskId:step.taskId||step.id,source:'card',...(params?{params}:{})}});
 const options=step.functionId==='TR03'?bank.contacts?.map(c=>({value:c.id,label:`${c.name} · ${c.label} · ${c.tail}`})):step.functionId==='IN08'?bank.workflows?.records.products.map(x=>({value:x.id,label:String(x.name)})):undefined;
 const kind=step.functionId==='TR03'?'转账':step.functionId==='IN02'?'内部划款 · 非消费':step.functionId==='IN08'?'投资申请 · 非确认持仓':step.functionId==='BI08'?'预算标记 · 不扣款不冻结':step.functionId==='IN04'?'目标储蓄规则 · 有次数和期限':step.functionId==='IN15'?'投教 · 自愿可跳过':'只读查询';
 const flow=[account?`${account.name} ${account.tail}`:'',payee?`${payee.name}（${payee.label}）${payee.tail}`:product?String(product.name):goal?String(goal.name):''].filter(Boolean).join(' → ');
 return <li data-status={task?.status||step.status} className="monthly-row">
  <div className="monthly-row-main"><strong>{step.title}</strong><small>{kind}{flow?` · ${flow}`:''}</small></div>
  <b className="monthly-row-amount">{step.params.amount!=null?`¥${money(Math.round(Number(step.params.amount)*100))}`:'—'}</b>
  <span className="monthly-row-status">{status}</span>
  {editable&&(step.params.amount!=null||account||options)&&<details className="monthly-row-edit"><summary>修改</summary>
  {editable&&step.params.amount!=null&&<form onSubmit={e=>{e.preventDefault();void command('amend',{amount:Number(amount)});}}><label className="flow-field">{step.title}金额（元）<input aria-label={step.title+'金额'} inputMode="decimal" type="number" step="0.01" min="0.01" value={amount} onChange={e=>setAmount(e.target.value)} disabled={busy}/></label><button className="text-button" disabled={busy||!amount||Number(amount)<=0||Number(amount)===Number(step.params.amount)}>保存{step.title}金额</button></form>}
  {editable&&account&&<FlowSelect label={step.title+'付款账户'} value={account.id} disabled={busy} options={bank.accounts.map(a=>({value:a.id,label:`${a.name} · ${a.tail}`}))} onChange={accountId=>void command('amend',{accountId})}/>}
  {editable&&options&&<FlowSelect label={step.title+'对象'} value={String(step.params.recipientId||step.params.productId||'')} disabled={busy} options={options} onChange={value=>void command('amend',{[step.functionId==='TR03'?'recipientId':'productId']:value})}/>}
  </details>}
  {result?.status==='unknown'&&<button className="secondary-button" disabled={busy} onClick={()=>void command('status')}>回查房租原订单</button>}
  {result?.status==='failed'&&<button className="secondary-button" disabled={busy} onClick={()=>void command('resume')}>重试失败储蓄项</button>}
  {p.status==='blocked'&&['BI08','BI06'].includes(step.functionId||'')&&!['complete','cancelled'].includes(task?.status||'')&&<button className="secondary-button" disabled={busy} onClick={()=>void command('resume')}>单独办理{step.title}</button>}
  {result?.reason&&<p>{result.reason}</p>}{['TR03','IN08'].includes(step.functionId||'')&&(result?.originalTransferId||(result as {id?:string}|null)?.id)&&<p>{step.functionId==='IN08'?'投资申请编号':result?.status==='unknown'?'原订单':'凭证编号'}：{result?.originalTransferId||(result as {id?:string}).id}</p>}
 </li>;
}
