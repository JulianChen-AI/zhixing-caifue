import {z} from 'zod';
import {correctedReadback} from '@/lib/voice/corrected-readback';
import {replyReviewInput,reviewReply} from '@/lib/voice/reply-review';
import {checkOrigin,loadSession,reloadSession,sessionHeaders,commit,provider,errorResponse} from '@/lib/bank/server';
import {BankError} from '@/lib/bank/engine';
import {bankToolResult} from '@/lib/bank/realtime-tools';
import {dispatchAction} from '@/lib/plans/dispatch';
import {operationToolResult} from '@/lib/bank/tool-result';
import {explanationReviewFacts} from '@/lib/voice/explanation-review';
import {queryReviewFacts} from '@/lib/voice/query-review';
import {assertSceneEpoch} from '@/lib/demo/control';
const schema=z.object({requestId:z.string().min(8).max(100),revision:z.number().int().nonnegative(),sceneEpoch:z.string().uuid().optional(),review:replyReviewInput}).strict();
export async function POST(req:Request){
 try{
  checkOrigin(req);if(Number(req.headers.get('content-length'))>24000)throw new BankError('请求过长。',413);
  const body=schema.parse(await req.json()),session=await loadSession(req);
  assertSceneEpoch(session.state,body.sceneEpoch);
  if(session.state.revision!==body.revision)throw new BankError('办理内容已更新，请核对最新卡片。',409);
  // A lost repair response must not execute the action again with a fresh model proposal.
  if(session.state.recentRequestIds.includes(body.requestId))return Response.json({state:session.state,decision:'repair',facts:bankToolResult(session.state),toolAttempted:true},{headers:sessionHeaders(session,req)});
  const p=provider();if(!p.ready)throw new BankError('后台复核暂不可用，请查看业务卡片。',503);
  const result=await reviewReply(session.state,body.review,p,req.signal);
  req.signal.throwIfAborted();
  const state=result.action&&!body.review.contentOnly?await commit(session,dispatchAction(session.state,result.action,body.review.utterance,body.review.turnId),body.revision,body.requestId,body.sceneEpoch):session.state;
  // Recheck the revision even for a read-only verdict: a page action may have changed facts during Flash inference.
  const latest=await reloadSession(session);
  assertSceneEpoch(latest.state,body.sceneEpoch);
  if(latest.state.revision!==state.revision)throw new BankError('办理内容已更新，旧回复未播放，请核对最新卡片。',409);
  const recent=state.workflows?.log.filter(log=>(log.revision??-1)>body.review.startRevision).at(-1);
  const query=result.decision!=='accept'?queryReviewFacts(state,body.review.utterance,body.review.startRevision):undefined;
  const repairScope=query?'query':result.repairScope;
  const facts=query?{revision:state.revision,originalRequest:body.review.utterance,startRevision:body.review.startRevision,query}:repairScope==='explanation'?{revision:state.revision,originalRequest:body.review.utterance,explanation:explanationReviewFacts(state,body.review.startRevision)}:result.action?.type==='workflow'?operationToolResult(session.state,state,{name:'bank_function',arguments:result.action.command}):recent?operationToolResult(state,state,{name:'bank_function',arguments:{operation:recent.operation,taskId:recent.taskId}}):bankToolResult(state);
  return Response.json({state,decision:result.decision,message:result.message,repairScope,readback:result.decision==='repair'&&repairScope!=='explanation'?correctedReadback(state,query):undefined,reviewerAttempts:result.reviewerAttempts,facts,toolAttempted:!!result.action},{headers:sessionHeaders(session,req)});
 }catch(error){return errorResponse(error);}
}
