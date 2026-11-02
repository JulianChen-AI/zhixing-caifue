const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
(async()=>{
 const base=process.env.BANK_TEST_URL||'http://127.0.0.1:5180',browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'}),context=await browser.newContext({viewport:{width:1100,height:950}}),page=await context.newPage();
 try{
  const initial=(await(await page.request.get(base+'/api/bank')).json()).state;
  const response=await page.request.post(base+'/api/bank',{data:{requestId:crypto.randomUUID(),revision:initial.revision,tool:{name:'bank_plan',arguments:{operation:'create'},utterance:'先查询2026年10月账单明细，然后做风险测评。'}}});assert.equal(response.status(),200);
  const state=(await response.json()).state,step=state.plan.steps.find(t=>t.functionId==='BI01'),result=state.workflows.tasks.find(t=>t.id===step.taskId).result;
  await page.goto(base);const details=page.getByLabel(step.title+'的办理结果',{exact:true});await details.locator('summary').click();
  assert.equal(await details.evaluate(el=>el.open),true);const merchant=result.transactions?.[0]?.merchant;if(merchant)assert.ok((await details.textContent()).includes(merchant));
  const latest=(await(await page.request.get(base+'/api/bank')).json()).state;assert.equal(latest.revision,state.revision);assert.equal(latest.workflows.currentTaskId,state.workflows.currentTaskId);assert.equal(latest.workflows.tasks.find(t=>t.id===state.workflows.currentTaskId).functionId,'IN05');
  fs.mkdirSync('work',{recursive:true});await page.screenshot({path:'work/plan-results-20261028.png',fullPage:true});console.log(JSON.stringify({status:'passed',resultVisible:true,focusPreserved:true,merchant:merchant||null}));
 }finally{await context.close();await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
