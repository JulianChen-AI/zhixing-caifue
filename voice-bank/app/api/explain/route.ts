import {z} from 'zod';
import {checkOrigin,loadSession,sessionHeaders,provider,errorResponse} from '@/lib/bank/server';
import {BankError} from '@/lib/bank/engine';
import {canExplain,explainCard} from '@/lib/ai/explain';

const schema=z.object({functionId:z.string().max(16),value:z.unknown()}).strict();
/** Read-only: explains a card the user is looking at. Nothing here changes the session or starts a business. */
export async function POST(req:Request){
 try{
  checkOrigin(req);
  const raw=await req.text();if(raw.length>16000)throw new BankError('卡片内容太长，暂时讲不了。',413);
  const body=schema.parse(JSON.parse(raw)),session=await loadSession(req),headers=sessionHeaders(session,req);
  if(!canExplain(body.functionId))throw new BankError('这张卡片暂不支持讲解。',400);
  const p=provider();if(!p.ready)throw new BankError('讲解暂时不可用。',503);
  const text=await explainCard(body.functionId,body.value,p,req.signal);
  return Response.json(text?{text}:{text:null,message:'这次没讲好，换个时间再试。'},{headers});
 }catch(error){return errorResponse(error);}
}
