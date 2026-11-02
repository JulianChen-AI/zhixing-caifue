// Real local HTTP routes, database and React page. No provider or microphone calls.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base=process.env.BANK_TEST_URL||'http://127.0.0.1:5176';
const out=path.resolve('outputs','dialogue-state-'+new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(out,{recursive:true});
(async()=>{
 const report={status:'running',realProvider:false,realHttp:true,realDatabase:true,checks:[],errors:[]};
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 const flow=s=>s.workflows.tasks.find(t=>t.id===s.workflows.currentTaskId);
 const state=async()=>{const r=await page.request.get(base+'/api/bank');assert.equal(r.status(),200);return(await r.json()).state;};
 const post=async(payload,status=200)=>{
  const s=await state(),r=await page.request.post(base+'/api/bank',{data:{...payload,requestId:crypto.randomUUID(),revision:s.revision}}),body=await r.json();
  assert.equal(r.status(),status,JSON.stringify(body));return body.state;
 };
 const tool=(name,args,utterance,status=200)=>post({tool:{name,arguments:args,utterance,turnId:crypto.randomUUID()}},status);
 try{
  const initial=await state();
  for(const [amount,utterance]of [[50,'从日常账户给室友转500元'],[3,'从日常账户给室友张三转账'],[80,'从尾号8021的账户给室友转账'],[100,'从日常账户给室友转100美元']]){
   await tool('bank_function',{operation:'run',functionId:'TR03',params:{recipientId:'zhang-roommate',accountId:'daily',amount}},utterance,400);
  }
  await tool('bank_function',{operation:'run',functionId:'TR03',params:{recipientId:'zhang-roommate',accountId:'daily',amount:100}},'从日常账户给室友张三尾号2910转100元',400);
  assert.equal((await state()).revision,initial.revision);report.checks.push('invalid money and contradictory recipient fail over HTTP without persistence');
  let s=await tool('bank_function',{operation:'run',functionId:'TR03',params:{recipientId:'zhang-roommate',accountId:'daily',amount:100}},'从尾号8021的账户给尾号6688的张三转100元');
  const taskId=flow(s).id,token=flow(s).reviewToken;
  s=await tool('bank_function',{operation:'amend',taskId,params:{amount:100}},'100元');assert.equal(flow(s).reviewToken,token);
  s=await tool('bank_function',{operation:'confirm',taskId,token},'确认');const auth=flow(s).verificationId;
  for(const utterance of ['改成100美元','改成余额三分之一'])await tool('bank_function',{operation:'amend',taskId,params:{amount:100}},utterance,400);
  s=await tool('bank_function',{operation:'amend',taskId,params:{amount:100}},'还是100元');assert.equal(flow(s).verificationId,auth);
  s=await tool('bank_function',{operation:'confirm',taskId,token},'确认');assert.equal(flow(s).verificationId,auth);
  s=await post({action:{type:'workflow',command:{operation:'resume',taskId}}});assert.equal(flow(s).verificationId,auth);
  await page.goto(base,{waitUntil:'networkidle'});await page.getByLabel('功能演示验证码',{exact:true}).waitFor();
  await page.getByRole('button',{name:'返回核对',exact:true}).click();await page.getByRole('button',{name: /^手动确认/}).waitFor();
  s=await state();assert.equal(flow(s).status,'review');assert.equal(s.task.step,'review');assert.equal(flow(s).verificationId,null);
  report.checks.push('unchanged voice fields, duplicate confirmation and resume preserve auth; actual card back returns to review');
  s=await tool('bank_function',{operation:'confirm',taskId,token:flow(s).reviewToken},'确认');const activeAuth=flow(s).verificationId;
  await tool('bank_function',{operation:'cancel',taskId},'不要取消',400);assert.equal(flow(await state()).verificationId,activeAuth);
  s=await tool('bank_function',{operation:'amend',taskId,params:{amount:100}},'100元，是刷单解冻费');assert.equal(flow(s).status,'blocked');assert.equal(s.task.verificationId,null);
   await post({action:{type:'authenticate',code:'123456',verificationId:activeAuth}},400);assert.equal((await state()).receipts.length,0);
  report.checks.push('negated cancellation rejected; new risk revokes both workflow and legacy authorization');
   await post({action:{type:'workflow',command:{operation:'cancel',taskId}}});
  s=await tool('bank_request',{operation:'update_transfer',recipientId:'zhang-landlord',accountId:'savings',amount:300},'从储蓄账户给房东张三转300元');const nextId=s.task.id;
   await tool('bank_function',{operation:'cancel',taskId},'取消原来的任务',400);s=await state();assert.equal(s.task.id,nextId);assert.equal(s.task.step,'review');
   report.checks.push('out-of-plan cancellation is rejected and preserves the current transfer');
   const nextTask=flow(s),oldToken=nextTask.reviewToken;
   await tool('bank_function',{operation:'amend',taskId:nextTask.id,params:{note:'不存在的备注'}},'改一下备注',400);
   s=await tool('bank_function',{operation:'amend',taskId:nextTask.id,params:{amount:200}},'金额改成200元');assert.equal(flow(s).params.accountId,'savings');assert.equal(flow(s).params.recipientId,'zhang-landlord');
   await post({action:{type:'workflow',command:{operation:'confirm',taskId:nextTask.id,token:oldToken}}},409);
   await page.reload({waitUntil:'networkidle'});const review=page.getByRole('region',{name:'执行前核对卡',exact:true});await review.waitFor();
   for(const value of ['¥200.00','2910','3609'])assert.ok((await review.innerText()).includes(value));
   assert.equal(await page.getByRole('button',{name: /^手动确认/}).isEnabled(),true);
   s=await state();assert.equal(s.receipts.length,0);assert.deepEqual(s.accounts,initial.accounts);assert.deepEqual(report.errors,[]);
   report.checks.push('unspoken note is rejected; explicit correction preserves other fields and old review is rejected after database reload');report.status='passed';
 }catch(e){report.status='failed';report.failure=e.message;await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});process.exitCode=1;}
 finally{await browser.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));console.log('Report: '+path.join(out,'report.json'));}
})().catch(e=>{console.error(e.message);process.exitCode=1});
