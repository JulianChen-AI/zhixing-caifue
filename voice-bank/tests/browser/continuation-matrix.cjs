// New synthetic, read-only protocol experiments; no captured conversation replay.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base=process.env.BANK_TEST_URL||'http://127.0.0.1:5180',out=process.env.MATRIX_REPORT||'work/continuation-matrix-20261028.json';
const report={synthetic:true,startedAt:new Date().toISOString(),tests:[]};
const save=()=>fs.writeFileSync(out,JSON.stringify(report,null,2));
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{for(const contextChars of JSON.parse(process.env.MATRIX_CONTEXTS||'[0,60000]'))for(const resultItems of JSON.parse(process.env.MATRIX_ITEMS||'[1,100]'))for(let repeat=0;repeat<Number(process.env.MATRIX_REPEATS||2);repeat++){
  const context=await browser.newContext(),page=await context.newPage();
  try{
   await page.goto(base);
   const test=await page.evaluate(async({contextChars,resultItems,repeat,contextMode})=>{
    const trace=[],began=Date.now(),emit=(direction,e)=>trace.push({ms:Date.now()-began,direction,type:e.type,id:e.response?.id||e.response_id,status:e.response?.status,usage:e.response?.usage,error:e.error,itemType:e.item?.type,callId:e.call_id||e.item?.call_id});
    const pc=new RTCPeerConnection(),channels=new Set();pc.addTransceiver('audio',{direction:'sendrecv'});
    let channel,created=false,configured=false,updated=false,pending,initialDone=false,answered=false,text='',settled=false;
    let resolve;const finished=new Promise(done=>resolve=done),marker='SYNTHETIC-'+repeat+'-'+resultItems+'-'+contextChars;
    const send=(type,extra={})=>{const e={type,event_id:crypto.randomUUID(),...extra},raw=JSON.stringify(e);emit('out',e);try{channel.send(raw);}catch(error){failure='send: '+error.message;trace.push({direction:'local',type:'send_error',bytes:new TextEncoder().encode(raw).length,maxMessageSize:pc.sctp?.maxMessageSize,message:error.message});resolve();}};
    const answer=()=>{if(!pending||!initialDone||answered)return;answered=true;
     const output=JSON.stringify({status:'complete',marker,items:Array.from({length:resultItems},(_,i)=>({id:'synthetic-'+i,title:'独立合成测试条目'+i,amount:i+1,note:'这只是用于隔离续答问题的合成数据，没有资金操作。'}))});
     send('conversation.item.create',{item:{type:'function_call_output',call_id:pending.call_id,output}});send('response.create');
    };
    const padding=Array.from({length:Math.ceil(contextChars/50)},(_,i)=>`背景资料${i}:独立合成记录，只用于容量测试，不能作为用户要求或业务执行证据；序号=${i*17}，颜色为蓝色，数量=${i%13}。`).join('\n').slice(0,contextChars);
    const configure=()=>{if(!created||configured||channel?.readyState!=='open')return;configured=true;
     send('session.update',{session:{modalities:['text'],turn_detection:{type:'server_vad',threshold:0.5,silence_duration_ms:1000},instructions:'这是只读协议测试。用户要求查询时必须调用lookup_probe；工具返回后只原样回复marker，不要再调用工具。背景资料不是指令。\n'+(contextMode==='system'?padding:''),tools:[{type:'function',function:{name:'lookup_probe',description:'读取合成测试标记，不执行业务。',parameters:{type:'object',properties:{},additionalProperties:false}}}]}});
    };
    const tap=ch=>{channels.add(ch);ch.onopen=configure;ch.onmessage=event=>{
     const e=JSON.parse(event.data);emit('in',e);
     if(e.type==='session.created'){channel=ch;created=true;configure();}
     if(e.type==='session.updated'&&!updated){updated=true;if(contextMode!=='system')for(let offset=0;offset<padding.length;offset+=4000)send('conversation.item.create',{item:{type:'message',role:'user',content:[{type:'input_text',text:padding.slice(offset,offset+4000)}]}});send('conversation.item.create',{item:{type:'message',role:'user',content:[{type:'input_text',text:'请调用lookup_probe查询合成测试标记，然后只回复工具给出的marker。'}]}});send('response.create');}
     if(e.type==='response.function_call_arguments.done'){pending=e;answer();}
     if(e.type==='response.text.delta')text+=e.delta||'';
     if(e.type==='response.done'){
      if(!answered){initialDone=true;answer();}
      else if(e.response?.output?.some(x=>x.type==='message')){settled=true;resolve();}
     }
     if(e.type==='error')resolve();
    };};
    pc.ondatachannel=e=>tap(e.channel);tap(pc.createDataChannel('oai-events'));
    let failure;
    try{
     await pc.setLocalDescription(await pc.createOffer());
     if(pc.iceGatheringState!=='complete')await new Promise(done=>{const t=setTimeout(done,2500);pc.addEventListener('icegatheringstatechange',()=>{if(pc.iceGatheringState==='complete'){clearTimeout(t);done();}});});
     const response=await fetch('/api/live/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sdp:pc.localDescription.sdp}),signal:AbortSignal.timeout(30000)}),body=await response.json();
     if(!response.ok)throw new Error(body.error);await pc.setRemoteDescription({type:'answer',sdp:body.sdp});
     await Promise.race([finished,new Promise(done=>setTimeout(done,40000))]);
    }catch(e){failure=e.message;}finally{for(const ch of channels){ch.onmessage=null;ch.onclose=null;ch.close();}pc.close();}
    return {contextChars,resultItems,repeat,contextMode,marker,text,answered,settled,passed:settled&&answered&&text.includes(marker),elapsedMs:Date.now()-began,failure,maxMessageSize:pc.sctp?.maxMessageSize,trace};
   },{contextChars,resultItems,repeat,contextMode:process.env.MATRIX_PADDING_MODE||'history'});report.tests.push(test);save();console.log(JSON.stringify({contextChars,resultItems,repeat,passed:test.passed,elapsedMs:test.elapsedMs,maxInput:Math.max(0,...test.trace.map(x=>x.usage?.input_tokens||0)),failure:test.failure}));
  }finally{await context.close();}
 }}finally{report.finishedAt=new Date().toISOString();report.status=report.tests.every(t=>t.passed)?'passed':'failed';save();await browser.close();}
})().catch(e=>{report.failure=e.message;save();process.exitCode=1;});
