import {publicValue} from '../workflows/realtime.ts';
import type {BankState} from '../bank/types.ts';
import {currentPlanStep} from './current.ts';
import {availableBalance} from '../bank/accounts.ts';
import {monthlyBudgetTotal} from './monthly-facts.ts';

export function planToolResult(s:BankState){
 const p=s.plan;if(!p)return;const current=currentPlanStep(s);
 const cash=s.accounts.reduce((n,a)=>n+a.balance,0),available=s.accounts.reduce((n,a)=>n+availableBalance(a),0),goals=(s.workflows?.records.goals||[]).reduce((n,g)=>n+Number(g.balance||0),0),budget=monthlyBudgetTotal(p);
 return {monthly:p.monthly?publicValue({period:p.monthly.period,source:'已保存模板；本月任务及进度',balance:cash,available,goalBalance:goals,assets:cash+goals,budget,unallocated:available-budget,amountUnit:'yuan',notice:'未分配金额不是银行余额；占用已在账面中，不再计入资产。每项分别确认认证，投资受理不等于持仓。'}):undefined,id:p.id,status:p.status,message:p.message,announcements:p.announcements||[],taskIds:p.taskIds,currentTaskId:current?.taskId||current?.id,requiresFreshConfirmation:!!current?.taskId&&current.openedTurnId===p.lastUserTurnId,
  accounts:current?.kind==='calculation'?s.accounts.map(({id,name,tail,balance})=>({id,name,tail,balance:balance/100,amountUnit:'yuan'})):undefined,
  completedResults:p.steps.filter(x=>x.status==='complete'&&x.taskId).slice(-3).map(x=>({taskId:x.taskId,functionId:x.functionId,title:x.title,result:publicValue(x.result)})),
  resumeRequest:{name:'bank_plan',arguments:{operation:'resume'}},
  tasks:p.steps.map(x=>({taskId:x.taskId||x.id,title:x.title,kind:x.kind,status:x.status,functionId:x.functionId,params:x.params,source:p.monthly?'已保存模板或本轮用户预算':undefined,result:publicValue(x.result),question:x.question,
   resumeRequest:!['complete','cancelled'].includes(x.status)?{name:'bank_plan',arguments:{operation:'resume',taskId:x.taskId||x.id}}:undefined,
   calculation:x.calculation?{accountId:x.calculation.accountId,balance:x.calculation.balanceCents/100,amount:x.calculation.amountCents/100,numerator:x.calculation.numerator,denominator:x.calculation.denominator,rounding:x.calculation.rounding,amountUnit:'yuan'}:undefined})),
  nextAction:p.status==='complete'||p.status==='cancelled'?'show_result':p.status==='paused'||p.status==='blocked'?'explain_stop':p.status==='collecting'?'ask_task_purpose':current?.kind==='calculation'?'choose_account':current?.status==='authenticate'?'complete_page_authentication':current?.status==='review'?'review_current_task':'ask_missing_fields',
  instruction:'所有业务使用同一个Plan任务清单。业务实例已提前建立，尚未开始不等于执行。后台负责完成当前Checklist后检查清单并进入下一项；先告知message中的切换，再按当前Checklist交互。不需要传Plan ID或维护Step ID。amend保存当前任务；补充或恢复指定任务时只引用它的taskId。中途新业务interrupt插入同一清单，原任务的字段保留；不重复create。已完成任务不重做；每项写业务分别核对、确认和页面认证。未知用途先澄清；external或blocked等待实际条件。先解释结果并等待用户，不循环调用状态。',
 };
}
