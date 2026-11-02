import type {BankState} from '../bank/types.ts';

/** Match a concrete spoken outcome to its actual receipt. This is read-only;
 * a pending task alone is never a reason to interrupt normal conversation. */
export function spokenResultIssue(state:BankState,reply:string){
 const task=state.workflows?.tasks.find(t=>t.id===state.workflows?.currentTaskId);
 const legacy=task?.functionId==='TR03'?state.task?.id===task.legacyTaskId?state.task:undefined:state.view==='transfer'?state.task:undefined;
 if(task?.functionId!=='TR03'&&!legacy)return;
 const taskId=task?.functionId==='TR03'?task.legacyTaskId:legacy?.id;
 if(taskId&&state.receipts.some(receipt=>receipt.taskId===taskId))return;
 for(const clause of reply.split(/[，,。；;！？!?\n]/)){
  if(/还没|没有|尚未|不能|不代表|不等于|如果|假如|假设|例如|比如|声称|说成|不要|并非|上次|之前|上一笔|昨天|历史|吗|么/.test(clause))continue;
  const claim=clause.match(/(?:已经|已)(?:成功)?(?:转出|到账|扣款)(?:了)?|(?:转账|付款)(?:已)?成功|(?:转出|到账|扣款)了/);
  if(claim)return {message:'回复声称资金已转出或到账，但当前转账没有成功回执；应如实说明当前核对或认证进度。',claimQuote:claim[0],evidence:JSON.stringify({taskId,status:task?.status||legacy?.step,receiptExists:false})};
 }
}
