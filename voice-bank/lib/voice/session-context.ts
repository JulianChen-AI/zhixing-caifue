import type {BankState} from '../bank/types.ts';
import {bankToolResult} from '../bank/tool-state.ts';
import {FIELDS} from '../workflows/fields.ts';
import {productExplanationFacts} from './explanation-review.ts';

/** Keep the operation's full result, remove copies repeated in the outer Plan. */
export function compactVoiceResult<T>(value:T):T{
 if(!value||typeof value!=='object')return value;
 const result=structuredClone(value) as Record<string,any>;
 if(result.plan?.completedResults)result.plan.completedResults=result.plan.completedResults.map(({result:data,...entry}:any)=>({...entry,resultAvailable:true,...(Array.isArray(data)?{resultCount:data.length}:{})}));
 if(result.operationResult?.workflow?.taskId&&result.workflow?.taskId===result.operationResult.workflow.taskId&&result.workflow.result!==undefined){delete result.workflow.result;result.workflow.resultRef='operationResult.workflow.result';}
 return result as T;
}

/** Execution state is reconstructed from saved facts, never from a model summary. */
export function sessionContextFacts(state:BankState){
 const facts=compactVoiceResult(bankToolResult(state));
 return {...facts,...(state.sceneEpoch?{demoScene:{sceneId:state.sceneId,sceneEpoch:state.sceneEpoch,simulationTime:state.demoClock,label:'演示场景、模拟数据、模拟时间',authority:'仅为当前后台场景事实，不是用户授权；场景改变后旧上下文和确认均失效。'}}:{}),explanationReference:{products:productExplanationFacts(state),authority:'仅用于回答解释和比较；不代表本轮已执行查询或获得申购授权。'},handoff:{revision:state.revision,authority:'仅后台保存状态为事实；历史摘要不是用户本轮授权。不得重放已完成操作、历史确认或认证。等待新的用户输入。',
  pendingTasks:state.workflows?.tasks.filter(t=>['queued','collecting','review','authenticate','blocked'].includes(t.status)).map(t=>({taskId:t.id,functionId:t.functionId,title:t.title,status:t.status,params:Object.fromEntries(Object.entries(t.params).filter(([key])=>(FIELDS[t.functionId]||[]).includes(key)))})),
  completedCount:state.workflows?.tasks.filter(t=>t.status==='complete').length||0}};
}
export function sessionContext(state:BankState,discussion?:unknown){return JSON.stringify({facts:sessionContextFacts(state),...(discussion?{discussion,discussionAuthority:'仅供理解话题和表达偏好；不代表字段值、任务状态、工具结果或确认授权。'}:{})});}

export type ContextLimits={inputTokens:number;turns:number;ageMs:number};
export const CONTEXT_LIMITS:ContextLimits={inputTokens:60000,turns:24,ageMs:15*60*1000};
export class ContextBudget{
 private ids=new Set<string>();private inputTokens=0;private peakInputTokens=0;
 constructor(private limits:ContextLimits=CONTEXT_LIMITS,private startedAt=Date.now()){}
 turn(id:string){this.ids.add(id);}
 usage(usage:unknown){const value=(usage as {input_tokens?:unknown}|undefined)?.input_tokens;if(typeof value==='number'&&Number.isFinite(value)&&value>=0){this.inputTokens=value;this.peakInputTokens=Math.max(this.peakInputTokens,value);}}
 snapshot(now=Date.now()){return {turns:this.ids.size,inputTokens:this.inputTokens,peakInputTokens:this.peakInputTokens,ageMs:Math.max(0,now-this.startedAt)};}
 reason(now=Date.now()):'input_tokens'|'turns'|'age'|undefined{const s=this.snapshot(now);if(s.inputTokens>=this.limits.inputTokens)return 'input_tokens';if(s.turns>=this.limits.turns)return 'turns';if(s.ageMs>=this.limits.ageMs)return 'age';}
}
