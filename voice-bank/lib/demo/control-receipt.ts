// Recognizes demo controls and their replays; pages need this without the scene and schedule machinery.
import type { BankAction, BankState } from '../bank/types.ts';
import { WorkflowError } from '../workflows/types.ts';

export type Control = Extract<BankAction,{type:'load_scene'|'advance_clock'|'reset'}>;
export function isDemoControl(state:BankState,action:BankAction):action is Control {
 return action.type==='load_scene'||action.type==='advance_clock'||action.type==='reset'&&!!state.sceneEpoch;
}
export function fingerprint(action:Control):string {
 return JSON.stringify(action.type==='load_scene'?{type:action.type,sceneId:action.sceneId}:action.type==='advance_clock'?{type:action.type,to:action.to}:{type:action.type});
}
export function assertSceneEpoch(state:BankState,expectedEpoch?:string){
 if((state.sceneEpoch??null)!==(expectedEpoch??null))throw new WorkflowError('演示场景已改变，请刷新后重试。',409,'sceneEpoch');
}
export function demoControlReplay(state:BankState,action:BankAction,requestId:string,sourceEpoch?:string):boolean {
 const receipt=state.lastDemoControl;
 if(!receipt||receipt.requestId!==requestId)return false;
 if(!isDemoControl(state,action)||receipt.actionFingerprint!==fingerprint(action)||receipt.sourceEpoch!==(sourceEpoch??null)||state.sceneEpoch!==receipt.resultEpoch)throw new WorkflowError('控制请求与原结果不一致，请刷新后重试。',409,'sceneEpoch');
 return true;
}
