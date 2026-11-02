export const CORRECTION_CUE='稍等，我再核对一下刚才的信息。';
/** A short, interruptible recording, used only when a concrete issue pauses speech. */
export class CorrectionCue{
 private audio:HTMLAudioElement|null=null;
 private finish:(()=>void)|undefined;
 async play(){
  this.stop();
  const audio=this.audio=new Audio('/audio/recheck.wav');
  audio.setAttribute('playsinline','');
  await new Promise<void>(resolve=>{
   const stop=()=>{if(this.audio===audio)this.stop();};
   const timer=setTimeout(stop,6000);
   this.finish=()=>{clearTimeout(timer);resolve();};
   audio.onended=audio.onerror=stop;
   void audio.play().catch(stop);
  });
 }
 stop(){const audio=this.audio;this.audio=null;if(audio){audio.onended=null;audio.onerror=null;audio.pause();audio.removeAttribute('src');audio.load();}const finish=this.finish;this.finish=undefined;finish?.();}
}
