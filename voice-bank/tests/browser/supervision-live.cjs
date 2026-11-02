// Real Omni WebRTC + real Flash. Silent synthetic microphone; no human speech or real bank.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base=process.env.BANK_TEST_URL||'http://127.0.0.1:5173';
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--autoplay-policy=no-user-gesture-required']});
 const report={status:'running',realProvider:true,syntheticSilentMicrophone:true,humanMicrophone:false,cases:[]};
 try{for(const scenario of (process.env.SUPERVISION_LIVE_SCENARIOS||'natural-query,controlled-pause').split(',')){
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();page.setDefaultTimeout(20000);
  const entry={scenario,status:'running',observerPauseInjected:scenario==='controlled-pause',requests:[],responses:[],browserErrors:[]};report.cases.push(entry);let lastReview;
  page.on('pageerror',e=>entry.browserErrors.push(e.message));
  page.on('request',r=>{if(r.method()==='POST'&&/\/api\/bank(?:\/(?:supervise|review))?$/.test(new URL(r.url()).pathname)){const b=r.postDataJSON();entry.requests.push({at:Date.now(),path:new URL(r.url()).pathname,checkpoint:b.review?.checkpoint,reason:b.review?.reason,tracking:b.review?.tracking?{checkedThrough:b.review.tracking.checkedThrough,through:b.review.tracking.through,latest:b.review.tracking.latest,events:b.review.tracking.events.length,openIssues:b.review.tracking.openIssues.length}:undefined,tool:b.tool?{name:b.tool.name,operation:b.tool.arguments?.operation}:undefined});}});
  page.on('request',r=>{if(r.url().endsWith('/api/bank/supervise'))lastReview=r.postDataJSON().review;});
  page.on('response',async r=>{if(r.request().method()==='POST'&&/\/api\/bank\/(?:supervise|review)$/.test(new URL(r.url()).pathname)){try{const b=await r.json();entry.responses.push({at:Date.now(),path:new URL(r.url()).pathname,status:r.status(),decision:b.decision,stale:b.stale,unavailable:b.unavailable,unavailableReason:b.unavailableReason,message:b.message});}catch{}}});
  await page.addInitScript(()=>{
   const t=window.__liveSupervision={events:[],sent:[],errors:[],peers:[],tracks:[],contexts:[],audios:[],firstAudioAt:0,cuePlays:0,cueEnded:0,active:false};
   const Audio=window.Audio;window.Audio=function(src){const a=new Audio(src);t.audios.push(a);if(src?.includes('/audio/recheck.wav')){a.addEventListener('play',()=>t.cuePlays++);a.addEventListener('ended',()=>t.cueEnded++);}return a;};window.Audio.prototype=Audio.prototype;
   const observe=ch=>{const send=ch.send.bind(ch);ch.send=data=>{try{const e=JSON.parse(data);t.sent.push({at:Date.now(),type:e.type});}catch{}send(data);};ch.addEventListener('message',m=>{try{const e=JSON.parse(m.data);t.events.push({at:Date.now(),type:e.type,id:e.response?.id||e.response_id,status:e.response?.status,text:e.type==='response.audio_transcript.done'?e.transcript:undefined});if(e.type==='response.created')t.active=true;if(e.type==='response.done')t.active=false;if(e.type==='error')t.errors.push({type:e.error?.type,code:e.error?.code,message:e.error?.message});}catch{}});};
   const RTC=window.RTCPeerConnection;window.RTCPeerConnection=class extends RTC{constructor(...args){super(...args);t.peers.push(this);this.addEventListener('datachannel',e=>observe(e.channel));this.addEventListener('track',e=>{const c=new AudioContext();t.contexts.push(c);void c.resume();const a=c.createAnalyser();a.fftSize=256;c.createMediaStreamSource(e.streams[0]||new MediaStream([e.track])).connect(a);const values=new Uint8Array(256);const sample=()=>{if(this.connectionState==='closed')return;a.getByteTimeDomainData(values);const peak=Math.max(...values.map(x=>Math.abs(x-128)));if(peak>3&&t.audios.some(a=>a.srcObject&&!a.muted)&&!t.firstAudioAt)t.firstAudioAt=Date.now();requestAnimationFrame(sample);};sample();});}createDataChannel(...args){const ch=super.createDataChannel(...args);observe(ch);return ch;}};
   navigator.mediaDevices.getUserMedia=async()=>{const c=new AudioContext();t.contexts.push(c);await c.resume();const d=c.createMediaStreamDestination(),s=c.createConstantSource();s.offset.value=0;s.connect(d);s.start();t.tracks.push(...d.stream.getTracks());return d.stream;};
  });
  if(scenario==='controlled-pause'){
   let injected=false;await page.route('**/api/bank/supervise',async r=>{const b=r.request().postDataJSON();if(!injected&&b.review.checkpoint==='speaking'){injected=true;entry.injectedAt=Date.now();await r.fulfill({json:{decision:'pause',message:'受控测试：请重新核对刚才的解释。',evidence:'controlled test injection; not a naturally detected error',revision:b.revision}});}else await r.continue();});
  }
  try{
   await page.goto(base,{waitUntil:'networkidle'});const before=(await(await page.request.get(base+'/api/bank')).json()).state;
   await page.getByRole('button',{name:'开始语音对话',exact:true}).click();await page.getByRole('button',{name:'关闭麦克风',exact:true}).waitFor({timeout:55000});
   const text=scenario==='natural-query'?'查一下我的日常账户和储蓄账户分别还有多少余额。':'请用三四句话解释活期存款和定期存款的区别，只解释，不查询或办理业务。';
   await page.getByLabel('输入你的要求',{exact:true}).fill(text);entry.inputAt=Date.now();await page.getByRole('button',{name:'发送',exact:true}).click();
   if(scenario==='controlled-pause'){
    await page.waitForFunction(()=>window.__liveSupervision.cueEnded===1,null,{timeout:60000});
    await page.waitForFunction(()=>window.__liveSupervision.events.filter(e=>e.type==='response.created').length>=2&&!window.__liveSupervision.active&&window.__liveSupervision.events.filter(e=>e.type==='response.done'&&e.status==='completed').length>=1,null,{timeout:60000});
   }else await page.waitForFunction(()=>window.__liveSupervision.events.some(e=>e.type==='response.audio_transcript.done')&&!window.__liveSupervision.active,null,{timeout:60000});
   await page.waitForTimeout(8500);
   entry.transport=await page.evaluate(()=>({events:window.__liveSupervision.events,sent:window.__liveSupervision.sent,errors:window.__liveSupervision.errors,firstAudioAt:window.__liveSupervision.firstAudioAt,cuePlays:window.__liveSupervision.cuePlays,cueEnded:window.__liveSupervision.cueEnded,peers:window.__liveSupervision.peers.length,connection:window.__liveSupervision.peers.at(-1).connectionState}));
   entry.supervision=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('zx_voice_diagnostics')||'[]').findLast(d=>d.reason==='supervision_result')?.supervision);
   assert.ok(entry.supervision,'continuous observer must report its examined watermark');assert.equal(entry.supervision.pendingEvents,0,'the completed turn must finish examination rather than silently leave events queued');assert.equal(entry.supervision.checkedThrough,entry.supervision.latest);
   const after=(await(await page.request.get(base+'/api/bank')).json()).state;
   assert.deepEqual(entry.transport.errors,[]);assert.deepEqual(entry.browserErrors,[]);assert.equal(entry.transport.connection,'connected');assert.equal(entry.transport.peers,1);assert.deepEqual(after.accounts,before.accounts);assert.deepEqual(after.receipts,before.receipts);assert.deepEqual(after.workflows?.records,before.workflows?.records);
   if(scenario!=='controlled-pause'){
    assert.equal(entry.transport.cuePlays,0);assert.equal(entry.requests.filter(r=>r.path==='/api/bank/review').length,0);assert.ok(entry.transport.firstAudioAt>0);
    const checked=entry.responses.find(r=>r.path==='/api/bank/supervise');assert.ok(checked);assert.ok(entry.transport.firstAudioAt<checked.at,'real audio must begin before Flash finishes');
   }else{assert.equal(entry.transport.cuePlays,1);assert.equal(entry.transport.cueEnded,1);assert.equal(entry.requests.filter(r=>r.path==='/api/bank/review').length,1);assert.ok(entry.transport.sent.some(e=>e.type==='response.cancel'));assert.equal(after.revision,before.revision);}
   entry.status='passed';await page.screenshot({path:`outputs/supervision-live-${scenario}.png`});
  }catch(error){entry.status='failed';entry.failure=error.stack;entry.lastReview=lastReview;entry.transport=await page.evaluate(()=>({events:window.__liveSupervision?.events,sent:window.__liveSupervision?.sent,errors:window.__liveSupervision?.errors,cuePlays:window.__liveSupervision?.cuePlays,diagnostics:JSON.parse(sessionStorage.getItem('zx_voice_diagnostics')||'[]')})).catch(()=>null);process.exitCode=1;}
  finally{await page.getByRole('button',{name:'结束语音',exact:true}).click().catch(()=>{});await page.evaluate(()=>Promise.all(window.__liveSupervision?.contexts.map(c=>c.close())||[])).catch(()=>{});await context.close();fs.mkdirSync('outputs',{recursive:true});fs.writeFileSync('outputs/supervision-live.json',JSON.stringify(report,null,2));console.log(JSON.stringify({scenario,status:entry.status,failure:entry.failure}));}
 }}finally{report.status=report.cases.every(c=>c.status==='passed')?'passed':'failed';fs.writeFileSync('outputs/supervision-live.json',JSON.stringify(report,null,2));await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
