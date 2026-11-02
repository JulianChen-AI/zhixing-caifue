import type {BankState} from '../bank/types.ts';
/** Re-reading a task may advance revision without filling anything. Compare business facts. */
export function businessProgress(state:BankState){
 const task=state.workflows?.tasks.find(t=>t.id===state.workflows?.currentTaskId),transfer=state.task;
 return JSON.stringify({view:state.view,plan:state.plan&&{id:state.plan.id,status:state.plan.status,steps:state.plan.steps.map(x=>({id:x.id,status:x.status,taskId:x.taskId})),currentTaskId:state.plan.currentTaskId,taskIds:state.plan.taskIds},task:task&&{id:task.id,status:task.status,params:task.params},transfer:transfer&&{id:transfer.id,step:transfer.step,recipientId:transfer.recipientId,accountId:transfer.accountId,amount:transfer.amount,note:transfer.note}});
}
