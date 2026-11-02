// Isolated sandbox browser regression; the lifecycle case uses a fake WebRTC provider.
const path=require('node:path'),os=require('node:os'),fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base=process.env.BANK_TEST_URL||'http://127.0.0.1:5194';
if(base!=='http://127.0.0.1:5194')throw new Error('This regression is restricted to the independent 5194 sandbox.');
const reportFile=process.env.REPRO_REPORT||path.resolve('outputs/demo-scenes.json');if(!path.isAbsolute(reportFile))throw new Error('REPRO_REPORT must be an absolute path.');
fs.mkdirSync(path.dirname(reportFile),{recursive:true});const shotDir=fs.mkdtempSync(path.join(path.dirname(reportFile),'demo-scenes-shots-'));
const report={status:'running',base,realQwen:false,fakeRtcOnly:true,checks:[],failures:[],browserErrors:[],screenshots:shotDir};
const save=()=>fs.writeFileSync(reportFile,JSON.stringify(report,null,2));
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const fresh=async()=>{const context=await browser.newContext({viewport:{width:1100,height:950}}),page=await context.newPage();page.on('pageerror',e=>report.browserErrors.push(e.message));return {context,page};};
 const state=async page=>{const r=await page.request.get(base+'/api/bank');assert.equal(r.status(),200);return (await r.json()).state;};
 const post=async(page,s,action,id=crypto.randomUUID(),epoch=s.sceneEpoch)=>{const r=await page.request.post(base+'/api/bank',{data:{requestId:id,revision:s.revision,...(epoch?{sceneEpoch:epoch}:{}),action}});return {http:r.status(),body:await r.json()};};
 const settings=page=>page.getByRole('button',{name:'设置与连接',exact:true});
 const openScenes=async page=>{await settings(page).click();await page.getByRole('button',{name:'路演场景',exact:true}).click();return page.getByRole('region',{name:'路演场景'});};
 const loadScene=async(page,id)=>{const panel=await openScenes(page);await panel.getByRole('combobox',{name:'选择路演场景',exact:true}).click();await page.locator(`.choice-option[data-value="${id}"]`).click();await panel.getByRole('button',{name:'加载所选场景',exact:true}).click();await page.getByRole('button',{name:'确认加载场景',exact:true}).click();await page.waitForFunction(id=>document.querySelector('[aria-label="演示场景状态"]')?.textContent?.includes(id==='default'?'默认演示':id),id);};
 const run=async(name,fn)=>{const {context,page}=await fresh();try{await fn(page);report.checks.push(name);}catch(e){report.failures.push({name,error:e.message});await page.screenshot({path:path.join(shotDir,name+'-failure.png'),fullPage:true,animations:'disabled'}).catch(()=>{});}finally{await context.close();save();}};
 try{
 await run('ui-scenes',async page=>{
  const initial=await(await page.request.get(base+'/api/bank')).json();assert.equal(initial.liveConfigured,false,'test service must not enable a real provider');
  await page.goto(base,{waitUntil:'networkidle'});await loadScene(page,'S01');let s=await state(page);assert.equal(s.sceneId,'S01');assert.equal(s.accounts[0].balance,28660);
  const banner=page.getByLabel('演示场景状态',{exact:true});assert.match(await banner.textContent(),/模拟|演示/);assert.match(await banner.textContent(),/2026[\/-]10[\/-]25/);
  let panel=await openScenes(page);assert.match(await panel.textContent(),/286[.,]60/);await page.screenshot({path:path.join(shotDir,'S01.png'),fullPage:true,animations:'disabled'});
  await panel.getByRole('combobox',{name:'选择路演场景',exact:true}).click();await page.locator('.choice-option[data-value="S02-A"]').click();await panel.getByRole('button',{name:'加载所选场景',exact:true}).click();await page.getByRole('button',{name:'确认加载场景',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[aria-label="演示场景状态"]')?.textContent?.includes('S02-A'));
  s=await state(page);assert.equal(s.accounts[0].balance,114000);assert.equal(s.contacts.length,3);assert.deepEqual(s.contacts.map(c=>c.tail),['0186','7291','5408']);
  panel=await openScenes(page);const visible=await panel.textContent();for(const tail of ['0186','7291','5408'])assert.ok(visible.includes(tail));assert.match(visible,/1[,，]?140(?:\.00)?/);await page.screenshot({path:path.join(shotDir,'S02-A.png'),fullPage:true,animations:'disabled'});
  const before={accounts:s.accounts,records:s.workflows.records,receipts:s.receipts,clock:s.demoClock};await panel.getByRole('button',{name:'推进到次日',exact:true}).click();await page.waitForFunction(old=>document.querySelector('[aria-label="演示场景状态"]')?.textContent&&!document.querySelector('[aria-label="演示场景状态"]')?.textContent?.includes(old.slice(0,10)),before.clock);
  s=await state(page);assert.equal(Date.parse(s.demoClock)-Date.parse(before.clock),86400000);assert.deepEqual({accounts:s.accounts,records:s.workflows.records,receipts:s.receipts},{accounts:before.accounts,records:before.records,receipts:before.receipts});
  await loadScene(page,'default');s=await state(page);assert.equal(s.sceneId,'default');const defaultTool=await page.request.post(base+'/api/bank',{data:{requestId:crypto.randomUUID(),revision:s.revision,sceneEpoch:s.sceneEpoch,tool:{name:'bank_request',arguments:{operation:'list_accounts'},utterance:'查看账户'}}});assert.equal(defaultTool.status(),200);const defaultResult=await defaultTool.json();assert.deepEqual(defaultResult.toolResult.contacts.map(c=>c.id),['zhang-roommate','zhang-landlord','li-friend']);
 });
 await run('lost-control-response',async page=>{
  await page.goto(base,{waitUntil:'networkidle'});await loadScene(page,'S01');const before=await state(page),attempts=[];
  await page.route('**/api/bank',async route=>{const request=route.request();if(request.method()!=='POST')return route.continue();let body;try{body=request.postDataJSON()}catch{return route.continue()};
   if(body.action?.type!=='load_scene'||body.action.sceneId!=='S02-A')return route.continue();attempts.push(body.requestId);
   if(attempts.length===1){await route.fetch();await route.abort('failed');return;}await route.continue();
  });
  const panel=await openScenes(page);await panel.getByRole('combobox',{name:'选择路演场景',exact:true}).click();await page.locator('.choice-option[data-value="S02-A"]').click();await panel.getByRole('button',{name:'加载所选场景',exact:true}).click();await page.getByRole('button',{name:'确认加载场景',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[aria-label="演示场景状态"]')?.textContent?.includes('S02-A'),null,{timeout:8000}).catch(()=>{});
  const after=await state(page),banner=await page.getByLabel('演示场景状态',{exact:true}).textContent();
  report.lostControlObservation={backendScene:after.sceneId,backendRevision:after.revision,priorRevision:before.revision,banner,controlPosts:attempts.length,distinctRequestIds:new Set(attempts).size};
  assert.equal(after.sceneId,'S02-A');assert.equal(after.revision,before.revision+1);assert.equal(attempts.length,1);assert.equal(new Set(attempts).size,1);assert.match(banner||'',/S02-A/,'UI must reconcile the committed scene after a lost response');
 });
 await run('api-cas-and-stale-token',async page=>{
  const initial=await(await page.request.get(base+'/api/bank')).json();assert.equal(initial.liveConfigured,false);let s=initial.state;
  const id=crypto.randomUUID(),request={requestId:id,revision:s.revision,action:{type:'load_scene',sceneId:'S02-A'}};
  const [a,b]=await Promise.all([page.request.post(base+'/api/bank',{data:request}),page.request.post(base+'/api/bank',{data:request})]);const x=await a.json(),y=await b.json();assert.equal(a.status(),200);assert.equal(b.status(),200);assert.equal(x.state.revision,s.revision+1);assert.equal(y.state.revision,x.state.revision);assert.equal(y.state.sceneEpoch,x.state.sceneEpoch);
  s=await state(page);assert.equal(s.revision,x.state.revision);assert.equal(s.sceneId,'S02-A');
  let result=await post(page,s,{type:'load_scene',sceneId:'S01'},id,undefined);assert.equal(result.http,409,'same request id with different payload must conflict');
  result=await post(page,s,{type:'home'},crypto.randomUUID(),'00000000-0000-4000-8000-000000000001');assert.equal(result.http,409,'old epoch must fail');
  const missing=await page.request.post(base+'/api/bank',{data:{requestId:crypto.randomUUID(),revision:s.revision,action:{type:'home'}}});assert.equal(missing.status(),409,'missing epoch must fail');
  result=await post(page,s,{type:'workflow',command:{operation:'run',functionId:'TR03',params:{recipientId:'C02',accountId:'daily',amount:10}}});assert.equal(result.http,200);s=result.body.state;const task=s.workflows.tasks.find(t=>t.id===s.workflows.currentTaskId);assert.equal(task.status,'review');assert.ok(task.reviewToken);const oldEpoch=s.sceneEpoch,oldToken=task.reviewToken,oldTaskId=task.id;
  result=await post(page,s,{type:'load_scene',sceneId:'S01'});assert.equal(result.http,200);s=result.body.state;assert.notEqual(s.sceneEpoch,oldEpoch);
  result=await post(page,s,{type:'workflow',command:{operation:'confirm',taskId:oldTaskId,token:oldToken}},crypto.randomUUID(),oldEpoch);assert.equal(result.http,409,'old scene token with old epoch must fail');
  result=await post(page,s,{type:'workflow',command:{operation:'confirm',taskId:oldTaskId,token:oldToken}});assert.ok([400,409].includes(result.http),`old scene token should be rejected with 400 or 409, got ${result.http}`);
  const after=await state(page);assert.equal(after.receipts.length,0);assert.equal(after.sceneId,'S01');
 });
 await run('fake-voice-reconnect',async page=>{
  await page.route('**/api/bank',async route=>{if(route.request().method()!=='GET')return route.continue();const r=await route.fetch(),json=await r.json();json.liveConfigured=true;await route.fulfill({response:r,json});});
  let failNextSession=false,sceneLoads=0;
  await page.route('**/api/live/session',route=>failNextSession?route.fulfill({status:503,json:{error:'模拟语音连接失败'}}):route.fulfill({status:201,json:{sdp:'v=0\r\n',voice:'Tina'}}));
  page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/bank'){try{const body=request.postDataJSON();if(body.action?.type==='load_scene'&&body.action.sceneId==='S03')sceneLoads++;}catch{}}});
  await page.addInitScript(()=>{
   const t=window.__fakeScene={peers:[],updates:[],closed:0};
   navigator.mediaDevices.getUserMedia=async()=>{const audio=new AudioContext();await audio.resume();return audio.createMediaStreamDestination().stream;};
   class Channel{readyState='open';emit(e){this.onmessage?.({data:JSON.stringify(e)})}send(s){const e=JSON.parse(s);if(e.type==='session.update'){t.updates.push(e.session);setTimeout(()=>this.emit({type:'session.updated'}),0)}}close(){this.readyState='closed';this.onclose?.()}}
   window.RTCPeerConnection=class extends EventTarget{connectionState='new';iceGatheringState='complete';localDescription=null;constructor(){super();t.peers.push(this)}addTransceiver(){return {sender:{replaceTrack:async()=>{}}}}createDataChannel(){return this.channel=new Channel()}async createOffer(){return {type:'offer',sdp:'v=0\r\n'}}async setLocalDescription(d){this.localDescription=d}async setRemoteDescription(){this.connectionState='connected';this.onconnectionstatechange?.();this.channel.onopen?.();this.channel.emit({type:'session.created'})}close(){t.closed++;this.connectionState='closed';this.onconnectionstatechange?.()}};
  });
  await page.goto(base,{waitUntil:'networkidle'});await page.getByRole('group',{name:'对话方式'}).getByRole('button',{name:'语音',exact:true}).click();await page.waitForFunction(()=>window.__fakeScene.updates.length===1);await page.getByRole('button',{name:'结束语音',exact:true}).waitFor();
  const first=await page.evaluate(()=>window.__fakeScene.updates[0].tools.find(t=>t.function.name==='bank_request').function.parameters.properties.recipientId.enum);for(const id of ['zhang-roommate','zhang-landlord','li-friend'])assert.ok(first.includes(id));
  await loadScene(page,'S02-A');await page.waitForFunction(()=>window.__fakeScene.updates.length>=2,null,{timeout:20000});
  const observed=await page.evaluate(()=>({closed:window.__fakeScene.closed,session:window.__fakeScene.updates.at(-1)}));assert.ok(observed.closed>=1);const ids=observed.session.tools.find(t=>t.function.name==='bank_request').function.parameters.properties.recipientId.enum;assert.deepEqual(ids.filter(Boolean),['C01','C02','C03']);assert.match(observed.session.instructions,/S02-A/);assert.match(observed.session.instructions,/2027-10-25/);
  const before=await state(page);await page.evaluate(()=>window.__fakeScene.peers[0].channel.emit({type:'session.updated'}));await page.waitForTimeout(200);const after=await state(page);assert.equal(after.sceneEpoch,before.sceneEpoch);assert.equal(after.revision,before.revision);assert.equal(after.sceneId,'S02-A');
  failNextSession=true;await loadScene(page,'S03');await page.getByText(/场景已加载.*语音未连接/).waitFor();
  const disconnected=await state(page),closed=await page.evaluate(()=>window.__fakeScene.closed);assert.equal(disconnected.sceneId,'S03');assert.equal(disconnected.revision,after.revision+1);assert.equal(sceneLoads,1);assert.ok(closed>=2,'previous fake peer must close before the failed reconnect');
 });
 if(report.browserErrors.length)report.failures.push({name:'browser-errors',error:report.browserErrors.join('; ')});report.status=report.failures.length?'failed':'passed';if(report.failures.length)process.exitCode=1;
 }finally{await browser.close();save();console.log(JSON.stringify(report));}
})().catch(e=>{report.status='failed';report.failures.push({name:'startup',error:e.message});save();console.error(e.message);process.exitCode=1;});
