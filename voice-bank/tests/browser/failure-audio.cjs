// Real page and audio element, simulated provider. No external model calls.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base=process.env.BANK_TEST_URL||'http://127.0.0.1:5177';
const reportPath=process.env.BANK_TEST_REPORT||'outputs/failure-audio-validation.json';
(async()=>{
 const {initialState}=await import('../../lib/bank/engine.ts');
 const report={realProvider:false,humanListeningTested:false,checks:[],errors:[]};
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
 try{for(const stall of [false,true]){
  const context=await browser.newContext(),page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  await page.route('**/api/bank',r=>r.fulfill({json:{state:initialState(),liveConfigured:true}}));
  await page.addInitScript(({stall})=>{
   const t=window.__failureAudio={sent:[],peers:[],tracks:[],audios:[],tools:0};
   if(stall){const later=setTimeout.bind(window);window.setTimeout=(fn,ms,...args)=>later(fn,ms===30000?600:ms,...args);}
   const AudioConstructor=window.Audio;window.Audio=new Proxy(AudioConstructor,{construct(target,args){const a=new target(...args);t.audios.push(a);return a;}});
   navigator.mediaDevices.getUserMedia=async()=>{const ctx=t.context=new AudioContext();await ctx.resume();const stream=ctx.createMediaStreamDestination().stream;t.tracks.push(...stream.getTracks());return stream;};
   const nativeFetch=fetch.bind(window);window.fetch=(input,init={})=>{
    const url=String(input),b=typeof init.body==='string'?JSON.parse(init.body):{};
    if(url.includes('/api/live/session'))return Promise.resolve(Response.json({sdp:'v=0\r\n',voice:'Tina'},{status:201}));
    if(url.includes('/api/bank')&&b.tool){t.tools++;return new Promise(resolve=>{t.finishTool=()=>resolve(nativeFetch(input,init));});}
    return nativeFetch(input,init);
   };
   window.RTCPeerConnection=class{
    connectionState='new';iceGatheringState='complete';constructor(){t.peers.push(this);}
    createDataChannel(){const ch=this.channel={readyState:'open',send:raw=>{const e=JSON.parse(raw);t.sent.push(e);if(e.type==='session.update')queueMicrotask(()=>t.emit({type:'session.updated'}));},close(){ch.readyState='closed';}};t.emit=e=>ch.onmessage?.({data:JSON.stringify(e)});return ch;}
    addTransceiver(){return{sender:{replaceTrack:async()=>{}}};}async createOffer(){return{type:'offer',sdp:'v=0\r\n'};}
    async setLocalDescription(d){this.localDescription=d;}async setRemoteDescription(){this.connectionState='connected';this.onconnectionstatechange?.();t.emit({type:'session.created'});}close(){this.connectionState='closed';}
   };
  },{stall});
  try{
   await page.goto(base,{waitUntil:'networkidle'});await page.getByRole('button',{name:'开始对话',exact:true}).click();await page.getByRole('button',{name:'静音',exact:true}).waitFor();
   await page.getByRole('button',{name:'键盘输入',exact:true}).click();await page.getByLabel('输入你的要求',{exact:true}).fill('继续办理');await page.getByRole('button',{name:'发送',exact:true}).click();
   await page.evaluate(()=>window.__failureAudio.emit({type:'response.created',response:{id:'r'}}));
   if(stall){
    await page.evaluate(()=>{const t=window.__failureAudio;t.interval=setInterval(()=>{t.emit({type:'response.audio.delta',response_id:'r',delta:'AA=='});t.emit({type:'response.audio_transcript.delta',response_id:'r',item_id:'filler',delta:'啊，嗯……'});},80);});
    await page.waitForFunction(()=>window.__failureAudio.peers.every(p=>p.connectionState==='closed'));
    assert.equal(await page.evaluate(()=>window.__failureAudio.audios[0].muted),true);assert.equal(await page.evaluate(()=>window.__failureAudio.tools),0);
    assert.equal(await page.evaluate(()=>window.__failureAudio.tracks.every(t=>t.readyState==='ended')),true);
    report.checks.push('nonverbal traffic times out, mutes the real audio element and releases media without business calls');
   }else{
    assert.equal(await page.evaluate(()=>window.__failureAudio.audios[0].muted),false);
    await page.evaluate(()=>window.__failureAudio.emit({type:'response.output_item.added',response_id:'r',item:{type:'function_call',id:'f',call_id:'f',name:'bank_request',arguments:''}}));
    assert.equal(await page.evaluate(()=>window.__failureAudio.audios[0].muted),true);
    await page.evaluate(()=>window.__failureAudio.emit({type:'response.function_call_arguments.done',response_id:'r',call_id:'f',name:'bank_request',arguments:'{"operation":"get_state"}'}));
    await page.waitForFunction(()=>window.__failureAudio.tools===1);assert.equal(await page.evaluate(()=>window.__failureAudio.audios[0].muted),true);
    await page.evaluate(()=>{window.__failureAudio.emit({type:'response.done',response:{id:'r'}});window.__failureAudio.finishTool();});
    await page.waitForFunction(()=>window.__failureAudio.sent.some(e=>e.item?.type==='function_call_output'));
    await page.evaluate(()=>window.__failureAudio.emit({type:'response.created',response:{id:'result'}}));assert.equal(await page.evaluate(()=>window.__failureAudio.audios[0].muted),false);
    report.checks.push('native function generation and backend wait mute the real audio element; result response restores playback');
   }
  }finally{await page.getByRole('button',{name:'结束对话',exact:true}).click().catch(()=>{});await page.evaluate(()=>{clearInterval(window.__failureAudio.interval);return window.__failureAudio.context?.close();}).catch(()=>{});await context.close();}
 }}catch(e){report.failure=e.message;process.exitCode=1;}
 finally{report.status=report.failure||report.errors.length?'failed':'passed';fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(report,null,2));console.log(JSON.stringify(report));await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
