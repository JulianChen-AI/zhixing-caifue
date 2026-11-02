// Local page/reducer checks only. No live provider, microphone or bank calls.
const path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));

const overflow=page=>page.evaluate(()=>({viewport:document.documentElement.clientWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth}));
const assertNoOverflow=async(page,label)=>{const d=await overflow(page);assert.ok(Math.max(d.document,d.body)<=d.viewport,`${label} horizontal overflow: ${JSON.stringify(d)}`);};
const summaryFor=(page,text)=>page.locator('summary').filter({hasText:text}).first();

(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1164,height:836}}),errors=[],businessRequests=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(/\/api\//.test(new URL(r.url()).pathname))businessRequests.push(r.url());});
 try{
  await page.goto((process.env.BANK_TEST_URL||'http://127.0.0.1:5180')+'/review-lite',{waitUntil:'networkidle'});
  await assertNoOverflow(page,'desktop before run');
  await page.getByRole('button',{name:'运行 20 项快速审核',exact:true}).click();
  await page.getByText('快速审核结果：20/20 通过',{exact:true}).waitFor();
  const items=page.getByRole('region',{name:'快速审核项目',exact:true}).getByRole('button');assert.equal(await items.count(),20);
  for(let i=0;i<20;i++){
   const item=items.nth(i);assert.match(await item.innerText(),/通过/);await item.click();
   await page.getByText(`检查 ${String(i+1).padStart(2,'0')}`,{exact:true}).waitFor();assert.equal(await item.getAttribute('aria-pressed'),'true');
   assert.ok((await page.locator('article').first().innerText()).includes('实测证据'));
  }

  // Item 4 deliberately exercises the daily AA-frequency limit, then proves a normal AA can proceed.
  await items.nth(3).click();
  const aaLimitText=await page.locator('article').first().innerText();
  assert.match(aaLimitText,/第\s*6\s*次/);assert.match(aaLimitText,/(?:故意|特意|专门)/);assert.match(aaLimitText,/(?:限额|次数|阻断|超限)/);
  await page.getByRole('button',{name:'重新体验正常AA',exact:true}).click();
  const card=page.getByRole('region',{name:'功能办理卡片',exact:true});await card.waitFor();
  let cardText=await card.innerText();assert.match(cardText,/待确认/);assert.match(cardText,/(?:AA|参与者|分摊)/);
  await page.getByRole('button',{name: /^手动确认/}).click();
  await page.getByText('等待参与者确认',{exact:true}).waitFor();cardText=await card.innerText();assert.ok(cardText.includes('等待参与者确认'));

  // The original category chart and percentage formatting remain covered.
  await items.nth(7).click();await page.getByRole('figure',{name:'分类净支出条形图'}).waitFor();
  await items.nth(8).click();assert.match(await page.locator('body').innerText(),/312(?:\.0)?%/,'changePercent should not be scaled twice');

  // Item 11 is a compact, human-readable comparison table; risk grades are unitless.
  await items.nth(10).click();const comparison=page.getByTestId('product-comparison');await comparison.waitFor();
  const tableText=await comparison.innerText();assert.match(tableText,/风险等级/);assert.match(tableText,/(?:^|\D)1(?:\D|$)/);assert.match(tableText,/(?:^|\D)3(?:\D|$)/);
  const riskRow=comparison.locator('tr').filter({hasText:'风险等级'}).first();
  if(await riskRow.count()){const riskText=await riskRow.innerText();assert.match(riskText,/(?:^|\D)1(?:\D|$)/);assert.match(riskText,/(?:^|\D)3(?:\D|$)/);assert.doesNotMatch(riskText,/¥/,'risk grade must remain a unitless number');}
  assert.doesNotMatch(tableText,/¥\s*(?:1|3)(?:\.00)?/,'risk grade must not be rendered as money');
  const comparisonVisible=await page.locator('body').innerText();
  assert.doesNotMatch(comparisonVisible,/\b(?:rawProducts|productId|comparedFields|differences|missing)\b|\[object Object\]/i,'raw fields must not leak into the visible comparison');

  // Item 10 exposes a collapsed Chinese monthly summary, not implementation fields or raw rules.
  await items.nth(9).click();
  let monthlyText=await page.locator('body').innerText();
  assert.doesNotMatch(monthlyText,/refunds-offset-expenses|grossExpenses\s*=|refunds\s*=/i);
  const monthlySummary=summaryFor(page,'查看月报小结');await monthlySummary.waitFor();
  const monthlyDetails=monthlySummary.locator('xpath=..');assert.equal(await monthlyDetails.getAttribute('open'),null,'monthly summary should start collapsed');
  await monthlySummary.click();const summaryText=await monthlyDetails.innerText();assert.match(summaryText,/本期|净支出|退款|月报/);
  assert.doesNotMatch(summaryText,/refunds-offset-expenses|grossExpenses\s*=|refunds\s*=|\brule\b/i,'expanded summary should contain Chinese conclusions, not raw rules');

  // Completed writes cannot be re-submitted through a generic editor; queries stay adjustable.
  await items.nth(0).click();
  assert.equal(await summaryFor(page,'调整查询').count(),0,'completed goal should not offer repeat submission');
  await items.nth(7).click();
  const editSummary=summaryFor(page,'调整查询');await editSummary.waitFor();
  const editDetails=editSummary.locator('xpath=..');assert.equal(await editDetails.getAttribute('open'),null);
  await editSummary.click();
  const period=page.getByRole('textbox',{name:'统计期间',exact:true});await period.fill('2026-09');
  await page.getByRole('button',{name:'重新查询',exact:true}).click();
  await page.getByText('2026-09 月报',{exact:true}).waitFor();
  await page.getByRole('button',{name:/^恢复本项(?:夹具|演示数据)$/}).click();
  const restoredSummary=summaryFor(page,'调整查询');await restoredSummary.waitFor();await restoredSummary.click();
  assert.equal(await period.inputValue(),'2026-10');
  await page.getByRole('button',{name:'重跑本项',exact:true}).click();await page.getByText('快速审核结果：20/20 通过',{exact:true}).waitFor();

  // Item 20 is a document errata note only; it must not start/show a business workflow.
  await items.nth(19).click();
  const finalArticle=await page.locator('article').first().innerText();assert.match(finalArticle,/校正|勘误/);
  const errata=page.getByRole('heading',{name:'竞品资料校正说明',exact:true}).locator('xpath=..');assert.match(await errata.innerText(),/不是新增银行功能/);
  const sourceSummary=summaryFor(page,'来源行号与原文哈希');await sourceSummary.waitFor();await sourceSummary.click();
  assert.match(await sourceSummary.locator('xpath=..').innerText(),/563620d7e1c710ee845c6dcb41b7d021eb47c1c6a821b0a5f5dae56ae250a0fd/);
  assert.doesNotMatch(await page.locator('body').innerText(),/本地业务卡片|选择要办理的业务|开始办理/);
  assert.equal(await page.getByRole('region',{name:'功能办理卡片',exact:true}).count(),0);

  // Save both requested responsive sizes with the table visible for review.
  await items.nth(10).click();await comparison.waitFor();
  const productCard=page.getByRole('region',{name:'功能办理卡片',exact:true});await productCard.waitFor({state:'visible'});
  await page.setViewportSize({width:1164,height:836});await assertNoOverflow(page,'1164x836');
  await comparison.scrollIntoViewIfNeeded();
  await productCard.evaluate(el=>Promise.all(el.getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{}))));
  if(process.env.BANK_SCREENSHOT)await productCard.screenshot({path:process.env.BANK_SCREENSHOT,animations:'disabled'});
  await page.setViewportSize({width:390,height:844});await assertNoOverflow(page,'390x844');
  await comparison.scrollIntoViewIfNeeded();
  await productCard.evaluate(el=>Promise.all(el.getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{}))));
  const mobileScreenshot=process.env.BANK_MOBILE_SCREENSHOT|| (process.env.BANK_SCREENSHOT?process.env.BANK_SCREENSHOT.replace(/(\.[^.]+)$/,'-mobile$1'):null);
  if(mobileScreenshot)await productCard.screenshot({path:mobileScreenshot,animations:'disabled'});

  assert.deepEqual(errors,[]);assert.deepEqual(businessRequests,[]);
  console.log(JSON.stringify({status:'passed',checks:['20/20 rendered and each selectable','item 4 deliberate daily-limit block and normal AA confirmation reaches awaiting-participants','category chart and 312% formatting','item 11 compact comparison table with unitless risk grades and no raw fields','item 10 collapsed monthly summary with Chinese conclusion and no raw rules','completed goal editor collapsed; 7000 edit confirmed and fixture restored','item 20 errata-only with no business launcher','1164x836 and 390x844 without horizontal overflow'],viewportChecks:[{width:1164,height:836},{width:390,height:844}],screenshots:[process.env.BANK_SCREENSHOT||null,mobileScreenshot].filter(Boolean),browserErrors:errors,businessRequests,synthetic:true},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
