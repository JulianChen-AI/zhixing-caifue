// Read-only facts about saved monthly plans; pages and tool state need these without the plan machinery.
import type { BankState } from '../bank/types.ts';
import { businessDay } from '../demo/clock.ts';
import type { TaskPlan } from './types.ts';

export function savedMonthlyPlans(s:BankState){
 const period=businessDay(s).slice(0,7),saved=s.plan?.monthly?.period===period?s.plan:s.monthlyHistory?.[period];
 const template=s.workflows?.records.rules?.find(r=>r.kind==='monthly_template'&&r.status==='template');
 return saved||template?[{kind:'monthly',period,title:'已保存的月度安排',source:saved?'本月已保存的安排与进度':'已保存的月度模板',notice:'可查看金额、对象、依据和进度；展示不授权付款，不证明工资已到账。',openRequest:{name:'bank_plan',arguments:{operation:'open_saved'}}}]:[];
}
export function monthlyBudgetTotal(plan:TaskPlan):number {
 const latest=new Map<string,number>();
 for(const step of plan.steps){
  if(step.functionId!=='BI08'||step.params.action!=='set'||step.status==='cancelled'||(step.result as {status?:string}|null)?.status==='failed')continue;
  const amount=Number(step.params.amount),cents=Math.round(amount*100);
  if(!Number.isFinite(amount)||!Number.isSafeInteger(cents)||amount<=0)continue;
  latest.set(JSON.stringify([step.params.period,step.params.category]),cents);
 }
 return [...latest.values()].reduce((total,amount)=>total+amount,0);
}
