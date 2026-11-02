import type {BankState} from './types.ts';
import {bankToolResult} from './realtime-tools.ts';
import {workflowToolResult} from '../workflows/realtime.ts';
import {planToolResult} from '../plans/realtime.ts';

/** The operation receipt has its own identity; UI focus is not a tool return value. */
export function operationToolResult(previous:BankState,state:BankState,tool:{name:string;arguments:{operation:string;taskId?:string;functionId?:string}}){
 if(tool.name==='bank_plan'&&tool.arguments.operation==='open_saved')return {...bankToolResult(state),operationResult:{name:tool.name,operation:tool.arguments.operation,revision:state.revision,plan:planToolResult(state),message:state.lastReply}};
 const args=tool.arguments,old=new Set(previous.workflows?.tasks.map(t=>t.id));
 const created=state.workflows?.tasks.filter(t=>!old.has(t.id))||[];
 const task=args.taskId?state.workflows?.tasks.find(t=>t.id===args.taskId):
  ['list','describe'].includes(args.operation)?created.at(-1)||state.workflows?.tasks.filter(t=>t.title==='可办理功能'&&t.functionId===(args.operation==='list'?'catalog':args.functionId||'catalog')).at(-1):
  created.find(t=>t.status!=='queued')||state.workflows?.tasks.find(t=>t.id===previous.workflows?.currentTaskId);
 return {...bankToolResult(state),operationResult:{name:tool.name,operation:args.operation,revision:state.revision,
  workflow:task?workflowToolResult(state,task.id):undefined,
  message:tool.name==='bank_plan'&&state.plan?.monthly?state.lastReply:task?.message||state.lastReply,
 }};
}
