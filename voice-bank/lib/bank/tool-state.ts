// What voice and delegation see of the session. Reads only; pages use it without the tool decision logic.
import type { BankState } from './types.ts';
import { contactsOf } from './recipients.ts';
import { workflowToolResult } from '../workflows/realtime.ts';
import { planToolResult } from '../plans/realtime.ts';
import { savedMonthlyPlans } from '../plans/monthly-facts.ts';

export function bankToolResult(state:BankState){
  const t=state.task;
  const recipient=t?contactsOf(state).find(c=>c.id===t.recipientId):undefined;
  const receipt=t?.step==='complete'?state.receipts.find(r=>r.taskId===t.id):undefined;
  const unresolved=state.routing?.workflowId==='TF-T01'?state.routing.unresolved:[];
  const outer=planToolResult(state);
  const workflow=workflowToolResult(state);
    return {policyVersion:state.policyVersion,revision:state.revision,view:state.view,reply:state.lastReply,savedPlans:savedMonthlyPlans(state),
    cards:state.workflows?.records.cards.map(({id,name,tail,status,restriction})=>({id,name,tail,status,restriction})),workflow,plan:outer,
    currency:'CNY',amountUnit:'yuan',accounts:state.view==='balance'?state.accounts.map(a=>({...a,balance:a.balance/100,...(a.held?{held:a.held/100,available:(a.balance-a.held)/100}:{}),currency:'CNY'})):undefined,
    contacts:contactsOf(state).map(({id,name,label,tail})=>({id,name,label,tail})),
    task:t?{id:t.id,step:t.step,amount:t.amount==null?null:t.amount/100,recipientId:t.recipientId,accountId:t.accountId,confirmationToken:t.reviewToken||null,riskSignals:t.riskSignals}:null,
    transferProgress:t?{
      unresolved,question:unresolved.length?state.routing?.question:null,
      template:[{key:'recipientId',label:'转账目标',required:true,value:t.recipientId},{key:'accountId',label:'付款账户',required:true,value:t.accountId},{key:'amount',label:'金额（元）',required:true,value:t.amount==null?null:t.amount/100},{key:'note',label:'附言',required:false,value:t.note||null}],
      collected:{recipient:recipient?recipient.label+recipient.name:null,recipientId:t.recipientId,amount:t.amount==null?null:t.amount/100,accountId:t.accountId},
      missingFields:[...(!t.recipientId?['recipient']:[]),...(t.amount==null?['amount']:[]),...(!t.accountId?['account']:[])],
      preservedFields:state.routing?.evidence.filter(e=>e.source==='existing-task').map(e=>e.field)||[],
      nextAction:t.step==='complete'||t.step==='cancelled'?'show_result':state.checklist?.outcome==='blocked'||t.step==='review'&&!t.reviewToken?'explain_block':unresolved.length?'ask_clarification':t.step==='authenticate'?'complete_page_authentication':!t.recipientId||t.amount==null||!t.accountId?'ask_missing_fields':'review_current_summary',
    }:null,
    intent:state.routing?{workflowId:state.routing.workflowId,outcome:state.routing.outcome,unresolved:state.routing.unresolved}:null,
    checklist:state.checklist?{outcome:state.checklist.outcome,question:state.checklist.question,checks:state.checklist.checks.map(({id,status})=>({id,status}))}:null,
    receipt:receipt?{...receipt,amount:receipt.amount/100,currency:'CNY'}:undefined,
    instruction:outer&&!['complete','cancelled'].includes(outer.status)?outer.instruction:state.view==='workflow'&&workflow?workflow.instruction:'以当前任务和transferProgress为准。ask_clarification时按question澄清unresolved并等待用户，不用相同原话循环调用；否则只问missingFields。collected和preservedFields已明确，不重复追问。改金额不重问收款人/账户，改收款人不重问金额。信息齐全后只核对当前完整摘要；需要页面认证时引导认证，不重新收集。余额、限额、风险和当前摘要确认仍必须通过。不得声称未返回成功的操作已完成。',
  };
}
