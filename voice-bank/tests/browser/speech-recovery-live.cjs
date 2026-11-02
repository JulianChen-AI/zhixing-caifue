// Fault injection: drop one tool continuation request, then verify the read-only recovery session.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base=process.env.BANK_TEST_URL||'http://127.0.0.1:5180',output=process.env.RECOVERY_REPORT||'work/speech-recovery-live.json';
const providerError=process.env.RECOVERY_FAULT==='provider-error',sendError=process.env.RECOVERY_FAULT==='send-error',empty=process.env.RECOVERY_FAULT?.startsWith('empty-'),beforeTool=providerError||['before','empty-before'].includes(process.env.RECOVERY_FAULT);
const report={synthetic:true,fault:empty?'inject a completed response with no output; not a natural provider-empty reproduction':sendError?'throw one RTCDataChannel.send error after the committed result; not a natural size-limit reproduction':providerError?'inject one provider error before tools, matching Receive batching backend response failed; not a natural provider-error reproduction':beforeTool?'drop the first response.create before any tool execution; not a natural provider-stall reproduction':'drop exactly one response.create after a real tool result; not a natural provider-stall reproduction',requests:[]};
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--autoplay-policy=no-user-gesture-required']}),context=await browser.newContext(),page=await context.newPage();
 try{
  page.on('request',r=>{if(new URL(r.url()).pathname==='/api/bank'&&r.method()==='POST'){const b=r.postDataJSON();if(b.tool)report.requests.push({name:b.tool.name,operation:b.tool.arguments.operation,origin:String(b.requestId).startsWith('voice-literal-')?'literal':'native'});}});
  await page.addInitScript(({beforeTool,providerError,sendError,empty})=>{
   const t=window.__recoveryProbe={dropped:false,hasResult:false,tools:[],events:[]};
   const fetch=window.fetch.bind(window);window.fetch=async(...args)=>{const response=await fetch(...args);if(new URL(response.url).pathname==='/api/bank'&&args[1]?.method==='POST'){const json=response.json.bind(response);response.json=async()=>{const data=await json();if(data.state?.workflows?.records?.questionnaires?.length)t.hasResult=true;return data;};}return response;};
   const tap=ch=>{const send=ch.send.bind(ch);ch.send=raw=>{const e=JSON.parse(raw);if(e.type==='session.update'&&e.session.tools)t.tools.push(e.session.tools.length);if(e.item?.type==='function_call_output')t.hasResult=true;if(e.type==='response.create'&&(beforeTool||t.hasResult)&&!t.dropped){t.dropped=true;t.events.push('injected-drop');if(sendError)throw new Error('synthetic transport send failure');if(empty)queueMicrotask(()=>{const id='synthetic-empty-'+crypto.randomUUID();for(const e of [{type:'response.created',response:{id,status:'in_progress'}},{type:'response.done',response:{id,status:'completed',output:[]}}])ch.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(e)}));});if(providerError)queueMicrotask(()=>ch.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'error',error:{message:'Receive batching backend response failed!'}})})));return;}send(raw);};ch.addEventListener('message',event=>{try{const e=JSON.parse(event.data);t.events.push(e.type);}catch{}});};
   const RTC=RTCPeerConnection;window.RTCPeerConnection=class extends RTC{constructor(...args){super(...args);this.addEventListener('datachannel',e=>tap(e.channel))}createDataChannel(...args){const ch=super.createDataChannel(...args);tap(ch);return ch;}};
   navigator.mediaDevices.getUserMedia=async()=>{const ctx=new AudioContext();await ctx.resume();return ctx.createMediaStreamDestination().stream;};
  },{beforeTool,providerError,sendError,empty});
  let state=(await(await page.request.get(base+'/api/bank')).json()).state;
  const post=async(args,utterance,name='bank_function')=>{const r=await page.request.post(base+'/api/bank',{data:{requestId:crypto.randomUUID(),revision:state.revision,tool:{name,arguments:args,utterance}}});assert.equal(r.status(),200);state=(await r.json()).state;};
  await post({operation:'create'},'先做风险测评，然后查询订阅清单。','bank_plan');const id=state.workflows.currentTaskId;
  await post({operation:'amend',taskId:id,params:{answers:[3,2,1]}},'三题答案是3、2、1');
  await page.goto(base);await page.getByRole('button',{name:'开始语音对话',exact:true}).click();
  await page.waitForFunction(()=>window.__recoveryProbe.events.includes('session.updated'),null,{timeout:45000});
  await page.getByRole('button',{name:'键盘输入',exact:true}).click();await page.getByLabel('输入你的要求',{exact:true}).fill('确认当前风险测评信息，请提交这份测评。');await page.getByRole('button',{name:'发送',exact:true}).click();
  await page.waitForFunction(before=>window.__recoveryProbe.tools.length>=2&&(before||window.__recoveryProbe.tools.includes(0))&&!!document.querySelector('[aria-label="核实后的回复"]')?.textContent,beforeTool,{timeout:100000});
  state=(await(await page.request.get(base+'/api/bank')).json()).state;
  report.probe=await page.evaluate(()=>window.__recoveryProbe);report.reply=await page.getByLabel('核实后的回复',{exact:true}).textContent();
  report.final={planStatus:state.plan.status,questionnaires:state.workflows.records.questionnaires.length,assessmentStatus:state.workflows.tasks.find(t=>t.id===id)?.status};
  assert.equal(report.probe.dropped,true);assert.equal(report.probe.tools[1],beforeTool?3:0);assert.equal(report.final.planStatus,'complete');assert.equal(report.final.questionnaires,1);assert.equal(report.requests.filter(t=>t.operation==='confirm').length,1);assert.equal(report.requests.length,1);assert.ok(/测评/.test(report.reply));report.status='passed';
 }catch(error){report.status='failed';report.failure=error.message;process.exitCode=1;}finally{fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report));await context.close();await browser.close();}
})().catch(console.error);
