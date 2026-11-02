// Real Qwen WebRTC regression. Text mode validates tools and UI; audio mode uses synthetic Chinese speech.
const fs=require('node:fs');
const {execFileSync}=require('node:child_process');
const audioMode=process.env.REPRO_AUDIO==='1',allowRecovery=process.env.REPRO_ALLOW_RECOVERY==='1';
const assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base=process.env.BANK_TEST_URL||'http://127.0.0.1:5180';
const out=process.env.REPRO_REPORT||`work/risk-live-${Date.now()}.json`;
fs.mkdirSync(require('node:path').dirname(out),{recursive:true});
const report={startedAt:new Date().toISOString(),url:base,scenario:process.env.REPRO_SCENARIO||'smoke',allowRecovery,keepAwake:process.env.BANK_TEST_KEEP_AWAKE==='1',forcedNoTools:process.env.REPRO_NO_TOOLS==='1',outputMode:process.env.REPRO_TEXT_ONLY==='1'?'text-only control; not audio playback':'native text and audio',inputMode:audioMode?'synthetic Chinese audio through real WebRTC microphone and ASR; not human speech':'keyboard through real realtime session; no ASR',sessions:[]};
const compact=s=>{const t=s?.workflows?.tasks?.find(t=>t.id===s.workflows.currentTaskId);return {revision:s?.revision,view:s?.view,plan:s?.plan&&{id:s.plan.id,currentTaskId:s.plan.currentTaskId,taskIds:s.plan.taskIds,tasks:s.plan.steps.map(x=>({taskId:x.taskId||x.id,functionId:x.functionId,status:x.status}))},task:t&&{id:t.id,functionId:t.functionId,status:t.status,params:t.params,missing:t.missing,message:t.message},riskProfilePresent:!!s?.workflows?.riskProfile};};
const save=()=>fs.writeFileSync(out,JSON.stringify(report,(key,value)=>/^(token|confirmationToken|verificationId)$/.test(key)?'[redacted]':typeof value==='string'?value.replace(/(\"(?:token|confirmationToken|verificationId)\"\s*:\s*\")[^\"]*\"/g,'$1[redacted]\"'):value,2));
const longScenario=process.env.REPRO_SCENARIO==='long'?require('./risk-long-scenario.cjs'):process.env.REPRO_SCENARIO==='plan'?require('./plan-scenario.cjs'):process.env.REPRO_SCENARIO==='handoff'?[{input:'确认当前风险测评信息，请提交这份测评。',confirmed:true,current:'SU01',planStatus:'complete'}]:null;
const inputs=longScenario?longScenario.map(t=>t.input):process.env.REPRO_INPUTS?JSON.parse(process.env.REPRO_INPUTS):['查询一下理财产品','我有没有做过风险测评？','好，开始做风险测评','第一题选三','第二题选二','第三题选一','确认当前信息'];
(async()=>{
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
try{
 for(let attempt=0;attempt<Number(process.env.REPRO_ATTEMPTS||1);attempt++){
  const context=await browser.newContext({viewport:{width:1100,height:950}});const page=await context.newPage();page.setDefaultTimeout(15000);
  const s={assessmentId:null,goalId:null,freezeId:null,expectedAnswers:[],queryFailures:[],attempt:attempt+1,turns:[],requests:[],responses:[],pageErrors:[],handoffs:[],reviews:[]};report.sessions.push(s);let turn=-1,previousTranscript=[];const reviewTurns=new WeakMap();
  page.on('pageerror',e=>s.pageErrors.push(e.message));
  page.on('request',r=>{if(new URL(r.url()).pathname==='/api/bank/review'&&r.method()==='POST')reviewTurns.set(r,turn);});
  page.on('response',async r=>{if(new URL(r.url()).pathname==='/api/bank/review'&&r.request().method()==='POST'){try{const request=r.request().postDataJSON(),response=await r.json();s.reviews.push({turn:reviewTurns.get(r.request()),requestId:request.requestId,turnId:request.review.turnId,reply:request.review.reply,http:r.status(),decision:response.decision});}catch{}}});
  page.on('response',async r=>{if(new URL(r.url()).pathname==='/api/live/context'){try{const d=await r.json();s.handoffs.push({turn,http:r.status(),revision:d.revision,summaryUsed:d.summaryUsed,contextBytes:new TextEncoder().encode(d.context||'').length});}catch{}}});
  page.on('request',r=>{if(new URL(r.url()).pathname==='/api/bank'&&r.method()==='POST'){try{const b=r.postDataJSON();if(b.recovery)s.requests.push({turn,recovery:{reason:b.recovery.reason,utterance:b.recovery.utterance,attempts:b.recovery.attempts}});if(b.tool)s.requests.push({turn,origin:String(b.requestId||'').startsWith('voice-literal-')?'literal':'native',tool:b.tool.name,args:b.tool.arguments,utterance:b.tool.utterance});}catch{}}});
  page.on('response',async r=>{if(['/api/bank','/api/bank/review'].includes(new URL(r.url()).pathname)&&r.request().method()==='POST'){const n=turn;try{const b=await r.json();s.responses.push({turn:n,http:r.status(),error:b.error,state:compact(b.state),completedTasks:b.state?.workflows?.tasks.filter(t=>t.status==='complete').map(t=>({id:t.id,functionId:t.functionId,params:t.params}))});}catch{}}});
  await page.addInitScript(({noTools,textOnly})=>{
   const t=window.__repro={events:[],usage:[],asr:[],assistant:[],calls:[],outputs:[],errors:[],active:false,done:0,channels:[],tracks:[],models:[]};
   const observe=ch=>{t.channels.push(ch);const send=ch.send.bind(ch);ch.send=data=>{try{const e=JSON.parse(data);if(textOnly&&e.type==='session.update'){e.session.modalities=['text'];data=JSON.stringify(e);}if(noTools&&e.type==='session.update'&&e.session.tools){e.session.tools=[];data=JSON.stringify(e);}if(e.item?.type==='function_call_output')t.outputs.push({call_id:e.item.call_id,output:e.item.output});}catch{}send(data);};ch.addEventListener('message',msg=>{try{const e=JSON.parse(msg.data);t.events.push(e.type);if(e.type==='session.created'||e.type==='session.updated'){if(e.session?.model)t.models.push(e.session.model);}if(e.type==='conversation.item.input_audio_transcription.completed')t.asr.push(e.transcript);if(e.type==='response.created')t.active=true;if(e.type==='response.done'){t.active=false;t.done++;t.usage.push({responseId:e.response?.id,status:e.response?.status,usage:e.response?.usage||e.usage});}if(e.type==='response.audio_transcript.done'||e.type==='response.text.done')t.assistant.push(e.transcript||e.text);if(e.type==='response.output_item.done'&&e.item?.type==='function_call')t.calls.push({name:e.item.name,arguments:e.item.arguments,call_id:e.item.call_id});if(e.type==='error')t.errors.push({code:e.error?.code,message:e.error?.message});}catch{}});};
   const RTC=window.RTCPeerConnection;window.RTCPeerConnection=class extends RTC{constructor(...a){super(...a);this.addEventListener('datachannel',e=>observe(e.channel));}createDataChannel(...a){const ch=super.createDataChannel(...a);observe(ch);return ch;}};
   navigator.mediaDevices.getUserMedia=async()=>{const ctx=t.audio=new AudioContext();await ctx.resume();const dest=ctx.createMediaStreamDestination();t.tracks.push(...dest.stream.getTracks());t.play=async base64=>{const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));const b=await ctx.decodeAudioData(bytes.buffer),source=ctx.createBufferSource();source.buffer=b;source.connect(dest);source.start();};return dest.stream;};
  },{noTools:process.env.REPRO_NO_TOOLS==='1',textOnly:process.env.REPRO_TEXT_ONLY==='1'});
  try{
   if(process.env.REPRO_SEED==='explanation'){
    let state=(await(await page.request.get(base+'/api/bank')).json()).state;const post=async(args,utterance,name='bank_function')=>{const r=await page.request.post(base+'/api/bank',{data:{requestId:crypto.randomUUID(),revision:state.revision,tool:{name,arguments:args,utterance}}});assert.equal(r.status(),200);state=(await r.json()).state;};
    await post({operation:'create',functionId:'IN05'},'开始风险测评','bank_plan');const taskId=state.workflows.currentTaskId;await post({operation:'amend',taskId,params:{answers:[3,0,0]}},'第一题选三');await post({operation:'amend',taskId,params:{answers:[3,2,0]}},'第二题选二');s.assessmentId=taskId;s.expectedAnswers=[3,2,0];s.seedRevision=state.revision;
   }
   if(process.env.REPRO_SEED==='freeze-review'){
    const d=await(await page.request.get(base+'/api/bank')).json();const r=await page.request.post(base+'/api/bank',{data:{requestId:crypto.randomUUID(),revision:d.state.revision,tool:{name:'bank_plan',arguments:{operation:'create',functionId:'CA06',params:{cardId:'card-daily',action:'freeze'}},utterance:'准备临时冻结日常借记卡的草稿，不确认或执行。'}}});assert.equal(r.status(),200);assert.equal(compact((await r.json()).state).task.status,'review');
   }
   if(process.env.REPRO_SEED==='plan-review'){
    const d=await(await page.request.get(base+'/api/bank')).json();
    const r=await page.request.post(base+'/api/bank',{data:{requestId:crypto.randomUUID(),revision:d.state.revision,tool:{name:'bank_plan',arguments:{operation:'create'},utterance:'先做风险测评，然后查询订阅清单。'}}});assert.equal(r.status(),200);
    const seeded=(await r.json()).state,id=compact(seeded).task.id;
    const saved=await page.request.post(base+'/api/bank',{data:{requestId:crypto.randomUUID(),revision:seeded.revision,tool:{name:'bank_function',arguments:{operation:'amend',taskId:id,params:{answers:[3,2,1]}},utterance:'三题答案是3、2、1'}}});assert.equal(saved.status(),200);assert.equal(compact((await saved.json()).state).task.status,'review');
    s.assessmentId=id;s.expectedAnswers=[3,2,1];
   }
   if(['assessment','review'].includes(process.env.REPRO_SEED)){const r=await page.request.get(base+'/api/bank'),d=await r.json();await page.request.post(base+'/api/bank',{data:{requestId:crypto.randomUUID(),revision:d.state.revision,tool:{name:'bank_function',arguments:{operation:'run',functionId:'IN05',...(process.env.REPRO_SEED==='review'?{params:{answers:[3,2,1]}}:{})},utterance:process.env.REPRO_SEED==='review'?'测评答案是3、2、1':'开始做风险测评'}}});}
   await page.goto(base,{waitUntil:'domcontentloaded'});
   s.initial=compact((await(await page.request.get(base+'/api/bank')).json()).state);
   if(audioMode)await page.getByRole('button',{name:'开始语音对话',exact:true}).click();
   else await page.getByRole('group',{name:'对话方式'}).getByRole('button',{name:'语音',exact:true}).click();
   await page.waitForFunction(()=>window.__repro.events.includes('session.updated'),null,{timeout:45000});
   if(!audioMode)await page.getByLabel('输入你的要求',{exact:true}).waitFor();
   for(turn=0;turn<inputs.length;turn++){
    const beforeRequests=s.requests.length,beforeResponses=s.responses.length,beforeCompleted=new Set(s.responses.flatMap(r=>r.completedTasks||[]).map(t=>t.id));const before=await page.evaluate(()=>({done:window.__repro.done,assistant:window.__repro.assistant.length,calls:window.__repro.calls.length,outputs:window.__repro.outputs.length,asr:window.__repro.asr.length,usage:window.__repro.usage.length}));
    if(audioMode){fs.mkdirSync('work/synthetic',{recursive:true});const wav=`work/synthetic/${process.pid}-${turn}.wav`;execFileSync('say',['-v','Tingting','-o',wav,'--file-format=WAVE','--data-format=LEI16@24000',inputs[turn]],{timeout:20000});await page.evaluate(data=>window.__repro.play(data),fs.readFileSync(wav).toString('base64'));}
    else{await page.getByLabel('输入你的要求',{exact:true}).fill(inputs[turn]);await page.getByRole('button',{name:'发送',exact:true}).click();}
    const began=Date.now();let quiet=0,lastSignature='',lastPoll=began;
    while(Date.now()-began<75000){await page.waitForTimeout(500);const p=await page.evaluate(()=>({done:window.__repro.done,active:window.__repro.active,calls:window.__repro.calls.length,outputs:window.__repro.outputs.length,assistant:window.__repro.assistant.length,busy:document.querySelector('.status-line')?.textContent?.includes('正在办理')}));const now=Date.now();if(now-lastPoll>15000){s.environmentInterruption={turn:turn+1,gapMs:now-lastPoll};throw new Error('test process/browser paused for over 15 seconds; inconclusive for model-stall attribution');}lastPoll=now;const sig=JSON.stringify(p);quiet=sig===lastSignature?quiet+1:0;lastSignature=sig;if((p.assistant>before.assistant||s.reviews.some(r=>r.turn===turn&&r.http===200&&r.decision==='accept')||s.requests.slice(beforeRequests).some(r=>r.origin==='literal')&&s.responses.length>beforeResponses)&&!p.active&&!p.busy&&quiet>=6)break;}
    const state=(await(await page.request.get(base+'/api/bank')).json()).state;
    const event=await page.evaluate(before=>({usage:window.__repro.usage.slice(before.usage),asr:window.__repro.asr.slice(before.asr),assistant:window.__repro.assistant.slice(before.assistant),calls:window.__repro.calls.slice(before.calls),outputs:window.__repro.outputs.slice(before.outputs).map(x=>{try{const r=JSON.parse(x.output);return {call_id:x.call_id,view:r.view,status:r.status,workflow:r.workflow&&{functionId:r.workflow.functionId,status:r.workflow.status,missing:r.workflow.missing,checklist:r.workflow.checklist,message:r.workflow.message}};}catch{return {call_id:x.call_id};}})}),before);
    if(!longScenario&&inputs[turn]==='第三题选一'){await page.getByRole('button',{name:'修改信息',exact:true}).click();await page.locator('.flow-questionnaire').waitFor();}
    const dom=await page.evaluate(()=>{const c=document.querySelector('section[aria-label="功能办理卡片"]');return {title:c?.querySelector('h2')?.textContent,visible:!!c?.getClientRects().length,questionnaireVisible:!!document.querySelector('.flow-questionnaire')?.getClientRects().length,questions:[...document.querySelectorAll('.flow-questionnaire .choice-list')].map(x=>({question:x.getAttribute('aria-label'),value:x.querySelector('[aria-checked="true"]')?.dataset.value||'',options:[...x.querySelectorAll('[role=radio]')].map(o=>o.textContent)}))};});
    const current=state.workflows?.tasks.find(t=>t.id===state.workflows.currentTaskId);
    if(!longScenario&&/开始做风险测评/.test(inputs[turn])){assert.equal(current?.functionId,'IN05');assert.equal(current.status,'collecting');assert.equal(dom.questionnaireVisible,true);assert.equal(dom.questions.length,3);assert.ok(dom.questions.every(q=>q.options.length===5));}
    const answerIndex=['第一题选三','第二题选二','第三题选一'].indexOf(inputs[turn]);
    if(!longScenario&&answerIndex>=0){assert.deepEqual(current?.params.answers,[[3,0,0],[3,2,0],[3,2,1]][answerIndex]);assert.equal(current.status,answerIndex===2?'review':'collecting');assert.equal(state.workflows.riskProfile,null);assert.equal(dom.questionnaireVisible,true);}
    if(!longScenario&&inputs[turn]==='第三题选一'){assert.deepEqual(dom.questions.map(q=>q.value),['3','2','1']);await page.getByRole('button',{name:'放弃修改',exact:true}).click();await page.getByRole('button',{name: /^手动确认/}).waitFor();}
    if(!longScenario&&inputs[turn]==='确认当前信息'){assert.equal(current?.status,'complete');assert.ok(state.workflows.riskProfile);assert.ok(event.assistant.some(x=>/测评/.test(x)));}
    const connection=await page.evaluate(()=>({channels:window.__repro.channels.map(c=>c.readyState),errors:window.__repro.errors,notice:document.querySelector('[role="alert"]')?.textContent}));
    await page.getByRole('button',{name:'设置与连接',exact:true}).click();
    await page.getByRole('region',{name:'设置'}).getByRole('button',{name:'对话记录',exact:true}).click();
    const history=page.getByRole('region',{name:'对话记录'}),messages=history.locator('.message');
    const rows=await messages.evaluateAll(nodes=>nodes.map(node=>({speaker:node.getAttribute('aria-label'),text:node.textContent})));
    let overlap=Math.min(previousTranscript.length,rows.length);while(overlap&&!previousTranscript.slice(-overlap).every((row,i)=>row.speaker===rows[i].speaker&&row.text===rows[i].text))overlap--;const added=rows.slice(overlap);previousTranscript=rows;
    const lastUser=added.findLastIndex(row=>row.speaker==='你');
    const finalAssistant=lastUser<0?null:added.slice(lastUser+1).filter(row=>row.speaker==='知行').at(-1);
    const candidates=s.reviews.filter(r=>r.turn===turn&&r.http===200&&r.decision==='accept'&&r.reply&&r.turnId);
    const heard=lastUser>=0&&(!audioMode?added[lastUser].text===inputs[turn]:true)&&finalAssistant&&candidates.some(r=>r.reply===finalAssistant.text)?finalAssistant.text:null;
    await history.getByRole('button',{name:'返回',exact:true}).click();
    if(process.env.REPRO_REQUIRE_VERIFIED==='1')assert.ok(heard,'no verified answer for the user turn');
    if(process.env.REPRO_REQUIRE_VERIFIED==='1'&&/看看我的两个账户余额/.test(inputs[turn]))for(const account of state.accounts){assert.ok((heard||'').includes(account.name),'balance answer omitted an account');const value=account.balance/100;assert.ok((heard||'').replaceAll(',','').includes(String(value))||(value>=10000&&(heard||'').includes(String(value/10000)+'万')),'balance answer omitted the actual amount');}
    if(process.env.REPRO_REQUIRE_VERIFIED==='1'&&longScenario){
     const step=longScenario[turn],id=step.readFunction,ids=step.readFunctions||[id];
     if(['CA01','SU01','IN06'].includes(id)){const rows=id==='CA01'?state.workflows.records.cards:id==='SU01'?state.workflows.records.subscriptions:state.workflows.records.products;assert.ok(rows.some(row=>(heard||'').includes(row.name)||(row.tail&&(heard||'').includes(row.tail))),'query answer contains no actual result item');if(id==='CA01')assert.match(heard||'',/正常|活跃|受限|限制|冻结|挂失|停用/);}
     if(ids.some(id=>['BI01','BI02'].includes(id)))assert.ok(/\d+(?:\.\d+)?(?:元|块)|没有.*(?:记录|支出|流水)|暂无/.test(heard||''),'bill answer omitted actual amounts or an empty result');
    }
    if(process.env.REPRO_SEED==='explanation'||/只比较.*现金基金.*债券基金/.test(inputs[turn])){
     if(process.env.REPRO_REQUIRE_VERIFIED==='1'){assert.match(heard||'',/现金|货币/);assert.match(heard||'',/债券/);assert.ok(/货币|短期工具/.test(heard||'')||/(?:低风险|风险(?:等级)?[为是]?1|等级1)/.test(heard||'')&&/(?:中风险|风险(?:等级)?[为是]?3|等级3)/.test(heard||''),'comparison has no grounded type or risk difference');assert.ok(!/第[123一二三]题|继续.*测评|先完成.*测评/.test(heard||''),'product explanation was replaced by the pending assessment');}
    }
    if(process.env.REPRO_SEED==='explanation'){
     const task=state.workflows.tasks.find(t=>t.id===s.assessmentId);assert.deepEqual(task.params.answers,[3,2,0]);assert.equal(task.status,'collecting');assert.equal(state.workflows.records.questionnaires.length,0);assert.equal(state.receipts.length,0);
    }
    const observation={elapsedMs:Date.now()-began,input:inputs[turn],state:compact(state),dom,connection,verifiedReply:heard,...event};
    if(longScenario){
     const step=longScenario[turn];
     if(step.readFunction||step.readFunctions){const functions=step.readFunctions||[step.readFunction];observation.queryPassed=s.responses.slice(beforeResponses).some(r=>r.http===200&&r.completedTasks?.some(t=>!beforeCompleted.has(t.id)&&functions.includes(t.functionId)&&(!step.readAction||t.params.action===step.readAction)&&Object.entries(step.readParams||{}).every(([key,value])=>t.params[key]===value)));if(!observation.queryPassed)s.queryFailures.push({turn:turn+1,input:inputs[turn],expectedFunction:functions});}
     if(step.assessment!==undefined){if(!s.assessmentId)s.assessmentId=current?.id;s.expectedAnswers=step.assessment;}
     if(step.goal!==undefined){if(!s.goalId)s.goalId=current?.id;s.expectedGoal=step.goal;}
     if(step.freeze&&!s.freezeId)s.freezeId=current?.id;
     if(step.confirmed)s.expectedConfirmed=true;if(step.goalCancelled)s.goalCancelled=true;if(step.freezeCancelled)s.freezeCancelled=true;
     const assessment=state.workflows.tasks.find(t=>t.id===s.assessmentId),goal=state.workflows.tasks.find(t=>t.id===s.goalId),freeze=state.workflows.tasks.find(t=>t.id===s.freezeId);
     observation.checkpoint={assessment:assessment&&{id:assessment.id,status:assessment.status,answers:assessment.params.answers},goal:goal&&{id:goal.id,status:goal.status,params:goal.params},freeze:freeze&&{id:freeze.id,status:freeze.status}};
     try{
      assert.ok(connection.channels.includes('open')||allowRecovery&&!!heard,'real-time connection ended without a verified recovery receipt');
      assert.ok(event.usage.length||s.requests.slice(beforeRequests).some(r=>r.origin==='literal'),'no completed real-time response or literal operation');
      if(step.planTasks){assert.deepEqual(state.plan?.steps.map(x=>x.functionId),step.planTasks,'outer task order');assert.equal(state.plan.taskIds.length,step.planTasks.length);s.planId=state.plan.id;}
      if(s.planId)assert.equal(state.plan?.id,s.planId,'an interruption created another Plan');
      if(step.planStatus)assert.equal(state.plan?.status,step.planStatus,'outer plan did not advance');
      if(step.current)assert.equal(current?.functionId,step.current,'wrong active business');
      if(step.currentOneOf){assert.ok(step.currentOneOf.includes(current?.functionId),'wrong pending business');assert.equal(current?.id,state.plan.steps.find(t=>!['complete','cancelled'].includes(t.status))?.taskId,'focus must follow the actual saved queue');}
      if(s.assessmentId){assert.ok(assessment,'original assessment disappeared');assert.deepEqual(assessment.params.answers||[],s.expectedAnswers,'saved answers changed or were not saved');assert.equal(assessment.status,s.expectedConfirmed?'complete':s.expectedAnswers.length===3&&s.expectedAnswers.every(Boolean)?'review':'collecting');assert.equal(state.workflows.records.questionnaires.length,s.expectedConfirmed?1:0,'unexpected assessment submission');}
      if(step.current==='IN05'&&s.assessmentId){assert.equal(current.id,s.assessmentId,'duplicate questionnaire');assert.equal(dom.visible,true,'assessment card did not resume');if(!s.expectedConfirmed)assert.equal(dom.questionnaireVisible,true,'questionnaire is not visible');}
      if(s.goalId){assert.equal(goal?.params.name,'读书计划');assert.equal(goal?.params.target,s.expectedGoal);assert.equal(goal?.status,s.goalCancelled?'cancelled':'review');}
      if(step.current==='IN01')assert.equal(current?.id,s.goalId,'duplicate goal draft');
      if(s.freezeId){assert.equal(freeze?.params.cardId,'card-daily');assert.equal(freeze?.status,s.freezeCancelled?'cancelled':'review');}
      if(step.current==='CA06')assert.equal(current?.id,s.freezeId,'duplicate freeze draft');
      assert.equal(state.workflows.records.cards.find(c=>c.id==='card-daily').status,'active','card changed without authorization');
      assert.equal(state.receipts.length,0,'unexpected transfer');assert.equal(state.workflows.records.goals.some(g=>g.name==='读书计划'),false,'goal executed without confirmation');
     }catch(error){s.turns.push({...observation,passed:false,error:error.message});save();throw error;}
     observation.passed=true;
    }
    s.turns.push(observation);save();console.log(JSON.stringify({attempt:attempt+1,turn,input:inputs[turn],state:compact(state),dom,assistant:event.assistant,calls:event.calls}));
   }
   if(process.env.REPRO_SEED==='freeze-review'){
    const final=(await(await page.request.get(base+'/api/bank')).json()).state;assert.equal(final.workflows.tasks.find(t=>t.id===s.initial.task.id)?.status,'cancelled');assert.equal(final.workflows.records.cards.find(c=>c.id==='card-daily').status,'active');assert.equal(s.requests.filter(r=>r.origin==='literal'&&r.args.operation==='cancel').length,1);assert.equal(s.requests.filter(r=>r.origin==='native').length,0);s.cancellationCheck={status:'cancelled',card:'active',literal:1,native:0};
   }
   if(process.env.REPRO_QUERY_FAULT==='1'){
    const final=(await(await page.request.get(base+'/api/bank')).json()).state,original=final.workflows.tasks.find(t=>t.id===s.initial.task.id);
    assert.ok(original,'query repair lost the original assessment');assert.equal(original.status,'collecting');assert.deepEqual(original.params.answers||[],s.initial.task.params.answers||[]);assert.equal(final.workflows.records.questionnaires.length,0);assert.equal(final.receipts.length,0);assert.equal(final.workflows.tasks.filter(t=>t.functionId==='TR02'&&t.status==='complete').length,1);s.queryFaultCheck={originalTaskPreserved:true,questionnaires:0,transfers:0,completedBalanceQueries:1};
   }
   if(s.queryFailures.length)s.failure=`${s.queryFailures.length} requested queries did not return the expected business result`;
   await page.screenshot({path:`${out.replace(/\.json$/,'')}-attempt-${attempt+1}.png`,fullPage:true});
  }catch(e){s.failure=e.message;await page.screenshot({path:`${out.replace(/\.json$/,'')}-failure-${attempt+1}.png`,fullPage:true}).catch(()=>{});console.log(JSON.stringify({attempt:attempt+1,failure:e.message}));}
  finally{await page.getByRole('button',{name:'结束语音',exact:true}).click({timeout:5000}).catch(()=>{});s.transport=await page.evaluate(()=>({models:window.__repro.models,usage:window.__repro.usage,errors:window.__repro.errors,events:window.__repro.events.reduce((a,k)=>(a[k]=(a[k]||0)+1,a),{}),tracksEnded:window.__repro.tracks.every(t=>t.readyState==='ended'),diagnostics:JSON.parse(sessionStorage.getItem('zx_voice_diagnostics')||'[]'),explanationFault:window.__explanationFault?.injected})).catch(()=>null);if(process.env.REPRO_SNAPSHOT_ONLY==='1'&&!s.failure&&!s.transport?.diagnostics.some(d=>d.reason==='final_snapshot_restored'))s.failure='the final snapshot restoration path was not observed';await context.close();save();}
 }
}finally{report.finishedAt=new Date().toISOString();report.status=report.sessions.some(s=>s.environmentInterruption)?'inconclusive':report.sessions.some(s=>s.failure)?'failed':'passed';if(report.status!=='passed')process.exitCode=report.status==='inconclusive'?2:1;save();await browser.close();}
})().catch(e=>{report.failure=e.message;save();console.error(e.message);process.exitCode=1;});
