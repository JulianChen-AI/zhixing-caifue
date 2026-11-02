// Local app, real HTTP/database and production card components; synthetic data, no model/ASR.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base=process.env.BANK_TEST_URL||'http://127.0.0.1:5180',out=path.resolve(process.env.BILLING_REPORT_DIR||'outputs/billing-query-fix-20261031');fs.mkdirSync(out,{recursive:true});
const report={local:true,realDatabase:true,realModel:false,humanMicrophone:false,cases:[]},current=s=>s.workflows.tasks.find(t=>t.id===s.workflows.currentTaskId);
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 async function scenario(name,run){
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();page.setDefaultTimeout(10000);const entry={name,status:'running',errors:[]};report.cases.push(entry);page.on('pageerror',e=>entry.errors.push(e.message));
  const state=async()=>(await(await page.request.get(base+'/api/bank')).json()).state;
  const send=async text=>{const response=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/bank');await page.getByRole('textbox',{name:'输入你的要求',exact:true}).fill(text);await page.getByRole('button',{name:'发送',exact:true}).click();const r=await response;assert.equal(r.status(),200);await page.waitForTimeout(250);return state();};
  const card=()=>page.getByRole('region',{name:'功能办理卡片',exact:true});
  try{await page.goto(base,{waitUntil:'networkidle'});await run({page,state,send,card,entry});assert.deepEqual(entry.errors,[]);assert.equal(await page.locator('.business-card:visible').count(),1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);entry.cardText=await card().innerText();await page.screenshot({path:path.join(out,name+'.png'),fullPage:true});entry.status='passed';}
  catch(error){entry.status='failed';entry.failure=error.stack;process.exitCode=1;await page.screenshot({path:path.join(out,name+'-failure.png'),fullPage:true}).catch(()=>{});}
  finally{await context.close();fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify(report,null,2));console.log(name+': '+entry.status+(entry.failure?' '+entry.failure.split('\n')[0]:''));}
 }
 try{
  await scenario('this-month-coffee',async({page,send,card,entry})=>{
   const s=await send('看看我这个月的账单，咖啡一共花了多少？'),task=current(s);assert.equal(task.functionId,'BI02');assert.equal(task.params.period,'2026-10');assert.equal(task.params.merchant,'咖啡店');assert.equal(task.params.category,undefined);assert.equal(task.result.current.netExpenses,2600);assert.equal(s.receipts.length,0);
   assert.match(await page.getByLabel('查询范围',{exact:true}).innerText(),/2026年10月.*咖啡店/);assert.match(await card().innerText(),/26\.00/);assert.doesNotMatch(await card().innerText(),/128\.00/);entry.params=task.params;entry.spokenSummary=task.result.spokenSummary;
   const done=await page.getByRole('button',{name:'完成',exact:true}).evaluate(b=>{const r=b.getBoundingClientRect(),e=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return e===b||b.contains(e);});assert.ok(done,'compact billing result must not put Done behind the composer');
  });
  await scenario('native-tool-missing-conditions',async({page,state,entry})=>{
   const before=await state(),r=await page.request.post(base+'/api/bank',{data:{requestId:crypto.randomUUID(),revision:before.revision,tool:{name:'bank_function',arguments:{operation:'run',functionId:'BI02',params:{}},utterance:'看看我这个月的账单，咖啡一共花了多少？',turnId:crypto.randomUUID()}}});assert.equal(r.status(),200);const data=await r.json(),s=data.state;assert.equal(current(s).result.current.netExpenses,2600);assert.equal(current(s).params.merchant,'咖啡店');assert.deepEqual(s.accounts,before.accounts);assert.deepEqual(s.receipts,before.receipts);
   const result=data.toolResult.operationResult.workflow.result;assert.equal(result.current.netExpenses,26);assert.match(result.spokenSummary,/咖啡店.*26.00元/);entry.receipt=result;await page.reload({waitUntil:'networkidle'});assert.match(await page.getByLabel('查询范围',{exact:true}).innerText(),/咖啡店/);
  });
  await scenario('query-filters-visible-and-readable',async({page,send,state,entry})=>{
   await send('查一下2026年10月收支统计');await page.getByRole('button',{name:'调整查询',exact:true}).click();
   for(const label of ['统计期间','商户','类目','账户'])assert.ok(await page.getByLabel(label,{exact:true}).isVisible(),label);
   const categories=page.getByLabel('类目',{exact:true});entry.options=await categories.locator('option').allTextContents();assert.ok(entry.options.includes('饮品'));assert.ok(entry.options.includes('餐饮'));assert.ok(!entry.options.some(x=>/类目\s*\d/.test(x)));
   await categories.selectOption('饮品');await page.getByLabel('商户',{exact:true}).fill('咖啡店');
   for(const viewport of [{width:320,height:568},{width:1280,height:900},{width:390,height:844}]){await page.setViewportSize(viewport);await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'query editor fits viewport');}
   await page.screenshot({path:path.join(out,'visible-query-filters.png'),fullPage:true});
   await page.getByRole('button',{name:'保存修改',exact:true}).click();await page.getByRole('button',{name:'调整查询',exact:true}).waitFor();await page.waitForTimeout(250);assert.equal(current(await state()).result.current.netExpenses,2600);
   await page.getByRole('button',{name:'调整查询',exact:true}).click();await page.getByLabel('商户',{exact:true}).fill('');await page.getByRole('button',{name:'保存修改',exact:true}).click();await page.getByRole('button',{name:'调整查询',exact:true}).waitFor();await page.waitForTimeout(250);assert.match(await page.getByLabel('查询范围',{exact:true}).innerText(),/全部商户.*饮品/);
  });
  await scenario('last-month-video-membership',async({page,send,entry})=>{
   const s=await send('上个月视频会员一共花了多少？'),task=current(s);assert.equal(task.functionId,'BI02');assert.equal(task.params.period,'2026-09');assert.equal(task.params.merchant,'视频会员');assert.equal(task.result.current.netExpenses,2500);assert.match(await page.getByLabel('查询范围',{exact:true}).innerText(),/2026年9月.*视频会员/);entry.params=task.params;
  });
  await scenario('empty-merchant-query',async({page,send,card,entry})=>{
   const s=await send('查2026年10月商户“银河咖啡店”的支出'),task=current(s);assert.equal(task.result.current.count,0);assert.equal(task.result.current.netExpenses,0);assert.match(await page.getByLabel('查询范围',{exact:true}).innerText(),/银河咖啡店/);assert.match(await card().innerText(),/没有记录/);entry.spokenSummary=task.result.spokenSummary;
  });
  await scenario('clarification-before-query',async({page,send,state,entry})=>{
   let s=await send('最近咖啡花了多少？'),task=current(s);const id=task.id;assert.equal(task.status,'collecting');assert.equal(task.result,null);assert.equal(task.params.merchant,'咖啡店');assert.deepEqual(task.missing,['period']);assert.match(await page.getByRole('status').innerText(),/明确统计月份/);assert.ok(await page.getByLabel('统计期间',{exact:true}).isVisible());assert.equal(task.steps.find(x=>x.toolId==='B03').status,'pending');
   await page.getByLabel('统计期间',{exact:true}).fill('2026-10');await page.getByRole('button',{name:'继续',exact:true}).click();await page.locator('.workflow-card[data-status="complete"]').waitFor();await page.waitForTimeout(250);s=await state();assert.equal(current(s).id,id);assert.equal(current(s).result.current.netExpenses,2600);entry.params=current(s).params;
  });
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
