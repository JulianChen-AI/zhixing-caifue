import type {BankState,DelegationRequest} from '../bank/types.ts';
import {inferFunction,clauses} from '../plans/decompose.ts';

/** Only persisted, unfinished business requests may be resumed. History never
 * supplies confirmation or authentication authority. Multiple matches require choice. */
export function savedDelegationInput(state:BankState,text:string){
 if(!/^(?:请)?(?:继续|恢复)(?:办理)?(?:刚才的?|之前的?|原来的?)?(?:转账|任务|请求|办理|计划)?[。！!\s]*$/.test(text.trim()))return;
 if(state.plan&&!['complete','cancelled'].includes(state.plan.status)||state.workflows?.tasks.some(t=>['collecting','review','authenticate','blocked','queued'].includes(t.status)))return;
 const id=inferFunction(text);
 const candidates=(state.delegationRequests||[]).filter(r=>r.kind==='business'&&['pending','paused'].includes(r.status)&&!r.taskIds.length&&r.sceneEpoch===state.sceneEpoch&&(!id||inferFunction(r.utterance)===id));
 // Resuming a child supersedes its parent, not a second independent request.
 const parents=new Set(candidates.map(r=>r.resumes).filter(Boolean));
 return candidates.filter(r=>!parents.has(r.id));
}
export function requestEntry(state:BankState,text:string,turnId:string,resumes?:string):DelegationRequest {
 return {id:turnId,turnId,utterance:text,sceneEpoch:state.sceneEpoch,kind:/确认|确定|取消|不转了|不办了|^(?:继续|恢复)/.test(text)?'control':'business',status:'pending',taskIds:[],functions:[...new Set(clauses(text).map(inferFunction).filter((id):id is string=>!!id))],resumes};
}
