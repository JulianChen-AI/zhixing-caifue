// Real React page, controlled provider/HTTP delays and deterministic sandbox state.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base=process.env.BANK_TEST_URL||'http://127.0.0.1:5176',out=path.resolve('outputs','final-lock-'+new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(out,{recursive:true});
(async()=>{
 const {initialState,reduceBank}=await import('../../lib/bank/engine.ts');
 const {currentWorkflow}=await import('../../lib/workflows/engine.ts');
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:process.env.BANK_TEST_DIRECT==='1'?['--no-proxy-server']:[]}),report={base,realProvider:false,realDatabase:false,cases:[]};
 try{for(const scenario of ['tool-stall','tool-stall-after-commit','card-stall-before-commit','card-stall-after-commit','manual-recovery','direct-confirmation-stall','direct-confirmation-stall-after-commit']){
  let bank=reduceBank(initialState(),{type:'workflow',command:{operation:'run',source:'card',functionId:'CA06',params:{action:'freeze',cardId:'card-daily'}}},crypto.randomUUID());
  const task=currentWorkflow(bank),commits=[],entry={scenario,status:'running',errors:[]};report.cases.push(entry);
  const context=await browser.newContext(),page=await context.newPage();page.setDefaultTimeout(5000);page.on('pageerror',e=>entry.errors.push(e.message));
  await page.route('**/api/bank',async route=>{
   const body=route.request().method()==='POST'?route.request().postDataJSON():null;
   if(body?.action){const action=body.action;if(action.type==='workflow'){action.command.source='card';commits.push(action.command.operation);}bank=reduceBank(bank,action,body.requestId);}
   if(body?.tool){commits.push(body.tool.arguments.operation);bank=reduceBank(bank,{type:'workflow',command:{...body.tool.arguments,source:'voice',utterance:body.tool.utterance,history:body.tool.history,turnId:body.tool.turnId}},body.requestId);}
   await route.fulfill({json:{state:bank,liveConfigured:true}});
  });
  await page.addInitScript(({scenario,task})=>{
   const t=window.__lock={peers:[],tracks:[],pending:false,aborted:false,events:[]},native=fetch.bind(window),later=setTimeout.bind(window),timeout=AbortSignal.timeout.bind(AbortSignal);
   window.setTimeout=(fn,ms,...args)=>later(fn,ms===30000?400:ms,...args);AbortSignal.timeout=ms=>timeout(ms===30000?400:ms===5000?200:ms);
   window.fetch=async(input,init={})=>{
    const b=typeof init.body==='string'?JSON.parse(init.body):{};
    const target=String(input).includes('/api/bank')&&(scenario.startsWith('tool-stall')||scenario.startsWith('direct-confirmation-stall')?!!b.tool:b.action?.command?.operation==='confirm');
    if(target&&!t.pending){t.pending=true;
     if(scenario.endsWith('after-commit'))await native(input,init);
     return new Promise((resolve,reject)=>{init.signal?.addEventListener('abort',()=>{t.aborted=true;reject(init.signal.reason||new DOMException('aborted','AbortError'));},{once:true});});
    }
    if(String(input).includes('/api/live/session'))return Response.json({sdp:'v=0\r\n',voice:'Tina'});
    return native(input,init);
   };
   navigator.mediaDevices.getUserMedia=async()=>{const ctx=t.audio=new AudioContext();await ctx.resume();const stream=ctx.createMediaStreamDestination().stream;t.tracks.push(...stream.getTracks());return stream;};
   window.RTCPeerConnection=class{
    constructor(){this.connectionState='new';this.iceGatheringState='complete';t.peers.push(this);}
    createDataChannel(){const ch=this.channel={readyState:'open',send:s=>{const e=JSON.parse(s);t.events.push(e.type);if(e.type==='session.update')queueMicrotask(()=>t.emit({type:'session.updated'}));if(e.type==='response.create')queueMicrotask(()=>t.emit({type:'response.created',response:{id:'r'}}));},close:()=>{ch.readyState='closed';}};t.emit=e=>ch.onmessage?.({data:JSON.stringify(e)});return ch;}
    addTransceiver(){return{sender:{replaceTrack:async()=>{}}};}async createOffer(){return{type:'offer',sdp:'v=0\r\n'};}async setLocalDescription(v){this.localDescription=v;}
    async setRemoteDescription(){this.connectionState='connected';this.onconnectionstatechange?.();t.emit({type:'session.created'});}close(){this.connectionState='closed';}
   };
  },{scenario,task});
  try{
   await page.goto(base,{waitUntil:'networkidle'});const confirm=page.getByRole('button',{name: /^手动确认/});assert.equal(await confirm.isEnabled(),true);
   if(scenario.startsWith('tool-stall')||scenario.startsWith('direct-confirmation-stall')){
    const direct=scenario.startsWith('direct-confirmation-stall');
    await page.getByRole('button',{name:'开始语音对话',exact:true}).click();await page.getByRole('button',{name:'键盘输入',exact:true}).click();await page.getByLabel('输入你的要求',{exact:true}).fill(direct?'确认冻结':'确认冻结这张日常卡');await page.getByRole('button',{name:'发送',exact:true}).click();
    if(!direct)await page.evaluate(({id,token})=>window.__lock.emit({type:'response.function_call_arguments.done',response_id:'r',call_id:'confirm',name:'bank_function',arguments:JSON.stringify({operation:'confirm',taskId:id,token})}),{id:task.id,token:task.reviewToken});
    await page.waitForFunction(()=>window.__lock.pending);assert.equal(await confirm.isDisabled(),true);
    if(!direct){await page.evaluate(()=>window.__lock.emit({type:'response.done',response:{id:'r'}}));await page.waitForFunction(()=>window.__lock.peers.every(p=>p.connectionState==='closed'),null,{timeout:2000});}
    if(scenario.endsWith('after-commit'))await page.getByLabel('功能演示验证码',{exact:true}).waitFor({timeout:2500});
    else{await page.waitForFunction(()=>!document.querySelector('.workflow-card button.primary-button')?.disabled,null,{timeout:2500});assert.equal(await confirm.isEnabled(),true);await confirm.click();}
   }else{
    await confirm.click();await page.waitForFunction(()=>window.__lock.pending);assert.equal(await confirm.isDisabled(),true);
    if(scenario==='manual-recovery'){await page.getByRole('button',{name:'停止等待并核对进度',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.workflow-card button.primary-button')?.disabled,null,{timeout:2000});await confirm.click();}
    else if(scenario==='card-stall-after-commit')await page.getByLabel('功能演示验证码',{exact:true}).waitFor({timeout:2500});
    else{await page.waitForFunction(()=>!document.querySelector('.workflow-card button.primary-button')?.disabled,null,{timeout:2500});await confirm.click();}
   }
   await page.getByLabel('功能演示验证码',{exact:true}).fill('123456');await page.getByRole('button',{name:'验证并办理',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.workflow-card .card-top span')?.textContent==='办理结果');
   assert.equal(currentWorkflow(bank).status,'complete');assert.equal(bank.workflows.records.cards.find(c=>c.id==='card-daily').status,'frozen');assert.equal(commits.filter(op=>op==='confirm').length,1);assert.equal(commits.filter(op=>op==='authenticate').length,1);entry.committedOperations=commits;assert.equal(await page.evaluate(()=>window.__lock.aborted),true);assert.deepEqual(entry.errors,[]);entry.status='passed';
   await page.screenshot({path:path.join(out,scenario+'.png'),fullPage:true});console.log(scenario+': passed');
  }catch(e){entry.status='failed';entry.failure=e.message;entry.pageText=(await page.locator('body').innerText()).slice(-2400);await page.screenshot({path:path.join(out,scenario+'-failure.png'),fullPage:true});console.log(scenario+': '+e.message);}
  finally{await context.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));}
 }}finally{await browser.close();console.log('Report: '+path.join(out,'report.json'));if(report.cases.some(c=>c.status!=='passed'))process.exitCode=1;}
})().catch(e=>{console.error(e);process.exitCode=1});
