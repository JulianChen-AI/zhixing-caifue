// Production local worker + local D1 + real mobile UI. No model calls.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base=process.env.BANK_TEST_URL||'http://127.0.0.1:5176',out=path.resolve('outputs','plans-'+new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const report={realProvider:false,realHttp:true,realDatabase:true,cases:[]};
 try{for(const scenario of ['simple','fraction','clarification','failure','paused-amend','derived-note','confirmation-guards']){
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),entry={scenario,status:'running',errors:[],http:[]};report.cases.push(entry);page.on('pageerror',e=>entry.errors.push(e.message));page.on('response',r=>{if(r.url().endsWith('/api/bank')&&r.request().method()==='POST')entry.http.push(r.status());});
  const state=async()=>{const r=await page.request.get(base+'/api/bank');assert.equal(r.status(),200);return(await r.json()).state;};
  const post=async(payload,status=200)=>{const s=await state(),r=await page.request.post(base+'/api/bank',{data:{...payload,requestId:crypto.randomUUID(),revision:s.revision}}),b=await r.json();assert.equal(r.status(),status,JSON.stringify(b));return b.state;};
  const finish=async()=>{await page.getByRole('button',{name: /^手动确认/}).click();await page.getByLabel('功能演示验证码',{exact:true}).fill('123456');await page.getByRole('button',{name:'验证并办理',exact:true}).click();};
  try{
   if(scenario==='simple'){
    const s=await post({command:'从日常账户给室友转500元',mode:'demo'});assert.equal(s.plan,undefined);assert.equal(s.task.amount,50000);
    await page.goto(base,{waitUntil:'networkidle'});assert.equal(await page.getByLabel('复杂任务步骤',{exact:true}).count(),0);await page.getByLabel('转账金额',{exact:true}).waitFor();
   }else if(scenario==='fraction'){
    let s=await post({tool:{name:'bank_request',arguments:{operation:'update_transfer',amount:1},utterance:'我要转账，给尾号6688的那个张三，然后转余额比较小的那个账户的三分之一余额。',turnId:'initial-fraction'}});
    assert.equal(s.task.amount,428833);assert.equal(s.plan.steps.length,3);const planId=s.plan.id,childId=s.plan.steps[2].taskId;
    await page.goto(base,{waitUntil:'networkidle'});await page.getByLabel('复杂任务步骤',{exact:true}).waitFor();assert.equal(await page.locator('.plan-steps li[data-status="complete"]').count(),2);
    await page.screenshot({path:path.join(out,'fraction-review.png'),fullPage:true});await page.reload({waitUntil:'networkidle'});s=await state();assert.equal(s.plan.id,planId);assert.equal(s.plan.steps[2].taskId,childId);
    await finish();await page.waitForFunction(()=>document.querySelectorAll('.plan-steps li[data-status="complete"]').length===3);s=await state();assert.equal(s.plan.status,'complete');assert.equal(s.receipts.length,1);assert.equal(s.receipts[0].amount,428833);
   }else if(scenario==='clarification'){
    let s=await post({command:'我要从日常账户先给室友张三转500元，然后再拿剩下的500，整理一下材料。',mode:'demo'});assert.equal(s.plan.status,'collecting');assert.equal(s.task,null);
    await page.goto(base,{waitUntil:'networkidle'});await page.getByLabel('补充步骤用途',{exact:true}).fill('把500元存入旅行目标，用日常账户');await page.getByRole('button',{name:'补充这一步',exact:true}).click();
    await page.getByRole('button',{name: /^手动确认/}).waitFor();await finish();await page.waitForFunction(()=>document.querySelectorAll('.plan-steps li[data-status="complete"]').length===1);
    s=await state();assert.equal(s.receipts.length,1);assert.equal(s.plan.steps[1].status,'review');const firstId=s.plan.steps[0].taskId,t=s.workflows.tasks.find(t=>t.id===s.plan.steps[1].taskId);
    await post({tool:{name:'bank_function',arguments:{operation:'confirm',taskId:t.id,token:t.reviewToken},utterance:'确认',turnId:s.plan.steps[1].openedTurnId}},400);
    await page.reload({waitUntil:'networkidle'});assert.equal((await state()).plan.steps[0].taskId,firstId);await page.screenshot({path:path.join(out,'second-step.png'),fullPage:true});
    await finish();await page.waitForFunction(()=>document.querySelectorAll('.plan-steps li[data-status="complete"]').length===2);s=await state();assert.equal(s.plan.status,'complete');assert.equal(s.accounts[0].balance,1186500);assert.equal(s.workflows.records.goals[0].balance,50000);
   }else if(scenario==='failure'){
    let s=await post({command:'先查余额，然后从日常账户给室友转20000元，然后查账单',mode:'demo'});assert.equal(s.plan.status,'blocked');assert.equal(s.plan.steps[2].taskId,undefined);const firstId=s.plan.steps[0].taskId;
    await page.goto(base,{waitUntil:'networkidle'});await page.getByLabel('金额（元）',{exact:true}).fill('500');await page.getByRole('button',{name:'保存修改',exact:true}).click();await page.getByRole('button',{name: /^手动确认/}).waitFor();
    await page.getByRole('button',{name:'暂停任务',exact:true}).click();await page.getByRole('button',{name:'继续任务',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name: /^手动确认/}).isDisabled(),true);
    await page.getByRole('button',{name:'继续任务',exact:true}).click();await page.getByRole('button',{name:'暂停任务',exact:true}).waitFor();s=await state();assert.equal(s.plan.steps[0].taskId,firstId);
    await page.getByRole('button',{name:'取消剩余步骤',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.plan-steps li[data-status="cancelled"]').length===2);s=await state();assert.equal(s.receipts.length,0);assert.equal(s.accounts[0].balance,1286500);
   }else if(scenario==='paused-amend'){
    let s=await post({command:'先从日常账户给室友转500元，然后从储蓄账户给李四转300元',mode:'demo'});
    await page.goto(base,{waitUntil:'networkidle'});await page.getByRole('button',{name:'暂停任务',exact:true}).click();await page.getByRole('button',{name:'继续任务',exact:true}).waitFor();
    s=await post({action:{type:'plan',command:{operation:'amend',planId:s.plan.id,stepId:s.plan.steps[1].id,params:{amount:200}}}});assert.equal(s.plan.status,'paused');assert.equal(s.plan.steps[1].taskId,undefined);
    await page.reload({waitUntil:'networkidle'});assert.equal(await page.getByRole('button',{name: /^手动确认/}).isDisabled(),true);
    await page.getByRole('button',{name:'继续任务',exact:true}).click();await page.getByRole('button',{name:'暂停任务',exact:true}).waitFor();await finish();await page.waitForFunction(()=>document.querySelectorAll('.plan-steps li[data-status="complete"]').length===1);
    s=await state();const t=s.workflows.tasks.find(t=>t.id===s.plan.steps[1].taskId);assert.equal(t.params.amount,200);await finish();await page.waitForFunction(()=>document.querySelectorAll('.plan-steps li[data-status="complete"]').length===2);assert.equal((await state()).receipts.length,2);
   }else if(scenario==='derived-note'){
    let s=await post({command:'从日常账户给室友转余额的三分之一',mode:'demo'});const step=s.plan.steps[2],binding=step.binding;
    s=await post({action:{type:'plan',command:{operation:'amend',planId:s.plan.id,stepId:step.id,params:{amount:4288.33,note:'饭钱'}}}});assert.equal(s.plan.steps[2].binding,binding);
    await page.goto(base,{waitUntil:'networkidle'});await finish();await page.waitForFunction(()=>document.querySelectorAll('.plan-steps li[data-status="complete"]').length===3);s=await state();assert.equal(s.receipts.length,1);assert.equal(s.receipts[0].amount,428833);assert.equal(s.task.note,'饭钱');
   }else{
    for(const ratio of ['0.001%','.5%','负三分之一','3.1分之一','1/3e2']){const before=await state();await post({command:'从日常账户给室友转余额的'+ratio,mode:'demo'},400);assert.equal((await state()).revision,before.revision);}
    let s=await post({tool:{name:'bank_plan',arguments:{operation:'create'},utterance:'先从日常账户给室友转500元，然后从储蓄账户给李四转300元，然后从日常账户给室友转200元',turnId:'create-plan'}});
    s=await post({tool:{name:'bank_plan',arguments:{operation:'amend',planId:s.plan.id,stepId:s.plan.steps[0].id,params:{amount:400}},utterance:'改成400元',turnId:'edit-first'}});
    const task=()=>s.workflows.tasks.find(t=>t.id===s.plan.steps.find(x=>x.status!=='complete').taskId);
    const voiceConfirm=async(turnId,status=200)=>{const t=task();return post({tool:{name:'bank_function',arguments:{operation:'confirm',taskId:t.id,token:t.reviewToken},utterance:'确认',turnId}},status);};
    for(const turnId of ['first-confirm','second-confirm']){s=await voiceConfirm(turnId);const t=task();s=await post({action:{type:'workflow',command:{operation:'authenticate',taskId:t.id,token:t.verificationId,code:'123456'}}});}
    await page.goto(base,{waitUntil:'networkidle'});await page.reload({waitUntil:'networkidle'});const before=await state();for(const oldTurn of ['first-confirm','create-plan','edit-first'])await voiceConfirm(oldTurn,400);assert.equal((await state()).revision,before.revision);
    for(const utterance of ['不用取消','不必取消','不要不办了'])await post({tool:{name:'bank_plan',arguments:{operation:'cancel',planId:s.plan.id},utterance}},400);
    assert.equal((await state()).receipts.length,2);await finish();await page.waitForFunction(()=>document.querySelectorAll('.plan-steps li[data-status="complete"]').length===3);assert.equal((await state()).receipts.length,3);
   }
   assert.deepEqual(entry.errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,'mobile content must not overflow horizontally');entry.status='passed';console.log(scenario+': passed');
  }catch(e){entry.status='failed';entry.failure=e.message;process.exitCode=1;await page.screenshot({path:path.join(out,scenario+'-failure.png'),fullPage:true}).catch(()=>{});console.log(scenario+': '+e.message);}
  finally{await context.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));}
 }}finally{await browser.close();console.log('Report: '+path.join(out,'report.json'));}
})().catch(e=>{console.error(e.message);process.exitCode=1});
