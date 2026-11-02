/** Hold native WebRTC audio until the corresponding transcript passes review. */
export class VerifiedAudio{
 private stream:MediaStream|null=null;private epoch=0;
 private entries=new Map<string,{recorder:MediaRecorder;chunks:Blob[];ready:Promise<Blob|null>;resolve:(blob:Blob|null)=>void;timer?:ReturnType<typeof setTimeout>}>();
 private audio:HTMLAudioElement|null=null;private url:string|null=null;
 private isPlaying=false;
 constructor(private error:(message:string)=>void,private playing:(value:boolean)=>void,private ended?:()=>void){}
 setStream(stream:MediaStream){this.stream=stream;}
 start(id:string){
  if(!this.stream||!id||this.entries.has(id))return;
  // Only one native response may be recording; completed recordings await their verdict.
  for(const [key,entry]of this.entries)if(entry.recorder.state==='recording')this.discard(key);
  if(typeof MediaRecorder==='undefined')return;
  try{
   const mime=MediaRecorder.isTypeSupported('audio/webm;codecs=opus')?'audio/webm;codecs=opus':undefined;
   const recorder=new MediaRecorder(this.stream,mime?{mimeType:mime}:undefined),chunks:Blob[]=[];
   let resolve!:(blob:Blob|null)=>void;const ready=new Promise<Blob|null>(done=>resolve=done);
   this.entries.set(id,{recorder,chunks,ready,resolve});
   recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
   recorder.onstop=()=>resolve(chunks.length?new Blob(chunks,{type:recorder.mimeType}):null);
   recorder.onerror=()=>resolve(null);recorder.start();
  }catch{this.error('声音暂时无法缓存，核实后的文字结果仍会显示。');}
 }
 finish(id:string){const entry=this.entries.get(id);if(entry&&entry.recorder.state==='recording')entry.timer=setTimeout(()=>{if(entry.recorder.state==='recording')entry.recorder.stop();},180);}
 discard(id:string){const entry=this.entries.get(id);if(!entry)return;clearTimeout(entry.timer);entry.resolve(null);if(entry.recorder.state==='recording')entry.recorder.stop();this.entries.delete(id);}
 async play(id:string){
  const entry=this.entries.get(id),epoch=this.epoch;if(!entry){this.error('已显示核实结果，当前浏览器无法播放缓存语音。');return;}
  const blob=await entry.ready;if(epoch!==this.epoch||this.entries.get(id)!==entry)return;
  this.entries.delete(id);if(!blob?.size)return;
  this.stopPlayback();this.url=URL.createObjectURL(blob);const audio=this.audio=new Audio(this.url);
  audio.onended=()=>{if(this.audio===audio){this.stopPlayback();this.ended?.();}};audio.onerror=()=>{if(this.audio===audio){this.stopPlayback();this.error('已显示核实结果，语音播放失败。');}};
  try{await audio.play();if(epoch===this.epoch&&this.audio===audio){this.isPlaying=true;this.playing(true);}}catch{if(this.audio===audio){this.stopPlayback();this.error('已显示核实结果，请点击页面后重试声音。');}}
 }
 private stopPlayback(){if(this.audio){this.audio.pause();this.audio.src='';this.audio=null;}if(this.url)URL.revokeObjectURL(this.url);this.url=null;if(this.isPlaying){this.isPlaying=false;this.playing(false);}}
 interrupt(){this.epoch++;for(const id of this.entries.keys())this.discard(id);this.stopPlayback();}
 stop(){this.interrupt();this.stream=null;}
}
