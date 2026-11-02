// Exercise real page, media playback and HTTP wiring with a controlled provider.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base=process.env.BANK_TEST_URL||'http://127.0.0.1:5173';
const sentence='日常账户的余额是两千六百元，储蓄账户的余额是一万两千元，这些是刚刚查询得到的结果。';
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--autoplay-policy=no-user-gesture-required']});
 const report={status:'running',realProvider:false,humanMicrophone:false,checks:[],browserErrors:[]};
 async function setup(microphone=true){
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>report.browserErrors.push(e.message));
  await page.route('**/api/live/session',r=>r.fulfill({status:201,json:{sdp:'v=0\r\n',voice:'Tina'}}));
  await page.addInitScript(()=>{
   const t=window.__supervision={sent:[],audios:[],cueAudios:[],recorders:0,cuePlays:0,cueEnded:0,cueErrors:0,replies:0,microphoneRequests:0,tracks:[],contexts:[],peers:[]};
   const Audio=window.Audio;window.Audio=function(src){const a=new Audio(src);t.audios.push(a);if(src?.includes('/audio/recheck.wav')){t.cueAudios.push(a);a.addEventListener('play',()=>t.cuePlays++);a.addEventListener('ended',()=>t.cueEnded++);a.addEventListener('error',()=>t.cueErrors++);}return a;};window.Audio.prototype=Audio.prototype;
   const Recorder=window.MediaRecorder;window.MediaRecorder=class extends Recorder{constructor(...args){super(...args);t.recorders++;}};
   navigator.mediaDevices.getUserMedia=async()=>{t.microphoneRequests++;const c=new AudioContext();t.contexts.push(c);await c.resume();const s=c.createMediaStreamDestination().stream;t.tracks.push(...s.getTracks());return s;};
   class Channel{
    readyState='open';emit(e){this.onmessage?.({data:JSON.stringify(e)});}
    send(s){const e=JSON.parse(s);t.sent.push(e);if(e.type==='session.update')queueMicrotask(()=>this.emit({type:'session.updated'}));if(e.type==='response.create'){t.replies++;queueMicrotask(()=>this.emit({type:'response.created',response:{id:'r'+t.replies}}));}if(e.type==='response.cancel')queueMicrotask(()=>this.emit({type:'response.done',response:{id:'r'+t.replies,status:'cancelled'}}));}
    close(){this.readyState='closed';this.onclose?.();}
   }
   window.RTCPeerConnection=class{
    connectionState='new';iceGatheringState='complete';constructor(){t.peers.push(this);}addTransceiver(){return{sender:{replaceTrack:async()=>{}}};}createDataChannel(){const ch=this.channel=new Channel();t.emit=e=>ch.emit(e);return ch;}
    async createOffer(){return{type:'offer',sdp:'v=0\r\n'};}async setLocalDescription(d){this.localDescription=d;}
    async setRemoteDescription(){this.connectionState='connected';this.onconnectionstatechange?.();const c=new AudioContext();t.contexts.push(c);await c.resume();const d=c.createMediaStreamDestination(),o=c.createOscillator(),g=c.createGain();g.gain.value=0;o.connect(g).connect(d);o.start();t.gain=g;t.tracks.push(...d.stream.getTracks());this.ontrack?.({track:d.stream.getAudioTracks()[0],streams:[d.stream]});this.channel.emit({type:'session.created'});}
    close(){this.connectionState='closed';}
   };
  });
  await page.goto(base,{waitUntil:'networkidle'});await page.getByRole('button',{name:microphone?'开始语音对话':'语音',exact:true}).click();await page.getByRole('button',{name:microphone?'关闭麦克风':'开启麦克风',exact:true}).waitFor();
  const send=async text=>{await page.getByLabel('输入你的要求',{exact:true}).fill(text);await page.getByRole('button',{name:'发送',exact:true}).click();await page.waitForFunction(()=>window.__supervision.replies>0);};
  const say=async(text=sentence)=>page.evaluate(text=>{const t=window.__supervision;t.gain.gain.value=0.03;t.emit({type:'response.audio_transcript.delta',response_id:'r'+t.replies,item_id:'m'+t.replies,delta:text});},text);
  const finish=async(text=sentence)=>page.evaluate(text=>{const t=window.__supervision;t.gain.gain.value=0;t.emit({type:'response.done',response:{id:'r'+t.replies,status:'completed',output:[{type:'message',content:[{type:'audio',transcript:text}]}]}});},text);
  const release=async()=>{await page.getByRole('button',{name:'结束语音',exact:true}).click().catch(()=>{});await page.evaluate(()=>Promise.all(window.__supervision.contexts.map(c=>c.close())));await context.close();};
  return {page,send,say,finish,release};
 }
 try{
  let h=await setup();try{
   let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);let reconciles=0;
   await h.page.route('**/api/bank/supervise',async r=>{entered();await gate;await r.fulfill({json:{decision:'continue',message:'',evidence:''}}).catch(()=>{});});
   h.page.on('request',r=>{if(r.url().endsWith('/api/bank/review'))reconciles++;});
   await h.send('查询我的账户余额');await h.say();await started;
   assert.equal(await h.page.evaluate(()=>window.__supervision.audios.find(a=>a.srcObject)?.muted),false);
   assert.equal(await h.page.evaluate(()=>window.__supervision.recorders),0);assert.equal(await h.page.evaluate(()=>window.__supervision.cuePlays),0);
   await h.finish();assert.equal(reconciles,0);release();
   await h.page.screenshot({path:'outputs/background-supervision-streaming.png'});report.checks.push('mobile UI streams native audio while Flash is pending; no full recording, waiting cue or review gate');
  }finally{await h.release();}

  h=await setup();try{
   let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);let reconciles=0;
   await h.page.route('**/api/bank/supervise',r=>r.fulfill({json:reconciles||r.request().postDataJSON().review.checkpoint==='speaking'?{decision:'continue',message:'',evidence:''}:{decision:'pause',message:'播报余额与后台不符',evidence:'actual.accounts'}}));
   await h.page.route('**/api/bank/review',async r=>{reconciles++;entered();await gate;const response=await h.page.request.get(base+'/api/bank'),{state}=await response.json();await r.fulfill({json:{state,decision:'repair',repairScope:'query',facts:{revision:state.revision,accounts:state.accounts},message:'按真实余额更正'}});});
   await h.send('查询账户余额');await h.say();await h.finish();await started;
   assert.equal(await h.page.evaluate(()=>window.__supervision.audios.find(a=>a.srcObject)?.muted),true);
   await h.page.waitForFunction(()=>window.__supervision.cuePlays===1);assert.equal(reconciles,1);release();
   await h.page.waitForFunction(()=>window.__supervision.replies===2);assert.equal(await h.page.evaluate(()=>window.__supervision.audios.find(a=>a.srcObject)?.muted),false);assert.equal(await h.page.evaluate(()=>window.__supervision.cueEnded),1);assert.equal(await h.page.evaluate(()=>window.__supervision.cueErrors),0);
   const correction='刚才的余额说错了，日常账户实际余额是一万二千八百六十五元，储蓄账户是三万元。';
   await h.say(correction);await h.page.getByText(correction,{exact:true}).waitFor();await h.finish(correction);assert.equal(await h.page.evaluate(()=>window.__supervision.cuePlays),1);
   assert.equal(await h.page.evaluate(()=>window.__supervision.sent.filter(e=>e.item?.role==='user').length),1);
   await h.page.screenshot({path:'outputs/background-supervision-corrected.png'});report.checks.push('specific issue pauses audio, plays one real recording, reconciles once and streams correction without invented user input');
  }finally{await h.release();}

  h=await setup();try{
   await h.page.route('**/api/bank/supervise',r=>r.fulfill({status:503,json:{error:'observer offline'}}));
   await h.send('解释一下储蓄账户');await h.say();await h.finish();
   await h.page.waitForTimeout(150);assert.equal(await h.page.evaluate(()=>window.__supervision.audios.find(a=>a.srcObject)?.muted),false);assert.equal(await h.page.evaluate(()=>window.__supervision.cuePlays),0);report.checks.push('observer HTTP failure leaves normal streaming audio running');
  }finally{await h.release();}

  h=await setup();try{
   let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);let reconciles=0;
   await h.page.route('**/api/bank/supervise',r=>r.fulfill({json:reconciles?{decision:'continue',message:'',evidence:''}:{decision:'pause',message:'核对余额',evidence:'actual.accounts'}}));
   await h.page.route('**/api/bank/review',async r=>{reconciles++;entered();await gate;const {state}=await(await h.page.request.get(base+'/api/bank')).json();await r.fulfill({json:{state,decision:'repair',facts:{revision:state.revision},message:'late result'}}).catch(()=>{});});
   await h.send('查询账户余额');await h.say();await started;await h.page.waitForFunction(()=>window.__supervision.cuePlays===1);
   await h.send('先解释一下利息，不要办理业务');await h.page.waitForFunction(()=>window.__supervision.replies===2);
   assert.equal(await h.page.evaluate(()=>window.__supervision.cueAudios.length),1);assert.equal(await h.page.evaluate(()=>window.__supervision.cueAudios.every(a=>a.paused&&!a.hasAttribute('src'))),true);
   release();await h.page.waitForTimeout(150);assert.equal(await h.page.evaluate(()=>window.__supervision.replies),2);assert.equal(reconciles,1);report.checks.push('user input immediately stops the recording and fences late reconciliation without replaying an old answer');
  }finally{await h.release();}

  h=await setup(false);try{
   await h.page.route('**/api/bank/supervise',r=>r.fulfill({json:{decision:'continue',message:'',evidence:''}}));
   assert.equal(await h.page.evaluate(()=>window.__supervision.microphoneRequests),0);
   await h.send('只解释一下储蓄账户');await h.say();await h.finish();
   assert.equal(await h.page.evaluate(()=>window.__supervision.audios.find(a=>a.srcObject)?.muted),false);
   await h.page.getByRole('button',{name:'开启麦克风',exact:true}).click();await h.page.getByRole('button',{name:'关闭麦克风',exact:true}).waitFor();
   assert.equal(await h.page.evaluate(()=>window.__supervision.microphoneRequests),1);assert.equal(await h.page.evaluate(()=>window.__supervision.peers.length),1);assert.equal(await h.page.evaluate(()=>window.__supervision.cuePlays),0);report.checks.push('optional microphone still supports typed input and streamed speech, then opens the microphone without reconnecting');
  }finally{await h.release();}
  h=await setup();try{
   let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r),submitted=[];let active=0,peak=0;
   await h.page.route('**/api/bank/supervise',async r=>{const body=r.request().postDataJSON();submitted.push(body);peak=Math.max(peak,++active);if(submitted.length===1){entered();await gate;}try{await r.fulfill({json:{decision:'continue',message:'',evidence:''}});}finally{active--;}});
   await h.send('不对，改成300');await h.say('已把金额改成300。');await started;
   await h.say('收款人和账户保持原样');await h.page.waitForTimeout(1200);await h.say('，请核对最新卡片。');
   const latest='已把金额改成300。收款人和账户保持原样，请核对最新卡片。';await h.finish(latest);assert.equal(submitted.length,1);release();
   await h.page.waitForFunction(()=>JSON.parse(sessionStorage.getItem('zx_voice_diagnostics')||'[]').some(d=>d.reason==='supervision_result'&&d.supervision.checkedThrough>=4));
   assert.equal(peak,1);assert.equal(submitted[1].review.reply,latest);assert.equal(submitted[1].review.checkpoint,'complete');
   assert.ok(submitted[1].review.tracking.events.some(e=>e.text.includes('收款人和账户保持原样')));assert.ok(submitted[1].review.tracking.events.some(e=>e.kind==='reply_complete'));
   report.checks.push('slow Flash keeps one HTTP request active; the pending request reads the newest complete reply and unexamined critical events at submission');
  }finally{await h.release();}
  assert.deepEqual(report.browserErrors,[]);report.status='passed';
 }catch(error){report.status='failed';report.failure=error.stack;process.exitCode=1;}
 finally{fs.mkdirSync('outputs',{recursive:true});fs.writeFileSync('outputs/background-supervision-browser.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
