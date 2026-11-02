import type {BankState} from '../bank/types.ts';
import {workflowReview} from '../workflows/review.ts';
import type {queryReviewFacts} from './query-review.ts';

/** Only authoritative saved state supplies a correction; the rejected speech
 * is never used as the next readback script or as execution authority. */
export function correctedReadback(state:BankState,query?:ReturnType<typeof queryReviewFacts>){
 const receipt=query?.receipts.at(-1);
 const t=receipt?state.workflows?.tasks.find(t=>t.id===receipt.taskId):state.workflows?.tasks.find(t=>t.id===state.workflows?.currentTaskId);
 if(!t)return '更正：'+state.lastReply;
 if(t.status==='review')return '更正：这项业务尚未执行。'+workflowReview(state,t).spokenSummary;
 if(t.status==='authenticate')return '更正：信息已确认，正在等待你在业务卡片完成演示认证，当前业务尚未执行。';
 if(t.status!=='complete')return '更正：'+t.message;
 const data=t.result as {spokenSummary?:unknown}|null;
 if(typeof data?.spokenSummary==='string')return '更正：'+data.spokenSummary;
 if(t.functionId==='TR02'&&Array.isArray(t.result))return '更正：'+t.result.map((a:{name:string;balance:number})=>a.name+'余额'+(a.balance/100).toFixed(2)+'元').join('；')+'。';
 return '更正：'+t.message;
}
