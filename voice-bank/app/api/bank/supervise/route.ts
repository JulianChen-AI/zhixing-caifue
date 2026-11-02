import {z} from 'zod';
import {supervisionInput,superviseReply} from '@/lib/voice/supervision';
import {checkOrigin,loadSession,sessionHeaders,provider,errorResponse} from '@/lib/bank/server';
import {BankError} from '@/lib/bank/engine';

const schema=z.object({revision:z.number().int().nonnegative(),review:supervisionInput}).strict();
export async function POST(req:Request){
 try{
  checkOrigin(req);
  const reader=req.body?.getReader();let size=0;const chunks:Uint8Array[]=[];
  if(reader)try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>64000)throw new BankError('请求过长。',413);chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const body=schema.parse(JSON.parse(new TextDecoder().decode(bytes))),session=await loadSession(req),headers=sessionHeaders(session,req);
  if(session.state.revision!==body.revision)return Response.json({decision:'continue',message:'',evidence:'',stale:true},{headers});
  const p=provider();
  const result=p.ready?await superviseReply(session.state,body.review,p,req.signal):{decision:'continue',message:'',evidence:'',unavailable:true};
  req.signal.throwIfAborted();
  const latest=await loadSession(req);
  // Retain an old concern for the next check, without treating it as a current pause.
  if(latest.state.revision!==body.revision)return Response.json({...result,stale:true,revision:latest.state.revision},{headers});
  return Response.json({...result,revision:body.revision},{headers});
 }catch(error){return errorResponse(error);}
}
