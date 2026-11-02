// Browser UI and application-dispatch regression; synthetic accounts, no model calls.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {pick,pickAnswer,answerAt}=require('./pick.cjs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base=process.env.BANK_TEST_URL||'http://127.0.0.1:5180',out=process.env.REPRO_REPORT||'work/plan-checklists.json';
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const report={modelUsed:false,status:'running',checkpoints:[]};fs.mkdirSync(path.dirname(out),{recursive:true});
 try{
  const context=await browser.newContext(),page=await context.newPage();
  const state=async()=>(await(await page.request.get(base+'/api/bank')).json()).state;
  const tool=async(name,args,utterance)=>{const s=await state(),r=await page.request.post(base+'/api/bank',{data:{requestId:crypto.randomUUID(),revision:s.revision,tool:{name,arguments:args,utterance,turnId:crypto.randomUUID()}}});const b=await r.json();assert.equal(r.status(),200,b.error);return b.state;};
  const current=s=>s.workflows.tasks.find(t=>t.id===s.workflows.currentTaskId);
  let s=await tool('bank_plan',{operation:'create'},'先查询理财产品，然后做风险测评，最后查询订阅清单。');
  const id=current(s).id,root=s.plan.id;assert.deepEqual(s.plan.steps.map(x=>x.functionId),['IN06','IN05','SU01']);
  await page.goto(base);await page.locator('.flow-questionnaire').waitFor();
  const save=async(index,value)=>{await pickAnswer(page,index,value);const response=page.waitForResponse(r=>r.url().endsWith('/api/bank')&&r.request().method()==='POST');await page.locator('.flow-editor').getByRole('button',{name:/^(继续|保存修改)$/}).click();const r=await response;assert.equal(r.status(),200);return (await r.json()).state;};
  s=await save(0,'3');assert.deepEqual(current(s).params.answers,[3,0,0]);report.checkpoints.push('first answer saved');
  s=await tool('bank_function',{operation:'run',functionId:'CA01',params:{}},'先查看银行卡列表');assert.equal(s.plan.id,root);assert.equal(current(s).id,id);assert.deepEqual(current(s).params.answers,[3,0,0]);
  await page.reload();assert.equal(await answerAt(page,0),'3');report.checkpoints.push('temporary query returned and reload retained answer');
  s=await tool('bank_plan',{operation:'interrupt',functionId:'IN01',params:{name:'读书计划',target:2000,deadline:'2027-06-01'}},'创建储蓄目标，名称读书计划，目标2000元，截止2027-06-01，先看草稿');const goal=current(s).id;
  await page.reload();await page.getByRole('button',{name:'办理进度',exact:true}).click();const back=page.waitForResponse(r=>r.url().endsWith('/api/bank')&&r.request().method()==='POST');await page.getByRole('region',{name:'办理进度'}).locator('.task-history-row').filter({hasText:'完成或更新风险测评'}).getByRole('button',{name:'继续',exact:true}).click();s=(await(await back).json()).state;assert.equal(s.plan.id,root);assert.equal(current(s).id,id);assert.equal(s.workflows.tasks.find(t=>t.id===goal).params.target,2000);report.checkpoints.push('unfinished goal retained in the same queue and original checklist restored through UI');
  s=await save(1,'2');s=await save(2,'1');assert.equal(current(s).status,'review');assert.equal(s.workflows.tasks.find(t=>t.functionId==='SU01').status,'queued');
  s=await tool('bank_plan',{operation:'resume',taskId:goal},'继续读书计划草稿');s=await tool('bank_function',{operation:'cancel',taskId:goal},'取消读书计划这项任务');await page.reload();
  const confirmed=page.waitForResponse(r=>r.url().endsWith('/api/bank')&&r.request().method()==='POST');await page.getByRole('button',{name: /^手动确认/}).click();s=(await(await confirmed).json()).state;
  assert.equal(s.plan.status,'complete');assert.equal(current(s).functionId,'SU01');assert.equal(s.workflows.records.questionnaires.length,1);assert.equal(s.workflows.records.goals.some(g=>g.name==='读书计划'),false);report.checkpoints.push('confirmed assessment advanced to subscription query; unconfirmed goal did not execute');
  await page.getByRole('heading',{name:'订阅',exact:true}).waitFor();await page.screenshot({path:out.replace(/\.json$/,'.png'),fullPage:true});report.status='passed';
 }catch(e){report.status='failed';report.error=e.message;process.exitCode=1;}
 finally{fs.writeFileSync(out,JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify(report));}
})();
