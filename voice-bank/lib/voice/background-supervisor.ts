import type {TrackedVerdict} from './supervision-tracker.ts';
/** One request at a time. Pending work is a factory, evaluated immediately before submission. */
export class BackgroundSupervisor<T>{
 private controller:AbortController|null=null;
 private queued:(()=>T|undefined)|undefined;
 private version=0;
 constructor(private observe:(input:T,signal:AbortSignal)=>Promise<TrackedVerdict>,private pause:(input:T,result:TrackedVerdict)=>void,private unavailable:()=>void=()=>{},private settled:(input:T,result:TrackedVerdict,elapsedMs:number)=>void=()=>{}){}
 check(input:T){this.checkLatest(()=>input);}
 checkLatest(snapshot:()=>T|undefined){this.queued=snapshot;this.drain();}
 reset(){this.version++;this.controller?.abort();this.controller=null;this.queued=undefined;}
 private drain(){
  if(this.controller||this.queued===undefined)return;
  const snapshot=this.queued;this.queued=undefined;const input=snapshot();if(input===undefined)return;
  const controller=this.controller=new AbortController(),version=this.version,started=Date.now();
  void this.observe(input,controller.signal).then(result=>{
   if(controller.signal.aborted||version!==this.version)return;
   this.settled(input,result,Date.now()-started);
   if(result.unavailable)this.unavailable();
   // New words are not evidence that an earlier false claim has been resolved.
   // pause() re-reads facts before any repair; stale state/turns remain fenced.
   if(result.decision==='pause'&&!result.stale&&!result.unavailable){this.reset();this.pause(input,result);}
  }).catch(()=>{if(!controller.signal.aborted&&version===this.version){this.settled(input,{decision:'continue',unavailable:true},Date.now()-started);this.unavailable();}}).finally(()=>{
   if(this.controller!==controller)return;
   this.controller=null;this.drain();
  });
 }
}
