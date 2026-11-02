// Exercise the real UI/LiveVoice lifecycle with a deterministic fake provider.
const path=require('node:path'),os=require('node:os'),fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base=process.env.BANK_TEST_URL||'http://127.0.0.1:5173';
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const report={status:'running',fakeProvider:true,checks:[],browserErrors:[]};
 const pageFor=async(delayed=false)=>{
  const page=await browser.newPage();page.on('pageerror',e=>report.browserErrors.push(e.message));
  await page.route('**/api/live/session',r=>r.fulfill({status:201,json:{sdp:'v=0\r\n',voice:'Tina'}}));
  await page.addInitScript(delayed=>{
   const t=window.__voiceIsolation={peers:[],tracks:[],spoken:[],overlap:[],sent:[],voicesLoaded:!delayed,speaking:false};
   Object.defineProperty(window,'SpeechSynthesisUtterance',{value:class{constructor(text){this.text=text}}});
   Object.defineProperty(speechSynthesis,'getVoices',{value:()=>t.voicesLoaded?[{name:'Eddy',lang:'zh-CN'},{name:'Tingting',lang:'zh-CN'}]:[]});
   Object.defineProperty(speechSynthesis,'speak',{value:u=>{t.speaking=true;t.spoken.push(u.voice?.name||'default');if(t.tracks.some(x=>x.enabled&&x.readyState==='live'))t.overlap.push(u.text);u.onstart?.()}});
   Object.defineProperty(speechSynthesis,'cancel',{value:()=>{t.speaking=false}});
   navigator.mediaDevices.getUserMedia=async()=>{const c=t.context=new AudioContext();await c.resume();const s=c.createMediaStreamDestination().stream;t.tracks.push(...s.getTracks());return s};
   class Channel{
    readyState='open';emit(e){this.onmessage?.({data:JSON.stringify(e)})}
    send(s){const e=JSON.parse(s);t.sent.push(e.type);if(e.type==='session.update')setTimeout(()=>this.emit({type:'session.updated'}),0)}
    close(){this.readyState='closed';this.onclose?.()}
   }
   window.RTCPeerConnection=class extends EventTarget{
    connectionState='new';iceGatheringState='complete';localDescription=null;
    constructor(){super();t.peers.push(this)}
    addTransceiver(){return{sender:{replaceTrack:async()=>{if(t.speaking)t.overlap.push('microphone attached while device speech was playing')}}}}
    createDataChannel(){return this.channel=new Channel()}
    async createOffer(){return{type:'offer',sdp:'v=0\r\n'}}
    async setLocalDescription(d){this.localDescription=d}
    async setRemoteDescription(){this.connectionState='connected';this.onconnectionstatechange?.();this.channel.onopen?.();this.channel.emit({type:'session.created'})}
    close(){this.connectionState='closed';this.onconnectionstatechange?.()}
   };
  },delayed);
  await page.goto(base,{waitUntil:'networkidle'});return page;
 };
 const settings=page=>page.getByRole('button',{name:'设置与连接',exact:true}).click();
 const live=async page=>{await settings(page);await page.getByRole('button',{name:'静音',exact:true}).waitFor()};
 const release=async page=>{if(await page.getByRole('button',{name:'关闭',exact:true}).isVisible())await page.getByRole('button',{name:'关闭',exact:true}).click();await page.getByRole('button',{name:'结束对话',exact:true}).click();await page.evaluate(()=>window.__voiceIsolation.context?.close());await page.close()};
 try{
  let page=await pageFor();
  try{
   await live(page);await settings(page);const demo=page.getByRole('button',{name:'体验交互演示',exact:true});
   if(await demo.isEnabled())await demo.click();
   assert.deepEqual(await page.evaluate(()=>window.__voiceIsolation.overlap),[],'device narration ran while the online microphone was open');
   assert.equal(await demo.isDisabled(),true,'demo entry must be unavailable during live voice');
   assert.deepEqual(await page.evaluate(()=>window.__voiceIsolation.spoken),[]);
   report.checks.push('live microphone and demo narration cannot run together');
  }finally{await release(page)}

  page=await pageFor();try{
   await settings(page);await page.getByRole('button',{name:'体验交互演示',exact:true}).click();
   assert.equal(await page.evaluate(()=>window.__voiceIsolation.speaking),true);
   await live(page);assert.equal(await page.evaluate(()=>window.__voiceIsolation.speaking),false);
   assert.deepEqual(await page.evaluate(()=>window.__voiceIsolation.overlap),[]);
   report.checks.push('playing device narration is cancelled before the live microphone attaches');
  }finally{await release(page)}

  page=await pageFor();try{
   await page.getByRole('button',{name:'查账单',exact:true}).click();await page.getByRole('heading',{name:'统计和比较收支',exact:true}).waitFor();
   assert.deepEqual(await page.evaluate(()=>window.__voiceIsolation.spoken),[],'idle card action must not silently enable device narration');
   report.checks.push('idle card actions cannot start device speech');
  }finally{await release(page)}

  page=await pageFor(true);try{
   await settings(page);await page.getByRole('button',{name:'体验交互演示',exact:true}).click();
   await live(page);await page.evaluate(()=>{window.__voiceIsolation.voicesLoaded=true;speechSynthesis.dispatchEvent(new Event('voiceschanged'))});
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   assert.deepEqual(await page.evaluate(()=>window.__voiceIsolation.spoken),[]);
   assert.deepEqual(await page.evaluate(()=>window.__voiceIsolation.overlap),[]);
   report.checks.push('late device voice loading cannot speak after connecting live');
  }finally{await release(page)}

  page=await pageFor();try{
   let unblock;const gate=new Promise(r=>unblock=r);let entered;const started=new Promise(r=>entered=r);
   // Connecting aborts the old card request. Its discarded card need not render.
   let aborted;const cancelled=new Promise(r=>aborted=r);let finished;const released=new Promise(r=>finished=r);
   page.on('requestfailed',request=>{if(request.method()==='POST'&&request.url().endsWith('/api/bank'))aborted()});
   await page.route('**/api/bank',async route=>{if(route.request().method()==='POST'){entered();await gate;try{await route.continue()}finally{finished()}return}await route.continue()});
   await page.getByRole('button',{name:'查账单',exact:true}).click();await started;
   try{await live(page)}finally{unblock()}
   await Promise.all([cancelled,released]);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   assert.deepEqual(await page.evaluate(()=>window.__voiceIsolation.spoken),[]);
   assert.equal(await page.evaluate(()=>window.__voiceIsolation.sent.includes('response.create')),false,'a reply from before connecting must not start a new narration');
   report.checks.push('a delayed card result cannot cross the live connection boundary');
  }finally{await release(page)}
  assert.deepEqual(report.browserErrors,[]);report.status='passed';
 }catch(e){report.status='failed';report.failure=e.message;process.exitCode=1}
 finally{const file=process.env.BANK_TEST_REPORT||'outputs/voice-isolation-validation.json';fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(report,null,2));console.log(JSON.stringify(report));await browser.close()}
})();
