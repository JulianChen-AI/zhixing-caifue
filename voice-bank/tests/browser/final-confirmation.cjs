// Isolated synthetic sessions; real page/HTTP/database, no provider or historical-user reads.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base=process.env.BANK_TEST_URL||'http://127.0.0.1:5176',out=path.resolve('outputs','final-confirmation-'+new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:process.env.BANK_TEST_DIRECT==='1'?['--no-proxy-server']:[]});
 const report={base,realProvider:false,realHttp:true,realDatabase:true,cases:[]};
 try{for(const scenario of ['semantic-review-card','bond-text-confirmation','bond-native-confirmation','freeze-alias','freeze-text-selection','card-confirmation']){
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),entry={scenario,status:'running',errors:[]};page.setDefaultTimeout(10000);report.cases.push(entry);page.on('pageerror',e=>entry.errors.push(e.message));
  const state=async()=>{const r=await page.request.get(base+'/api/bank');assert.equal(r.status(),200);return(await r.json()).state;};
  const post=async(payload,status=200)=>{const s=await state(),r=await page.request.post(base+'/api/bank',{data:{...payload,requestId:crypto.randomUUID(),revision:s.revision}}),body=await r.json();assert.equal(r.status(),status,body.error||'Unexpected HTTP result');return body.state;};
  const current=s=>s.workflows.tasks.find(t=>t.id===s.workflows.currentTaskId);
  const tool=(args,utterance)=>post({tool:{name:'bank_function',arguments:args,utterance,turnId:crypto.randomUUID()}});
  const card=command=>post({action:{type:'workflow',command}});
  const bond=async()=>{let s=await card({operation:'run',functionId:'IN05',params:{answers:[3,3,3]}});s=await card({operation:'confirm',taskId:current(s).id,token:current(s).reviewToken});return tool({operation:'run',functionId:'IN08',params:{accountId:'daily',productId:'fund-bond',amount:100}},'从日常账户申购演示债券基金100元');};
  const auth=async()=>{await page.getByLabel('功能演示验证码',{exact:true}).fill('123456');await page.getByRole('button',{name:'验证并办理',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.workflow-card .card-top span')?.textContent==='办理结果');};
  try{
   if(scenario==='semantic-review-card'){
    let s=await tool({operation:'run',functionId:'TR03',params:{recipientId:'zhang-roommate',accountId:'daily',amount:500,note:'聚餐分摊'}},'从日常账户给室友张三转500元，备注聚餐分摊'),t=current(s);const token=t.reviewToken,taskId=t.id;
    await page.goto(base,{waitUntil:'networkidle'});const review=page.getByRole('region',{name:'执行前核对卡'});
    for(const text of ['室友张三','6688','8021','¥500.00','聚餐分摊'])assert.ok((await review.textContent()).includes(text),text);
    s=await tool({operation:'amend',taskId,params:{amount:300}},'金额改成300元');t=current(s);assert.notEqual(t.reviewToken,token);assert.equal(s.receipts.length,0);
    await page.reload({waitUntil:'networkidle'});assert.ok((await review.textContent()).includes('¥300.00'));assert.ok(!(await review.textContent()).includes('¥500.00'));
    await page.getByRole('button',{name:'修改信息',exact:true}).click();await page.getByLabel('金额（元）',{exact:true}).fill('200');assert.equal(await page.getByRole('button',{name: /^手动确认/}).count(),0);assert.match(await page.locator('.unsaved-note').innerText(),/修改尚未保存/);assert.equal(current(await state()).params.amount,300);
    await page.reload({waitUntil:'networkidle'});await page.screenshot({path:path.join(out,'semantic-review-before-confirm.png'),fullPage:true});
    s=await tool({operation:'confirm',taskId,token:t.reviewToken},'信息没错，就按这份办理');assert.equal(current(s).status,'authenticate');assert.equal(s.receipts.length,0);
    await page.reload({waitUntil:'networkidle'});assert.ok((await review.textContent()).includes('¥300.00'));await auth();s=await state();assert.equal(s.receipts.length,1);assert.equal(s.receipts[0].amount,30000);assert.equal(s.receipts[0].recipientId,'zhang-roommate');
   }else if(scenario==='bond-text-confirmation'||scenario==='bond-native-confirmation'){
    let s=await bond(),t=current(s);assert.equal(t.status,'review');const taskId=t.id;
    s=scenario==='bond-text-confirmation'?await post({command:'确认',mode:'demo'}):await tool({operation:'confirm',taskId,token:t.reviewToken},'确认');
    assert.equal(current(s).id,taskId);assert.equal(current(s).status,'authenticate');assert.equal(s.workflows.records.orders.length,0);
    await page.goto(base,{waitUntil:'networkidle'});await auth();s=await state();assert.equal(current(s).status,'complete');assert.equal(s.workflows.records.orders.length,1);assert.equal(s.workflows.records.orders[0].productId,'fund-bond');assert.equal(s.workflows.records.orders[0].status,'pending');assert.equal(s.accounts[0].balance,1276500);
   }else if(scenario==='freeze-text-selection'){
    let s=await post({command:'冻结银行卡',mode:'demo'});assert.equal(current(s).status,'collecting');const taskId=current(s).id;
    s=await post({command:'日常卡',mode:'demo'});assert.equal(current(s).id,taskId);assert.equal(current(s).params.cardId,'card-daily');assert.equal(current(s).status,'review');
    s=await post({command:'确认冻结',mode:'demo'});assert.equal(current(s).status,'authenticate');await page.goto(base,{waitUntil:'networkidle'});await auth();assert.equal((await state()).workflows.records.cards.find(c=>c.id==='card-daily').status,'frozen');
   }else{
    let s=await tool({operation:'run',functionId:'CA06',params:{action:'freeze',cardId:'card-daily'}},scenario==='freeze-alias'?'冻结日常卡':'冻结日常借记卡');
    assert.equal(current(s).status,'review');await page.goto(base,{waitUntil:'networkidle'});await page.getByRole('button',{name: /^手动确认/}).click();await auth();s=await state();assert.equal(current(s).status,'complete');assert.equal(s.workflows.records.cards.find(c=>c.id==='card-daily').status,'frozen');
   }
   assert.deepEqual(entry.errors,[]);entry.status='passed';await page.screenshot({path:path.join(out,scenario+'.png'),fullPage:true});console.log(scenario+': passed');
  }catch(e){entry.status='failed';entry.failure=e.message;process.exitCode=1;console.log(scenario+': '+e.message);await page.screenshot({path:path.join(out,scenario+'-failure.png'),fullPage:true}).catch(()=>{});}
  finally{await context.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));}
 }}finally{await browser.close();console.log('Report: '+path.join(out,'report.json'));}
})().catch(e=>{console.error(e.message);process.exitCode=1});
