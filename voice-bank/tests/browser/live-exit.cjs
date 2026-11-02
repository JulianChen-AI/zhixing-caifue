// Real page/media lifecycle, simulated provider. No model requests or quota use.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base=process.env.BANK_TEST_URL||'http://127.0.0.1:5175';
const out=path.resolve('outputs','live-exit-'+new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const {initialState}=await import('../../lib/bank/engine.ts');
 const report={realProvider:false,humanMicrophone:false,cases:[]};
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{for(const scenario of ['button','pagehide','background','connecting','late-microphone','close-tab','provider-stall','cancelled-input']){
  const context=await browser.newContext(),page=await context.newPage();const entry={scenario,status:'running',errors:[]};report.cases.push(entry);
  page.on('pageerror',e=>entry.errors.push(e.message));
  page.on('console',m=>{if(m.text().startsWith('EXIT_AUDIT:'))entry.closeAudit=JSON.parse(m.text().slice(11));});
  await page.route('**/api/bank',r=>r.fulfill({json:{state:initialState(),liveConfigured:true}}));
  await page.addInitScript(({scenario})=>{
   if(scenario==='provider-stall'){const later=window.setTimeout.bind(window);window.setTimeout=(fn,ms,...args)=>later(fn,ms===30000?300:ms,...args);}
   const t=window.__exit={events:[],peers:[],tracks:[],gets:0,sessions:0,tools:0,sessionAborted:false,toolAborted:false,lateStopped:0};
   t.snapshot=()=>({events:t.events,tracksEnded:t.tracks.every(x=>x.readyState==='ended'),peersClosed:t.peers.every(x=>x.connectionState==='closed'),gets:t.gets,sessions:t.sessions,tools:t.tools,sessionAborted:t.sessionAborted,toolAborted:t.toolAborted,lateStopped:t.lateStopped});
   const native=fetch.bind(window);
   window.fetch=(input,init={})=>{
    const url=String(input),b=typeof init.body==='string'?JSON.parse(init.body):{};
    if(url.includes('/api/live/session')){
     t.sessions++;init.signal.addEventListener('abort',()=>{t.sessionAborted=true});
     if(scenario==='connecting')return new Promise((resolve,reject)=>{t.releaseSession=()=>resolve(Response.json({sdp:'v=0\r\n',voice:'Tina'},{status:201}));init.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')))});
     return Promise.resolve(Response.json({sdp:'v=0\r\n',voice:'Tina'},{status:201}));
    }
    if(url.includes('/api/bank')&&b.tool){t.tools++;return new Promise((resolve,reject)=>{t.releaseTool=()=>resolve(Response.json({state:{}}));init.signal.addEventListener('abort',()=>{t.toolAborted=true;reject(new DOMException('aborted','AbortError'))})});}
    if(url.includes('/api/bank')&&(!init.method||init.method==='GET'))t.gets++;
    return native(input,init);
   };
   navigator.mediaDevices.getUserMedia=async()=>{const ctx=t.context=new AudioContext();await ctx.resume();const stream=ctx.createMediaStreamDestination().stream;t.tracks.push(...stream.getTracks());if(scenario==='late-microphone')await new Promise(r=>{t.releaseMic=r});return stream;};
   window.RTCPeerConnection=class {
    constructor(){this.connectionState='new';this.iceGatheringState='complete';t.peers.push(this);}
    createDataChannel(){const ch=this.channel={readyState:'open',send:s=>{const e=JSON.parse(s);t.events.push(e.type);if(e.type==='session.update')queueMicrotask(()=>t.emit({type:'session.updated'}));if(e.type==='response.create')queueMicrotask(()=>t.emit({type:'response.created',response:{id:'response'}}));},close:()=>{ch.readyState='closed';t.events.push('channel.closed');ch.onclose?.();}};t.emit=e=>ch.onmessage?.({data:JSON.stringify(e)});return ch;}
    addTransceiver(){return{sender:{replaceTrack:async()=>{}}};}
    async createOffer(){return{type:'offer',sdp:'v=0\r\n'};}
    async setLocalDescription(v){this.localDescription=v;}
    async setRemoteDescription(){this.connectionState='connected';this.onconnectionstatechange?.();t.emit({type:'session.created'});t.lateMessage=this.channel.onmessage;t.lateTrack=this.ontrack;}
    close(){this.connectionState='closed';t.events.push('peer.closed');}
   };
  },{scenario});
  try{
   await page.goto(base,{waitUntil:'networkidle'});await page.getByRole('button',{name:'开始对话',exact:true}).click();
   await page.waitForFunction(s=>s==='late-microphone'?!!window.__exit.releaseMic:window.__exit.sessions===1,scenario);
   if(!['connecting','late-microphone'].includes(scenario)){
    await page.getByRole('button',{name:'键盘输入',exact:true}).click();await page.getByLabel('输入你的要求',{exact:true}).fill('查一下我的余额');await page.getByRole('button',{name:'发送',exact:true}).click();
    await page.waitForFunction(()=>window.__exit.events.includes('response.create'));
    if(scenario==='cancelled-input'){
     await page.evaluate(()=>{const emit=window.__exit.emit;emit({type:'error',error:{type:'invalid_request_error',message:'Response request cancelled by new input'}});emit({type:'input_audio_buffer.speech_started',item_id:'next'});emit({type:'input_audio_buffer.speech_stopped',item_id:'next'});emit({type:'conversation.item.input_audio_transcription.completed',item_id:'next',transcript:'查一下我的余额'});emit({type:'response.created',response:{id:'next-response'}});});
     assert.match(await page.locator('.footer-note').innerText(),/Qwen 实时语音/);assert.equal(await page.evaluate(()=>window.__exit.peers[0].connectionState),'connected');
    }
    if(scenario==='provider-stall'){
     await page.waitForFunction(()=>window.__exit.peers.every(p=>p.connectionState==='closed'));
     entry.observed=await page.evaluate(()=>window.__exit.snapshot());assert.ok(entry.observed.tracksEnded&&entry.observed.peersClosed);assert.equal(entry.observed.tools,0);
     await page.getByRole('button',{name:'对话记录',exact:true}).click();assert.match(await page.locator('body').innerText(),/模型未及时返回完整结果/);assert.deepEqual(entry.errors,[]);
     entry.status='passed';console.log(scenario+': passed');continue;
    }
    await page.evaluate(()=>window.__exit.emit({type:'response.function_call_arguments.done',name:'bank_request',call_id:'pending',arguments:'{"operation":"list_accounts"}'}));
    await page.waitForFunction(()=>window.__exit.tools===1);
   }
   const before=await page.evaluate(()=>window.__exit.gets);
   if(scenario==='close-tab'){
    // Observe the actual Chromium tab-close lifecycle, not a synthetic pagehide.
    await page.evaluate(()=>window.addEventListener('pagehide',()=>console.log('EXIT_AUDIT:'+JSON.stringify(window.__exit.snapshot()))));
    await page.close({runBeforeUnload:true});
    await new Promise(r=>setTimeout(r,300));assert.ok(entry.closeAudit,'closing tab must emit its cleanup audit');entry.observed=entry.closeAudit;
   }else{
    if(scenario==='button')await page.getByRole('button',{name:'结束对话',exact:true}).click();
    else if(scenario==='background')await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
    else await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
    await page.evaluate(()=>{const t=window.__exit;t.releaseMic?.();t.releaseSession?.();t.releaseTool?.();t.lateMessage?.({data:JSON.stringify({type:'response.created',response:{id:'late'}})});t.lateMessage?.({data:JSON.stringify({type:'response.function_call_arguments.done',name:'bank_request',call_id:'late',arguments:'{"operation":"list_accounts"}'})});t.lateTrack?.({track:{stop:()=>t.lateStopped++},streams:[]});});
    await page.waitForFunction(()=>window.__exit.tracks.every(x=>x.readyState==='ended')&&window.__exit.peers.every(x=>x.connectionState==='closed'));
    await page.waitForTimeout(250);entry.observed=await page.evaluate(()=>window.__exit.snapshot());
   }
   const o=entry.observed;assert.ok(o.tracksEnded&&o.peersClosed);assert.equal(o.gets,before,'no recovery query after exit');
   if(!['connecting','late-microphone'].includes(scenario)){assert.equal(o.tools,1);assert.equal(o.toolAborted,true);assert.ok(o.events.indexOf('response.cancel')>=0&&o.events.indexOf('response.cancel')<o.events.indexOf('channel.closed'));if(scenario!=='close-tab')assert.equal(o.lateStopped,1);}
   else if(scenario==='connecting')assert.equal(o.sessionAborted,true);else assert.equal(o.sessions,0);
   assert.deepEqual(entry.errors,[]);entry.status='passed';console.log(scenario+': passed');
  }catch(e){entry.status='failed';entry.failure=e.message;console.log(scenario+': '+e.message);}
  finally{if(!page.isClosed())await page.evaluate(()=>window.__exit?.context?.close()).catch(()=>{});await context.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));}
 }}finally{await browser.close();console.log('Report: '+path.join(out,'report.json'));if(report.cases.some(c=>c.status!=='passed'))process.exitCode=1;}
})().catch(e=>{console.error(e);process.exitCode=1});
