// Uses real Omni/Flash with keyboard input and a silent virtual microphone; does not test human ASR.
// FAIL_NATIVE_CANCEL=1 aborts native cancellation HTTP requests to exercise backend reconciliation.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const out=path.resolve(process.env.BANK_TEST_OUTPUT||'outputs/cancellation-live'),base=process.env.BANK_TEST_URL||'http://127.0.0.1:5180';fs.mkdirSync(out,{recursive:true});
const report={source:'local-working-tree',local:true,realOmni:true,realFlash:true,input:'keyboard in native realtime voice session',syntheticSilentMicrophone:true,humanMicrophone:false,productChanges:true,faultInjection:process.env.FAIL_NATIVE_CANCEL==='1'?"Abort native cancellation HTTP requests; supervision and review endpoints remain real":null,trials:[],startedAt:new Date().toISOString()};
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
const clean=v=>Array.isArray(v)?v.map(clean):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>!/token|secret|sdp|authorization|verification|password|^code$|api.?key/i.test(k)).map(([k,x])=>[k,clean(x)])):v;
const summarize=s=>({revision:s.revision,view:s.view,legacy:s.task?clean({id:s.task.id,step:s.task.step,amount:s.task.amount,recipientId:s.task.recipientId,accountId:s.task.accountId}):null,tasks:s.workflows?.tasks.map(t=>({id:t.id,functionId:t.functionId,status:t.status,params:t.params,missing:t.missing,message:t.message})),currentTaskId:s.workflows?.currentTaskId,accounts:s.accounts.map(a=>({id:a.id,balance:a.balance})),receipts:s.receipts.length});
const transfer=s=>s.workflows?.tasks.find(t=>t.id===s.workflows.currentTaskId&&t.functionId==='TR03')||s.workflows?.tasks.findLast(t=>t.functionId==='TR03');
const specs=[
 {text:'给张三转200元。',expect:s=>transfer(s)?.params.amount===200,description:'实际转账草稿保存200元'},
 {text:'收款人选室友张三，用日常账户。',expect:s=>transfer(s)?.params.recipientId==='zhang-roommate'&&transfer(s)?.params.accountId==='daily',description:'实际保存室友张三和日常账户'},
 {text:'不对，改成300元。',expect:s=>transfer(s)?.params.amount===300,description:'原草稿实际改成300元'},
 {text:'不转了。',expect:s=>transfer(s)?.status==='cancelled'||s.task?.step==='cancelled',description:'原草稿实际取消'}
];
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--autoplay-policy=no-user-gesture-required']});
 try{for(let trial=1;trial<=Number(process.env.TRIALS||1);trial++){
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();page.setDefaultTimeout(10000);
  const run={trial,status:'running',turns:[],requests:[],responses:[],browserErrors:[],connect:[]};report.trials.push(run);save();let turn=-1;
  page.on('pageerror',e=>run.browserErrors.push(e.message));
  page.on('requestfailed',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))run.connect.push({at:Date.now(),path:new URL(r.url()).pathname,error:r.failure()?.errorText});});
  page.on('request',r=>{const p=new URL(r.url()).pathname;if(r.method()==='POST'&&p.startsWith('/api/bank')){const b=r.postDataJSON();run.requests.push({at:Date.now(),turn,path:p,revision:b.revision,tool:b.tool?clean(b.tool):undefined,review:b.review?{turnId:b.review.turnId,targetTaskId:b.review.targetTaskId,reply:b.review.reply,checkpoint:b.review.checkpoint,reason:b.review.reason}:undefined});}});
  page.on('response',async r=>{const p=new URL(r.url()).pathname;if(p==='/api/live/session'){run.connect.push({at:Date.now(),status:r.status(),path:p});if(!r.ok())try{run.connect.at(-1).error=(await r.json()).error;}catch{}return;}
   if(r.request().method()!=='POST'||!p.startsWith('/api/bank'))return;try{const b=await r.json();run.responses.push({at:Date.now(),turn,path:p,status:r.status(),state:b.state?summarize(b.state):undefined,decision:b.decision,toolAttempted:b.toolAttempted,message:b.message,error:b.error,unavailable:b.unavailable,stale:b.stale});save();}catch{}
  });
  await page.addInitScript(()=>{
   const t=window.__pr14={events:[],calls:[],assistant:{},completed:0,active:false,last:0,peers:[],contexts:[],sessionUpdated:false};const observed=new WeakSet();
   const clean=v=>Array.isArray(v)?v.map(clean):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>!/token|secret|sdp|authorization|verification|password|^code$|api.?key/i.test(k)).map(([k,x])=>[k,clean(x)])):v;
   const observe=ch=>{if(observed.has(ch))return;observed.add(ch);ch.addEventListener('message',m=>{try{
    const e=JSON.parse(m.data);t.last=Date.now();t.events.push({at:Date.now(),type:e.type,responseId:e.response?.id||e.response_id,status:e.response?.status,error:e.type==='error'?clean(e.error):undefined});
    if(e.type==='session.updated')t.sessionUpdated=true;
    if(e.type==='response.created')t.active=true;
    if(e.type==='response.audio_transcript.delta'){const id=e.item_id||e.response_id;t.assistant[id]=(t.assistant[id]||'')+(e.delta||'');}
    if(e.type==='response.audio_transcript.done')t.assistant[e.item_id||e.response_id]=e.transcript||'';
    if(e.type==='response.done'){t.active=false;t.completed++;const texts=(e.response?.output||[]).filter(i=>i.type==='message').flatMap(i=>(i.content||[]).map(c=>c.transcript||c.text||'')).filter(Boolean);if(texts.length&&!Object.values(t.assistant).includes(texts.join('')))t.assistant['final-'+e.response.id]=texts.join('');}
    const item=e.item?.type==='function_call'?e.item:null;if(e.type==='response.function_call_arguments.done'||e.type==='response.output_item.done'&&item){const args=e.arguments||item?.arguments||'{}';try{t.calls.push({at:Date.now(),name:e.name||item?.name,args:clean(typeof args==='string'?JSON.parse(args):args)});}catch{}}
   }catch{}});};
   const RTC=window.RTCPeerConnection;window.RTCPeerConnection=class extends RTC{constructor(...args){super(...args);t.peers.push(this);this.addEventListener('datachannel',e=>observe(e.channel));}createDataChannel(...args){const ch=super.createDataChannel(...args);observe(ch);return ch;}};
   navigator.mediaDevices.getUserMedia=async()=>{const c=new AudioContext();t.contexts.push(c);await c.resume();return c.createMediaStreamDestination().stream;};
  });
  const read=async()=>(await(await page.request.get(base+'/api/bank')).json()).state;
  const dom=async()=>({cards:await page.locator('.business-card:visible').allTextContents(),fields:await page.locator('.business-card:visible input,.business-card:visible select').evaluateAll(elements=>elements.filter(e=>e.getClientRects().length).map(e=>({label:e.getAttribute('aria-label')||e.labels?.[0]?.innerText,value:e.value}))),body:(await page.locator('body').innerText()).slice(-12000)});
  try{
   await page.goto(base,{waitUntil:'networkidle'});const initial=await read();run.initial=summarize(initial);
   await page.getByRole('button',{name:'开始语音对话',exact:true}).click();
   await page.waitForFunction(()=>window.__pr14.sessionUpdated&&window.__pr14.peers.some(p=>p.connectionState==='connected'),null,{timeout:60000});
   run.connected=true;console.log(JSON.stringify({trial,connected:true}));save();
   run.injectedFailures=[];if(process.env.FAIL_NATIVE_CANCEL==='1')await page.route('**/api/bank',async route=>{const b=route.request().method()==='POST'?route.request().postDataJSON():null,op=b?.tool?.arguments?.operation;if(['cancel_transfer','cancel'].includes(op)){run.injectedFailures.push({at:Date.now(),turn,operation:op});return route.abort('failed');}return route.continue();});
   for(turn=0;turn<specs.length;turn++){
    const spec=specs[turn],e={input:spec.text,expectation:spec.description,status:'running',began:Date.now()};run.turns.push(e);save();
    const before=await read();e.before=summarize(before);const beforeTrace=await page.evaluate(()=>({done:window.__pr14.completed,keys:Object.keys(window.__pr14.assistant),calls:window.__pr14.calls.length,events:window.__pr14.events.length}));
    await page.getByRole('textbox',{name:'输入你的要求',exact:true}).fill(spec.text);await page.getByRole('button',{name:'发送',exact:true}).click();
    let settledAt=null;const until=Date.now()+65000;
    while(Date.now()<until){
     await page.waitForTimeout(700);
     const t=await page.evaluate(()=>({done:window.__pr14.completed,active:window.__pr14.active,transcripts:Object.keys(window.__pr14.assistant).length,last:window.__pr14.last,diagnostics:JSON.parse(sessionStorage.getItem('zx_voice_diagnostics')||'[]').slice(-1)[0],live:!!document.querySelector('.end-voice')}));
     const tools=run.requests.filter(r=>r.turn===turn&&r.path==='/api/bank'),lastResponse=run.responses.filter(r=>r.turn===turn).at(-1)?.at||e.began;
     const progressed=t.done>beforeTrace.done||t.transcripts>beforeTrace.keys.length;
     if(progressed&&!t.active&&Date.now()-Math.max(t.last,lastResponse)>3000){
      const s=await read();if(spec.expect(s)){settledAt??=Date.now();if(Date.now()-settledAt>3500)break;}
      else if(Date.now()-Math.max(t.last,lastResponse)>11000)break;
     }
     if(!t.live&&Date.now()-e.began>15000){e.connectionEnded=true;break;}
    }
    const after=await read(),trace=await page.evaluate(mark=>({speech:Object.entries(window.__pr14.assistant).filter(([key])=>!mark.keys.includes(key)).map(([,text])=>text),calls:window.__pr14.calls.slice(mark.calls),events:window.__pr14.events.slice(mark.events),active:window.__pr14.active,peers:window.__pr14.peers.map(p=>p.connectionState),diagnostics:JSON.parse(sessionStorage.getItem('zx_voice_diagnostics')||'[]').slice(-6)}),beforeTrace);
    e.after=summarize(after);e.dom=await dom();e.trace=trace;e.elapsedMs=Date.now()-e.began;e.saved=!!spec.expect(after);e.fundsUnchanged=JSON.stringify(after.accounts)===JSON.stringify(initial.accounts)&&JSON.stringify(after.receipts)===JSON.stringify(initial.receipts);e.requestCount=run.requests.filter(r=>r.turn===turn&&r.path==='/api/bank').length;
    const target=transfer(after);e.cardMatches=turn===0?e.dom.fields.some(f=>f.value==='200')||e.dom.cards.some(c=>/200/.test(c)):turn===1?e.dom.cards.some(c=>/6688/.test(c)&&/8021/.test(c))||e.dom.fields.some(f=>f.value==='zhang-roommate')&&e.dom.fields.some(f=>f.value==='daily'):turn===2?e.dom.cards.some(c=>/300/.test(c))||e.dom.fields.some(f=>f.value==='300'):e.dom.cards.some(c=>/已取消|办理已取消|这次先不转/.test(c));
    e.sameTask=turn===0||!run.turns[0].after.currentTaskId||target?.id===run.turns[0].after.currentTaskId;
    e.status=e.saved&&e.cardMatches&&e.fundsUnchanged&&e.sameTask?'passed':'failed';await page.waitForTimeout(250);await page.screenshot({path:path.join(out,`trial-${trial}-turn-${turn+1}.png`),fullPage:true});save();
    console.log(JSON.stringify({trial,turn:turn+1,input:e.input,status:e.status,saved:e.saved,cardMatches:e.cardMatches,toolRequests:e.requestCount,elapsedMs:e.elapsedMs,speech:e.trace.speech,current:target?{id:target.id,status:target.status,params:target.params}:null}));
   }
   run.status=run.turns.every(t=>t.status==='passed')?'passed':'failed';
   if(process.env.FAIL_NATIVE_CANCEL==='1'&&!run.responses.some(r=>r.path==='/api/bank/review'&&r.toolAttempted&&r.state?.tasks?.some(t=>t.functionId==='TR03'&&t.status==='cancelled'))){run.status='failed';run.error='The cancellation reconciliation path was not verified.';}
  }catch(error){run.status='blocked';run.error=error.stack;run.dom=await dom().catch(()=>null);run.trace=await page.evaluate(()=>({events:window.__pr14.events,peers:window.__pr14.peers.map(p=>({connection:p.connectionState,ice:p.iceConnectionState})),sessionUpdated:window.__pr14.sessionUpdated})).catch(()=>null);await page.screenshot({path:path.join(out,`trial-${trial}-blocked.png`),fullPage:true}).catch(()=>{});console.log(JSON.stringify({trial,status:run.status,error:error.message,connect:run.connect}));}
  finally{await page.getByRole('button',{name:'结束语音',exact:true}).click({timeout:1500}).catch(()=>{});await context.close();save();}
  if(run.status==='blocked'&&!run.connected)break;
 }}finally{await browser.close();report.finishedAt=new Date().toISOString();if(report.trials.some(t=>t.status!=='passed'))process.exitCode=1;save();}
})().catch(error=>{report.fatal=error.stack;save();console.error(error);process.exitCode=1;});
