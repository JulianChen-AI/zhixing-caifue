export type VoiceDiagnostic={reason:string;ageMs:number;events:DiagnosticEvent[];budget?:unknown;phase?:unknown;transport?:unknown;supervision?:unknown};
type DiagnosticEvent={ms:number;direction:'in'|'out'|'local';type:string;responseId?:string;status?:string;inputTokens?:number;outputTokens?:number;chars?:number;bytes?:number;code?:string;elapsedMs?:number;checkedThrough?:number;submittedThrough?:number};
/** Metadata only: no transcript, arguments, output contents, credentials or banking fields. */
export class VoiceTrace{
 private events:DiagnosticEvent[]=[];
 constructor(private began=Date.now()){}
 record(direction:DiagnosticEvent['direction'],e:Record<string,any>){
  if(!['session.created','session.update','session.updated','response.create','response.created','response.done','response.cancel','conversation.item.create','conversation.item.created','error','tool_started','tool_finished','send_failed','final_snapshot_restored','supervision_started','supervision_result','supervision_pause'].includes(e.type))return;
  const message=String(e.error?.message||'');
  const code=e.error? /Receive batching backend response failed/.test(message)?'provider_batching_failure':/context|token.*limit|too.*long/i.test(message)?'provider_context_error':String(e.error.code||e.error.type||'provider_error').slice(0,80):undefined;
  this.events.push({ms:Date.now()-this.began,direction,type:e.type,responseId:e.response?.id||e.response_id,status:e.response?.status||e.status,inputTokens:e.response?.usage?.input_tokens,outputTokens:e.response?.usage?.output_tokens,chars:e.chars??(e.item?.output?.length||e.session?.instructions?.length),bytes:e.bytes,code:code||e.code,elapsedMs:e.elapsedMs,checkedThrough:e.checkedThrough,submittedThrough:e.submittedThrough});
  this.events=this.events.slice(-80);
 }
 snapshot(reason:string,budget?:unknown):VoiceDiagnostic{return {reason,ageMs:Date.now()-this.began,events:structuredClone(this.events),budget};}
}
