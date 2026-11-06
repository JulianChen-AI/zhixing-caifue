import type { BankAction, BankState } from '../bank/types.ts';
import { isWrite } from '../workflows/adapters.ts';
import { WorkflowError } from '../workflows/types.ts';
import { buildScene, SCENE_IDS, SCENE_VERSION } from './scenes.ts';
import { runGoalRules, settleDueTransfers } from './schedule.ts';

import { assertSceneEpoch, demoControlReplay, fingerprint, isDemoControl, type Control } from './control-receipt.ts';
export { assertSceneEpoch, demoControlReplay, isDemoControl };

function validInstant(value:string){
 const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
 if(!m||!Number.isFinite(Date.parse(value)))return false;
 const [year,month,day,hour,minute,second]=m.slice(1).map(Number),d=new Date(Date.UTC(year,month-1,day,hour,minute,second));
 return d.getUTCFullYear()===year&&d.getUTCMonth()===month-1&&d.getUTCDate()===day&&d.getUTCHours()===hour&&d.getUTCMinutes()===minute&&d.getUTCSeconds()===second;
}
/** Time passing settles due new-payee transfers and runs saved monthly goal deposits, each once; nothing else executes. */
function advanceScheduledWork(state:BankState,from:number):{state:BankState;done:string[]}{
 const to=Date.parse(state.demoClock!),settled=settleDueTransfers(state,to),runs=runGoalRules(state,from,to);
 return {state,done:[...settled.map(r=>`延迟转账${r.id}到账`),...runs.map(r=>`${r.date}目标存入${Number(r.amount)/100}元${r.status==='executed'?'已执行':'未执行（'+r.reason+'）'}`)]};
}
export function reduceDemoControl(prev:BankState,action:Control,id:string,baseState:BankState):BankState {
 const fingerprintValue=fingerprint(action),old=prev.lastDemoControl;
 if(old?.requestId===id){
  if(old.actionFingerprint!==fingerprintValue||prev.sceneEpoch!==old.resultEpoch)throw new WorkflowError('控制请求与原结果不一致，请刷新后重试。',409,'sceneEpoch');
  return prev;
 }
 if(prev.recentRequestIds.includes(id))throw new WorkflowError('控制请求编号已使用，请刷新后重试。',409,'sceneEpoch');
 if(action.type==='load_scene'&&!(SCENE_IDS as readonly string[]).includes(action.sceneId))throw new WorkflowError('未知演示场景。');
 const tasks=prev.workflows?.tasks||[];
 if(action.type==='advance_clock'){
  if(prev.task&&['review','authenticate'].includes(prev.task.step)||tasks.some(t=>['review','authenticate'].includes(t.status)&&isWrite(t)))throw new WorkflowError('请先处理待核对或待认证的业务，再调整演示时间。',409);
  if(!prev.demoClock||!validInstant(prev.demoClock))throw new WorkflowError('当前场景没有可调整的演示时间。',409);
  if(!validInstant(action.to)||Date.parse(action.to)<=Date.parse(prev.demoClock))throw new WorkflowError('演示时间必须是有效且晚于当前时间的 ISO 时间。');
 }else if(prev.task?.step==='authenticate'||tasks.some(t=>t.status==='authenticate'))throw new WorkflowError('请先完成或取消待认证业务，再切换场景。',409);
 const epoch=crypto.randomUUID(),sourceEpoch=prev.sceneEpoch??null;
 const advanced=action.type==='advance_clock'?advanceScheduledWork({...structuredClone(prev),demoClock:action.to},Date.parse(prev.demoClock!)):undefined;
 let next=advanced?advanced.state:buildScene(action.type==='load_scene'?action.sceneId:'default',baseState);
 next={...next,...(action.type==='advance_clock'?{}:{sceneId:action.type==='reset'?'default':action.sceneId,sceneVersion:SCENE_VERSION}),revision:prev.revision+1,sceneEpoch:epoch,recentRequestIds:[...prev.recentRequestIds.slice(-63),id],lastDemoControl:{requestId:id,type:action.type,actionFingerprint:fingerprintValue,sourceEpoch,resultEpoch:epoch,resultRevision:prev.revision+1}};
 const reason=action.type==='advance_clock'
  ?`演示场景 ${next.sceneId??'default'} 的演示时间推进至 ${next.demoClock}；${advanced!.done.length?'模拟调度：'+advanced!.done.join('；'):'没有到期的业务'}。`
  :`加载合成演示场景 ${next.sceneId}，演示时间 ${next.demoClock??'系统时间'}；仅加载数据，未执行业务。`;
 next.audit=[...next.audit.slice(-99),{id,at:new Date().toISOString(),action:action.type,workflowId:'DEMO-CONTROL',policyVersion:next.policyVersion,outcome:'proceed',reason,fromStep:prev.task?.step||null,toStep:next.task?.step||null,checks:[],evidence:[]}];
 return next;
}
