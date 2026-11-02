import type {BankState} from '../bank/types.ts';
import type {PlanStep,TaskPlan} from './types.ts';
import {queueWorkflow} from '../workflows/engine.ts';
import {WorkflowError} from '../workflows/types.ts';

/** Compatibility metadata remains internal; every business entry uses its one real task ID. */
export function materialize(s:BankState,p:TaskPlan,source:'voice'|'card'='card',entries=p.steps){
 const ids=new Map<string,string>();
 for(const entry of entries){
  if(entry.kind!=='workflow'||!entry.functionId)continue;
  const id=entry.taskId||entry.id;ids.set(entry.id,id);entry.id=id;entry.taskId=id;
  if(!['complete','cancelled'].includes(entry.status)||s.workflows?.tasks.some(t=>t.id===id)){const task=queueWorkflow(s,id,entry.functionId,entry.params,{operation:'run',source,utterance:entry.quote});entry.params={...task.params};}
 }
 for(const entry of p.steps){entry.dependsOn=entry.dependsOn.map(id=>ids.get(id)||id);if(entry.binding)entry.binding=ids.get(entry.binding)||entry.binding;}
 p.version=3;p.taskIds=p.steps.filter(x=>x.kind==='workflow'&&x.taskId).map(x=>x.taskId!);
}
/** Old nested plans are flattened once; pending task instances and execution evidence are preserved. */
export function flattenPlan(s:BankState){
 const p=s.plan;if(!p||p.version===3)return;
 const entries:PlanStep[]=[],seen=new Set<string>(),seenPlans=new Set<string>();
 const visit=(q:TaskPlan)=>{
  if(seenPlans.has(q.id))return;seenPlans.add(q.id);
  for(const e of q.steps)if(!seen.has(e.taskId||e.id)){seen.add(e.taskId||e.id);entries.push(e);}
  if(q.returnTo?.status==='paused'){const last=q.steps.filter(e=>!['complete','cancelled'].includes(e.status)).at(-1);if(last)last.pauseAfter=true;}
  if(q.returnTo)visit(q.returnTo);q.parked?.forEach(visit);
 };
 visit(p);if(entries.length>40)throw new WorkflowError('历史任务较多，请先整理已有清单。');
 p.steps=entries;delete p.returnTo;delete p.parked;delete p.interruptionResults;
 materialize(s,p);if(p.steps.some(x=>!['complete','cancelled'].includes(x.status))&&['complete','cancelled'].includes(p.status))p.status='paused';
}
