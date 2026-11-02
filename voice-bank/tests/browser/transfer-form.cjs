// Real React form with deterministic API fixture; does not call a model or bank.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {pick,pickAnswer,answerAt}=require('./pick.cjs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base=process.env.BANK_TEST_URL||'http://127.0.0.1:5175';
const out=path.resolve('outputs','transfer-form-'+new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(out,{recursive:true});
(async()=>{
 const {initialState,reduceBank}=await import('../../lib/bank/engine.ts');
 const report={realModel:false,backendFixture:true,cases:[]};
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{for(const accountProvided of [true,false]){
  const entry={accountProvided,status:'running',errors:[],operations:[]};report.cases.push(entry);
  let state=reduceBank(initialState(),{type:'intent',intent:{kind:'transfer'}},crypto.randomUUID());
  if(accountProvided)state=reduceBank(state,{type:'edit',accountId:'daily'},crypto.randomUUID());
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();page.on('pageerror',e=>entry.errors.push(e.message));
  await page.route('**/api/bank',async route=>{
   try{const req=route.request();if(req.method()==='POST'){const b=req.postDataJSON();assert.ok(b.action);entry.operations.push(b.action.type);state=reduceBank(state,b.action,b.requestId);}await route.fulfill({json:{state,liveConfigured:false}});}
   catch(e){await route.fulfill({status:400,json:{error:e.message}});}
  });
  try{
   await page.goto(base,{waitUntil:'networkidle'});await page.locator('.cand').filter({hasText:'室友'}).click();
   const input=page.getByLabel('转账金额',{exact:true});await input.waitFor();
   assert.equal(state.task.recipientId,'zhang-roommate');
   await input.fill('500');assert.equal(await input.evaluate(el=>el===document.activeElement),true);
   const save=page.getByRole('button',{name:'保存金额',exact:true});assert.equal(await save.isEnabled(),true,'input must be saveable without blur');
   await save.click();await page.waitForFunction(()=>!document.querySelector('button.primary-button:disabled')||!!document.querySelector('[aria-label="付款账户"]'));
   await page.waitForTimeout(150);assert.equal(state.task.amount,50000);assert.equal(state.task.recipientId,'zhang-roommate');
   if(!accountProvided){assert.equal(state.task.step,'details');await pick(page,'付款账户','daily');}
   await page.getByRole('button',{name: '手动确认并认证', exact: true}).waitFor();
   await input.fill('500.001');assert.equal(await save.isDisabled(),true,'do not round invalid precision into a transfer');
   await input.fill('300');assert.equal(await save.isEnabled(),true);await save.click();
   const confirm=page.getByRole('button',{name: '手动确认并认证', exact: true});await confirm.waitFor();
   assert.equal(state.task.amount,30000);assert.equal(state.task.accountId,'daily');assert.equal(state.task.recipientId,'zhang-roommate');
   assert.equal(await confirm.isEnabled(),true);await confirm.click();await page.getByLabel('演示验证码',{exact:true}).waitFor();
   assert.equal(state.task.step,'authenticate');assert.equal(state.receipts.length,0);assert.deepEqual(entry.errors,[]);entry.status='passed';
   entry.final={step:state.task.step,amount:state.task.amount,recipientId:state.task.recipientId,accountId:state.task.accountId};console.log(JSON.stringify(entry));
  }catch(e){entry.status='failed';entry.failure=e.message;console.log(e.message);await page.screenshot({path:path.join(out,accountProvided?'account.png':'no-account.png')}).catch(()=>{});}
  finally{await context.close();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));}
 }}finally{await browser.close();console.log('Report: '+path.join(out,'report.json'));if(report.cases.some(x=>x.status==='failed'))process.exitCode=1;}
})().catch(e=>{console.error(e);process.exitCode=1});
