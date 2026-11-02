// Real Qwen WebRTC; silent synthetic microphone, isolated synthetic bank session.
const path=require('node:path'),os=require('node:os'),fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base=process.env.BANK_TEST_URL||'http://127.0.0.1:5173';
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true,args:['--autoplay-policy=no-user-gesture-required']});
 const page=await browser.newPage();page.setDefaultTimeout(20000);
 const report={status:'running',realProvider:true,syntheticSilentMicrophone:true,humanMicrophoneTested:false,checks:[],browserErrors:[],toolRequests:0};
 page.on('pageerror',e=>report.browserErrors.push(e.message));
 page.on('request',r=>{if(r.url().endsWith('/api/bank')&&r.method()==='POST'&&r.postDataJSON()?.tool)report.toolRequests++});
 try{
  await page.addInitScript(()=>{
   const t=window.__cardVoice={events:[],errors:[],peers:[],tracks:[]};
   const observe=ch=>ch.addEventListener('message',m=>{try{const e=JSON.parse(m.data);t.events.push(e.type);if(e.type==='error')t.errors.push({type:e.error?.type,code:e.error?.code,param:e.error?.param})}catch{}});
   const RTC=window.RTCPeerConnection;window.RTCPeerConnection=class extends RTC{constructor(...a){super(...a);t.peers.push(this);this.addEventListener('datachannel',e=>observe(e.channel))}createDataChannel(...a){const ch=super.createDataChannel(...a);observe(ch);return ch}};
   navigator.mediaDevices.getUserMedia=async()=>{const ctx=t.context=new AudioContext();await ctx.resume();const stream=ctx.createMediaStreamDestination().stream;t.tracks.push(...stream.getTracks());return stream};
  });
  await page.goto(base,{waitUntil:'networkidle'});
  const state=async()=>{const r=await page.request.get(base+'/api/bank');assert.equal(r.status(),200);return(await r.json()).state};
  const initial=await state();const seeded=await page.request.post(base+'/api/bank',{data:{revision:initial.revision,requestId:crypto.randomUUID(),action:{type:'workflow',command:{operation:'run',functionId:'IN13',params:{action:'create',productId:'fund-bond',accountId:'daily',amount:2000,schedule:'12'}}}}});assert.equal(seeded.status(),200);
  await page.reload({waitUntil:'networkidle'});
  await page.getByRole('button',{name:'开始语音对话',exact:true}).click();
  await page.waitForFunction(()=>window.__cardVoice.events.includes('session.updated'),null,{timeout:55000});
  await page.getByRole('button',{name:'静音',exact:true}).waitFor();
  const narrate=async(action,label)=>{
   const done=await page.evaluate(()=>window.__cardVoice.events.filter(e=>e==='response.done').length);
   await action();await page.waitForFunction(n=>window.__cardVoice.errors.length||window.__cardVoice.events.filter(e=>e==='response.done').length>n,done,{timeout:45000});
   assert.deepEqual(await page.evaluate(()=>window.__cardVoice.errors),[]);
   assert.equal(await page.getByRole('button',{name:'静音',exact:true}).isVisible(),true,'live session must remain connected');
   assert.equal(await page.evaluate(()=>window.__cardVoice.peers.at(-1).connectionState),'connected');report.checks.push(label);
  };
  await page.getByLabel('周期说明',{exact:true}).fill('每月1号');
  await narrate(()=>page.getByRole('button',{name:'保存修改',exact:true}).click(),'first card narration works without any previous user audio/text');
  await narrate(()=>page.getByRole('button',{name:'重试',exact:true}).click(),'resuming a blocked plan narrates without disconnecting');
  await page.getByRole('button',{name:'键盘输入',exact:true}).click();await page.getByLabel('输入你的要求',{exact:true}).fill('你好，先不用办理其他业务。');
  await narrate(()=>page.getByRole('button',{name:'发送',exact:true}).click(),'normal user dialogue still works after card narration');
  const final=await state(),task=final.workflows.tasks.find(t=>t.id===final.workflows.currentTaskId);
  assert.equal(task.params.schedule,'每月1号');assert.equal(task.status,'blocked');assert.deepEqual(final.accounts,initial.accounts);assert.deepEqual(final.workflows.records,initial.workflows.records);assert.equal(report.toolRequests,0);report.checks.push('narration neither bypasses assessment nor executes another bank tool');
  await page.getByRole('button',{name:'结束对话',exact:true}).click();await page.waitForFunction(()=>window.__cardVoice.peers.every(p=>p.connectionState==='closed')&&window.__cardVoice.tracks.every(t=>t.readyState==='ended'));report.checks.push('ending the session releases media');assert.deepEqual(report.browserErrors,[]);report.status='passed';
 }catch(e){report.status='failed';report.failure=e.message;process.exitCode=1}
 finally{
  report.transport=await page.evaluate(()=>({errors:window.__cardVoice?.errors,events:window.__cardVoice?.events})).catch(()=>null);
  await page.getByRole('button',{name:'结束对话',exact:true}).click().catch(()=>{});await page.evaluate(()=>window.__cardVoice?.context?.close()).catch(()=>{});
  const output=process.env.BANK_TEST_REPORT||'outputs/card-narration-validation.json';fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report));await browser.close();
 }
})();
