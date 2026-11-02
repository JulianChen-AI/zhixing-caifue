// Record the configured Omni voice through the existing SDP proxy; no keys enter the browser.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base=process.env.BANK_TEST_URL||'http://127.0.0.1:5173';
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--autoplay-policy=no-user-gesture-required']});
 try{
  const page=await browser.newPage();await page.goto(base,{waitUntil:'domcontentloaded'});
  const result=await page.evaluate(async()=>{
   const text='稍等，我再核对一下刚才的信息。',pc=new RTCPeerConnection(),context=new AudioContext(),playback=new Audio();await context.resume();playback.autoplay=true;playback.muted=true;
   const dest=context.createMediaStreamDestination(),silence=context.createConstantSource();silence.offset.value=0;silence.connect(dest);silence.start();pc.addTrack(dest.stream.getAudioTracks()[0],dest.stream);
   let channel=pc.createDataChannel('oai-events');const channels=[channel],events=[];let recorder,parts=[],transcript='',resolve,reject,updated=false,created=false,configured=false,voice='Tina';
   const ready=new Promise((yes,no)=>{resolve=yes;reject=no;});const timeout=setTimeout(()=>reject(new Error('cue_recording_timeout '+pc.connectionState+' '+events.join(','))),60000);
   const configure=()=>{if(!configured&&created&&channel.readyState==='open'){configured=true;channel.send(JSON.stringify({type:'session.update',session:{modalities:['text','audio'],audio:{output:{voice}},tools:[],instructions:'请只逐字读出“'+text+'”，不要增删内容，不要音效或其他话。'}}));}};
   channel.onopen=configure;
   pc.ontrack=e=>{const remote=e.streams[0]||new MediaStream([e.track]);playback.srcObject=remote;void playback.play();const recording=context.createMediaStreamDestination();context.createMediaStreamSource(remote).connect(recording);recorder=new MediaRecorder(recording.stream,{mimeType:'audio/webm;codecs=opus'});recorder.ondataavailable=e=>{if(e.data.size)parts.push(e.data);};recorder.onstop=async()=>{const blob=new Blob(parts,{type:recorder.mimeType}),buffer=new Uint8Array(await blob.arrayBuffer());let binary='';for(const byte of buffer)binary+=String.fromCharCode(byte);const stats=[...(await pc.getStats()).values()].filter(s=>s.type==='inbound-rtp').map(s=>({kind:s.kind,bytesReceived:s.bytesReceived,packetsReceived:s.packetsReceived}));resolve({base64:btoa(binary),transcript,bytes:blob.size,voice,stats,events});};};
   const message=({data})=>{const e=JSON.parse(data);events.push(e.type);if(e.type==='error'){reject(new Error(e.error?.message||'provider_error'));return;}if(e.type==='session.created'){created=true;configure();}if(e.type==='session.updated'&&!updated){updated=true;channel.send(JSON.stringify({type:'conversation.item.create',item:{type:'message',role:'user',content:[{type:'input_text',text:'请读出：'+text}]}}));channel.send(JSON.stringify({type:'response.create'}));}if(e.type==='response.created'&&recorder?.state==='inactive')recorder.start();if(e.type==='response.audio_transcript.delta')transcript+=String(e.delta||'');if(e.type==='response.audio_transcript.done'&&e.transcript)transcript=e.transcript;if(e.type==='response.done'){if(e.response?.status==='failed')reject(new Error('provider_response_failed'));else setTimeout(()=>{if(recorder?.state==='recording')recorder.stop();else reject(new Error('no_native_audio'));},1800);}};
   channel.onmessage=message;pc.ondatachannel=e=>{channel=e.channel;channels.push(channel);channel.onmessage=message;channel.onopen=configure;configure();};
   try{
    await pc.setLocalDescription(await pc.createOffer());
    if(pc.iceGatheringState!=='complete')await new Promise(resolve=>{const timer=setTimeout(resolve,2000);pc.addEventListener('icegatheringstatechange',()=>{if(pc.iceGatheringState==='complete'){clearTimeout(timer);resolve();}});});
    const response=await fetch('/api/live/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sdp:pc.localDescription.sdp})});const answer=await response.json();if(!response.ok)throw new Error(answer.error);voice=answer.voice||voice;await pc.setRemoteDescription({type:'answer',sdp:answer.sdp});return await ready;
   }finally{clearTimeout(timeout);playback.pause();playback.srcObject=null;channels.forEach(ch=>ch.close());pc.close();dest.stream.getTracks().forEach(t=>t.stop());await context.close();}
  });
  if(!result.transcript.replace(/[\s，。！？,.!?]/g,'').includes('稍等我再核对一下刚才的信息'))throw new Error('Recorded transcript does not match cue');
  if(result.bytes<1000)throw new Error('No usable audio '+JSON.stringify({bytes:result.bytes,stats:result.stats,events:result.events}));
  const raw=path.resolve('work/correction-cue.webm'),output=path.resolve('public/audio/recheck.wav');fs.mkdirSync(path.dirname(raw),{recursive:true});fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(raw,Buffer.from(result.base64,'base64'));
  execFileSync(process.env.FFMPEG_PATH||'ffmpeg',['-hide_banner','-loglevel','error','-y','-i',raw,'-af','silenceremove=start_periods=1:start_duration=0.03:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_duration=0.03:start_threshold=-45dB,areverse,apad=pad_dur=0.12','-ar','24000','-ac','1','-c:a','pcm_s16le',output]);
  console.log(JSON.stringify({output,transcript:result.transcript,bytes:fs.statSync(output).size,voice:result.voice}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
