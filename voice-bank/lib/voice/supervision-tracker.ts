import {z} from 'zod';

const event=z.object({
 id:z.number().int().positive(),at:z.number().nonnegative(),turnId:z.string().max(200),responseId:z.string().max(200).optional(),
 kind:z.enum(['user','assistant','reply_complete','tool_started','tool_result','tool_error','state','reconciliation']),text:z.string().max(1200),
}).strict();
const issue=z.object({id:z.number().int().positive(),through:z.number().int().nonnegative(),turnId:z.string().max(200),responseId:z.string().max(200),kind:z.enum(['pending','problem']),message:z.string().max(600),evidence:z.string().max(600)}).strict();
export const pendingSupervisionCheck=z.object({eventId:z.number().int().positive(),message:z.string().min(1).max(240),quote:z.string().min(2).max(300)}).strict();
export const observationResolution=z.object({issueId:z.number().int().positive(),eventId:z.number().int().positive(),quote:z.string().min(2).max(300)}).strict();
export const supervisionTracking=z.object({checkedThrough:z.number().int().nonnegative(),through:z.number().int().nonnegative(),latest:z.number().int().nonnegative(),events:z.array(event).max(20),contextEvents:z.array(event).max(16).optional(),openIssues:z.array(issue).max(8)}).strict();
export type SupervisionTracking=z.infer<typeof supervisionTracking>;
export type SupervisionResolution=z.infer<typeof observationResolution>;
type Event=z.infer<typeof event>;
type Issue=z.infer<typeof issue>;
export type TrackedVerdict={decision:'continue'|'pause';message?:string;evidence?:string;unavailable?:boolean;unavailableReason?:string;stale?:boolean;examinationIncomplete?:boolean;validationWarning?:string;resolutions?:SupervisionResolution[];pendingChecks?:z.infer<typeof pendingSupervisionCheck>[]};

/** Application-owned memory. A newer snapshot never deletes unexamined events or open concerns. */
export class SupervisionTracker{
 private sequence=0;private checked=0;private issueId=0;
 private events:Event[]=[];private context:Event[]=[];private issues:Issue[]=[];private overflow=false;
 constructor(private now=Date.now){}
 clear(){this.sequence=0;this.checked=0;this.issueId=0;this.events=[];this.context=[];this.issues=[];this.overflow=false;}
 record(kind:Event['kind'],turnId:string,text:string,responseId?:string){
  // Never silently evict unexamined events. The caller must stop/degrade on overflow.
  if(this.events.length>=128){this.overflow=true;return false;}
  this.events.push({id:++this.sequence,at:this.now(),kind,turnId:turnId.slice(0,200),text:text.slice(0,1200),...(responseId?{responseId:responseId.slice(0,200)}:{})});return true;
 }
 snapshot(turnId?:string):SupervisionTracking{
  const events:Event[]=[];let bytes=0;
  for(const entry of this.events){const size=new TextEncoder().encode(JSON.stringify(entry)).length;if(events.length>=20||bytes+size>7000)break;events.push({...entry});bytes+=size;}
  const contextEvents:Event[]=[];let contextBytes=0;
  for(const entry of [...this.context].reverse()){
   if(turnId&&entry.turnId!==turnId&&!this.issues.some(issue=>issue.turnId===entry.turnId))continue;
   const size=new TextEncoder().encode(JSON.stringify(entry)).length;if(contextBytes+size>4000)continue;contextEvents.unshift({...entry});contextBytes+=size;
  }
  return {checkedThrough:this.checked,through:events.at(-1)?.id??this.checked,latest:this.sequence,events,contextEvents,openIssues:this.issues.map(entry=>({...entry}))};
 }
 settle(snapshot:SupervisionTracking,turnId:string,responseId:string,result:TrackedVerdict){
  // Even a stale pause is retained for revalidation, never treated as current authority.
  if(result.decision==='pause'&&result.message?.trim()&&result.evidence?.trim()){
   const previous=this.issues.find(entry=>entry.turnId===turnId&&entry.responseId===responseId&&entry.evidence===result.evidence);
   if(!previous){if(this.issues.length>=8)this.overflow=true;else this.issues.push({id:++this.issueId,through:snapshot.latest,turnId,responseId,kind:'problem',message:result.message.slice(0,600),evidence:result.evidence.slice(0,600)});}
  }
  if(result.unavailable||result.stale||result.examinationIncomplete)return;
  for(const pending of result.pendingChecks||[]){
   const source=[...(snapshot.contextEvents||[]),...snapshot.events].find(entry=>entry.id===pending.eventId&&entry.kind==='user'&&entry.text.includes(pending.quote));
   if(!source||this.issues.some(entry=>entry.kind==='pending'&&entry.through===source.id&&entry.message===pending.message&&entry.evidence===pending.quote))continue;
   if(this.issues.length>=8){this.overflow=true;break;}
   this.issues.push({id:++this.issueId,through:source.id,turnId:source.turnId,responseId:source.responseId||'',kind:'pending',message:pending.message,evidence:pending.quote});
  }
  // A 'continue' alone cannot close a concern. Require a quoted, later user/tool/state event.
  for(const resolution of result.resolutions||[]){
   const concern=this.issues.find(entry=>entry.id===resolution.issueId);
   const proof=[...(snapshot.contextEvents||[]),...snapshot.events].find(entry=>entry.id===resolution.eventId);
   if(concern&&proof&&proof.id>concern.through&&['user','tool_result','state'].includes(proof.kind)&&resolution.quote.length>=2&&proof.text.includes(resolution.quote))this.issues=this.issues.filter(entry=>entry.id!==concern.id);
  }
  if(snapshot.checkedThrough!==this.checked||snapshot.through>this.sequence)return;
  this.checked=snapshot.through;
  this.context=[...this.context,...this.events.filter(entry=>entry.id<=this.checked&&['user','tool_result','tool_error','state'].includes(entry.kind))].slice(-16);
  this.events=this.events.filter(entry=>entry.id>this.checked);
 }
 status(){return {checkedThrough:this.checked,latest:this.sequence,pendingEvents:this.events.length,openIssues:this.issues.length,oldestUncheckedMs:this.events.length?Math.max(0,this.now()-this.events[0].at):0,overflow:this.overflow};}
 /** A fresh content review disproved this exact suspicion. Pending requests,
  * later concerns and other turns remain intact; no operation is authorized. */
 dismissRevalidated(snapshot:SupervisionTracking,turnId:string,evidence:string){
  const ids=new Set(snapshot.openIssues.filter(issue=>issue.kind==='problem'&&issue.turnId===turnId&&issue.evidence===evidence).map(issue=>issue.id));
  this.issues=this.issues.filter(issue=>!ids.has(issue.id));
 }
}
