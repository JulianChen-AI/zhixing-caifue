// Real local page + HTTP + persisted database, isolated synthetic sessions.
// Does not call a model, microphone or real bank.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base=process.env.BANK_TEST_URL||'http://127.0.0.1:5173';
const out=path.resolve('outputs/ui-fix-20261029');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const report={realProvider:false,realDatabase:true,cases:[]};
 const scenario=async(name,test)=>{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),page=await context.newPage();page.setDefaultTimeout(10000);
  const entry={name,status:'running',errors:[]};report.cases.push(entry);page.on('pageerror',error=>entry.errors.push(error.message));
  const state=async()=>{const response=await page.request.get(base+'/api/bank');assert.equal(response.status(),200);return(await response.json()).state;};
  const post=async(payload,status=200)=>{const s=await state(),response=await page.request.post(base+'/api/bank',{data:{...payload,requestId:crypto.randomUUID(),revision:s.revision}}),data=await response.json();assert.equal(response.status(),status,data.error||'HTTP status');return data.state;};
  const action=command=>post({action:{type:'workflow',command}});
  const current=s=>s.workflows.tasks.find(task=>task.id===s.workflows.currentTaskId);
  const card=()=>page.getByRole('region',{name:'功能办理卡片',exact:true});
  const send=async text=>{await page.getByRole('textbox',{name:'输入你的要求',exact:true}).fill(text);await page.getByRole('button',{name:'发送',exact:true}).click();};
  const noOverflow=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'content must fit screen width');
  const single=async()=>assert.equal(await page.locator('.business-card:visible').count(),1,'one visible business card');
  try{await test({page,state,post,action,current,card,send,noOverflow,single});assert.deepEqual(entry.errors,[]);entry.status='passed';console.log(name+': passed');}
  catch(error){entry.status='failed';entry.failure=error.stack;process.exitCode=1;console.log(name+': '+error.message);await page.screenshot({path:path.join(out,name+'-failure.png'),fullPage:true}).catch(()=>{});}
  finally{await context.close();fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify(report,null,2));}
 };
 try{
  await scenario('complete-transfer-summary',async({page,state,post,action,current,card,noOverflow,single})=>{
   let s=await action({operation:'run',functionId:'TR03',params:{recipientId:'zhang-roommate',accountId:'daily',amount:500,note:'饭钱'}}),task=current(s),oldToken=task.reviewToken;
   await page.goto(base,{waitUntil:'networkidle'});await single();
   const summary=page.getByRole('region',{name:'执行前核对卡',exact:true});
   for(const fact of ['500.00','6688','8021','饭钱'])assert.ok((await summary.innerText()).includes(fact),fact);
   assert.equal(await page.getByRole('navigation',{name:'卡片翻页'}).count(),0);
   await page.getByRole('button',{name:'修改信息',exact:true}).click();
   for(const label of ['收款人','账户','金额（元）'])assert.equal(await page.getByLabel(label,{exact:true}).isVisible(),true);
   await page.getByLabel('金额（元）',{exact:true}).fill('300');assert.equal(await page.getByRole('button',{name: /^手动确认/}).count(),0);
   await page.getByRole('button',{name:'保存修改',exact:true}).click();await page.getByRole('button',{name: /^手动确认/}).waitFor();
   s=await state();task=current(s);assert.equal(task.params.note,'饭钱');assert.equal(task.params.recipientId,'zhang-roommate');assert.equal(task.params.accountId,'daily');assert.notEqual(task.reviewToken,oldToken);
   await post({action:{type:'workflow',command:{operation:'confirm',taskId:task.id,token:oldToken}}},409);
   await page.getByRole('button',{name: /^手动确认/}).click();await page.getByLabel('功能演示验证码',{exact:true}).waitFor();
   for(const fact of ['300.00','6688','8021'])assert.ok((await summary.innerText()).includes(fact),fact);
   await page.getByRole('button',{name:'返回核对',exact:true}).click();await page.getByRole('button',{name: /^手动确认/}).click();
   await page.setViewportSize({width:390,height:420});await page.getByLabel('功能演示验证码',{exact:true}).fill('123456');
   assert.equal(await page.getByRole('textbox',{name:'输入你的要求',exact:true}).isVisible(),false,'hide generic composer while editing a card field');
   await noOverflow();await page.screenshot({path:path.join(out,'authentication-compact.png'),fullPage:true});
   await page.getByRole('button',{name:'验证并办理',exact:true}).click();await page.locator('.workflow-card[data-status="complete"]').waitFor();
   s=await state();assert.equal(s.receipts.length,1);assert.equal(s.receipts[0].amount,30000);assert.equal(s.accounts[0].balance,1256500);
   const receipt=await page.getByRole('region',{name:'办理结果',exact:true}).innerText();for(const fact of ['300.00','6688','8021'])assert.ok(receipt.includes(fact),fact);
   assert.doesNotMatch(await card().innerText(),/\d{4}-\d{2}-\d{2}T\d/);
   await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'transfer-receipt.png'),fullPage:true});await single();
   await page.reload({waitUntil:'networkidle'});assert.equal((await state()).receipts.length,1);
  });
  await scenario('reports-and-comparisons',async({page,action,card,noOverflow,single})=>{
   await action({operation:'run',functionId:'BI06',params:{period:'2026-10'}});await page.goto(base,{waitUntil:'networkidle'});
   await page.getByRole('figure',{name:'分类净支出条形图'}).waitFor();assert.equal(await page.locator('.card-pagination').count(),0);await single();
   await page.screenshot({path:path.join(out,'monthly-overview.png'),fullPage:true});
   await action({operation:'run',functionId:'IN07',params:{productIds:['fund-cash','fund-bond']}});await page.reload({waitUntil:'networkidle'});
   const comparison=page.getByTestId('product-comparison');await comparison.waitFor();assert.match(await comparison.innerText(),/风险等级/);
   assert.doesNotMatch(await comparison.innerText(),/¥\s*(?:1|3)\.00/);
   for(const viewport of [{width:320,height:568},{width:360,height:640},{width:1280,height:900}]){await page.setViewportSize(viewport);await noOverflow();await single();}
   await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'product-comparison.png'),fullPage:true});
   await action({operation:'run',functionId:'TR02',params:{}});await page.reload({waitUntil:'networkidle'});
   const accounts=page.locator('.viz-tile');assert.equal(await accounts.count(),2);
   for(const [index,fact]of ['日常账户','储蓄账户'].entries())assert.match(await accounts.nth(index).innerText(),new RegExp(fact));
   assert.equal(await page.locator('.card-pagination').count(),0);assert.doesNotMatch(await card().innerText(),/T\d{2}:\d{2}:/);
  });
  await scenario('task-history-and-focus',async({page,state,post,current,single,send})=>{
   let s=await post({command:'先查询余额，然后从日常账户给室友转50元，然后从储蓄账户给李四转30元',mode:'demo'});
   const id=current(s).id,revision=s.revision;
   await page.goto(base,{waitUntil:'networkidle'});await page.getByRole('button',{name:'办理进度',exact:true}).click();await single();
   const rows=page.getByRole('region',{name:'办理进度',exact:true}).locator('.task-history-row');
   assert.match(await rows.nth(1).innerText(),/室友张三[\s\S]*¥50.00[\s\S]*8021/);assert.match(await rows.nth(2).innerText(),/李四[\s\S]*¥30.00[\s\S]*3609/);
   assert.equal(await rows.nth(2).getByRole('button',{name:'继续',exact:true}).count(),0,'dependent task is not selectable yet');
   await rows.nth(0).getByRole('button',{name:'查看结果',exact:true}).click();await page.getByRole('region',{name:'业务结果',exact:true}).waitFor();
   s=await state();assert.equal(current(s).id,id);assert.equal(s.revision,revision);
   await page.getByRole('button',{name:'返回进度',exact:true}).click();await rows.nth(1).getByRole('button',{name:'继续',exact:true}).click();
   assert.equal(current(await state()).id,id);await page.getByRole('button',{name: /^手动确认/}).waitFor();await single();
   await page.getByRole('button',{name:'办理进度',exact:true}).click();await page.screenshot({path:path.join(out,'task-list.png'),fullPage:true});
   await page.getByRole('region',{name:'办理进度',exact:true}).getByRole('button',{name:'返回',exact:true}).click();
   const beforeQuery=await state(),reviewToken=current(beforeQuery).reviewToken;
   await send('看看我的余额');const query=page.getByRole('region',{name:'查询结果',exact:true});await query.waitFor();
   assert.match(await query.innerText(),/日常账户[\s\S]*储蓄账户/);await single();
   const afterQuery=await state();assert.equal(current(afterQuery).id,id);assert.equal(current(afterQuery).reviewToken,reviewToken);
   await query.getByRole('button',{name:'返回当前业务',exact:true}).last().click();await page.getByRole('button',{name: /^手动确认/}).waitFor();
   assert.equal(current(await state()).id,id);await single();
  });
  await scenario('typed-confirmation-and-cancellation',async({page,state,send,current,post,action,single})=>{
   await page.goto(base,{waitUntil:'networkidle'});await send('冻结日常卡');await page.getByRole('button',{name: /^手动确认/}).waitFor();
   await send('确认冻结');await page.getByLabel('功能演示验证码',{exact:true}).waitFor();
   assert.equal(current(await state()).status,'authenticate');assert.equal((await state()).workflows.records.cards.find(card=>card.id==='card-daily').status,'active');
   await send('取消全部剩余任务');await page.locator('.workflow-card[data-status="cancelled"]').waitFor();assert.equal((await state()).plan.status,'cancelled');
   await post({command:'先从日常账户给室友转50元，然后从储蓄账户给李四转30元',mode:'demo'});await page.reload({waitUntil:'networkidle'});
   await send('取消全部剩余任务');await page.locator('.workflow-card[data-status="cancelled"]').waitFor();assert.equal((await state()).plan.status,'cancelled');assert.equal((await state()).receipts.length,0);
   await action({operation:'run',functionId:'TR03',params:{recipientId:'zhang-roommate',accountId:'daily',amount:50,note:'刷单解冻费'}});await page.reload({waitUntil:'networkidle'});
   assert.match(await page.locator('.workflow-card').innerText(),/存在风险.*暂时无法继续/);assert.doesNotMatch(await page.locator('.workflow-card').innerText(),/命中|升级核验|口头安全|沙箱/);await single();
  });
  await scenario('mascot-is-integrated',async({page,action})=>{
   const manifest=await(await page.request.get(base+'/mascot/manifest.json')).json();assert.equal(Object.keys(manifest.actions).length,15);
   await page.goto(base,{waitUntil:'networkidle'});await page.waitForFunction(()=>document.querySelector('.mascot-stage')?.classList.contains('mascot-ready'));
   assert.equal(await page.locator('.mascot-stage canvas').isVisible(),true);
   await action({operation:'run',functionId:'TR03',params:{recipientId:'zhang-roommate',accountId:'daily',amount:50}});await page.reload({waitUntil:'networkidle'});
   await page.waitForFunction(()=>document.querySelector('.mascot-stage')?.dataset.action==='waiting');
   const box=await page.locator('.mascot-stage').boundingBox();assert.ok(box.width>=80,'business mascot stays visible');
   await page.screenshot({path:path.join(out,'review-and-mascot.png'),fullPage:true});
  });
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
