// Real page and local sandbox only; no Qwen, microphone or business mutations through test APIs.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base = process.env.BANK_TEST_URL || 'http://127.0.0.1:5196';
if (base !== 'http://127.0.0.1:5196') throw new Error('This test is restricted to the 5196 local sandbox.');
const reportFile = process.env.BANK_TEST_REPORT || path.join(os.homedir(), '30_Developer', 'webank-roadshow-monthly', 'report.json');
if (!path.isAbsolute(reportFile)) throw new Error('BANK_TEST_REPORT must be an absolute path.');
fs.mkdirSync(path.dirname(reportFile), { recursive: true });
const shots = fs.mkdtempSync(path.join(path.dirname(reportFile), 'monthly-shots-'));
const report = { status: 'running', base, realQwen: false, checks: [], errors: [], screenshots: shots };
const save = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
(async () => {
 const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
 const context = await browser.newContext({ viewport: { width: 1100, height: 950 } });
 const page = await context.newPage();
 page.on('pageerror', e => report.errors.push(e.message));
 // Block all network except this local worker, even if configuration is accidentally enabled.
 await context.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.origin === base && !url.pathname.startsWith('/api/live/')) return route.continue();
  report.errors.push(`Blocked unexpected request: ${url.origin}${url.pathname}`);
  return route.abort();
 });
 const state = async () => {
  const r = await page.request.get(base + '/api/bank');
  assert.equal(r.status(), 200);
  const data = await r.json(); assert.equal(data.liveConfigured, false, 'provider must be disabled');
  return data.state;
 };
 const until = async (predicate, label) => {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) { const s = await state(); if (predicate(s)) return s; await page.waitForTimeout(100); }
  throw new Error('Timed out waiting for ' + label);
 };
 const send = async text => {
  const before = await state();
  await page.getByLabel('输入你的要求', { exact: true }).fill(text);
  await page.getByRole('button', { name: '发送', exact: true }).click();
  return until(s => s.revision > before.revision, 'text command: ' + text);
 };
 const changed = async (before, label) => until(s => s.revision > before.revision, label);
 try {
  await state();
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '设置与连接', exact: true }).click();
  await page.getByRole('button', { name: '路演场景', exact: true }).click();
  const panel = page.getByRole('region', { name: '路演场景' });
  await panel.getByRole('combobox', { name: '选择路演场景', exact: true }).click();
  await page.locator('.choice-option[data-value="S08"]').click();
  await panel.getByRole('button', { name: '加载所选场景', exact: true }).click();
  await page.getByRole('button', { name: '确认加载场景', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="演示场景状态"]')?.textContent?.includes('S08'));
  let s = await state(); assert.equal(s.sceneId, 'S08'); assert.equal(s.accounts[0].balance, 800000);
  report.checks.push('UI 加载 S08，初始余额 8000 元');
  s = await send('工资到了，老规矩');
  assert.ok(s.plan?.monthly); assert.equal(s.plan.status, 'paused'); assert.equal(s.accounts[0].balance, 800000);
  assert.equal(s.receipts.length, 0); assert.equal(s.plan.steps.length, 4);
  for (const title of ['房租', '储蓄', '投资', '报告']) assert.ok(s.plan.steps.some(step => step.title.includes(title)), `missing ${title}`);
  const monthly = page.getByLabel('本月安排', { exact: true });
  for (const label of ['转账', '内部划款', '投资申请', '只读查询']) assert.ok((await monthly.innerText()).includes(label), 'plan must display ' + label);
  await page.screenshot({ path: path.join(shots, 'plan-before-confirm.png'), fullPage: true, animations: 'disabled' });
  for (const amount of [450, 400]) {
   const savingTitle = s.plan.steps.find(step => step.functionId === 'IN02').title;
   const before = s; await page.getByLabel(savingTitle + '金额', { exact: true }).fill(String(amount));
   const saveButton = page.getByRole('button', { name: '保存' + savingTitle + '金额', exact: true });
   await saveButton.click();
   s = await changed(before, 'edit saving amount');
   assert.equal(s.plan.steps.find(step => step.functionId === 'IN02').params.amount, amount);
   assert.equal(s.accounts[0].balance, 800000); assert.equal(s.receipts.length, 0);
  }
  report.checks.push('模板可通过 UI 将储蓄从 400 改为 450 再改回 400，未扣款或生成凭证');
  s = await send('这周请爸妈吃饭，先留400');
  assert.ok(s.plan.steps.some(step => /预算/.test(step.title)), 'budget step not appended');
  assert.equal(s.accounts[0].balance, 800000); assert.equal(s.accounts[0].held || 0, 0);
  await page.screenshot({ path: path.join(shots, 'plan-amended.png'), fullPage: true, animations: 'disabled' });
  report.checks.push('文字追加 400 元聚餐预算，尚未扣款或占用');
  // Each financial operation is explicitly reviewed and confirmed in the native UI.
  for (let i = 0; i < 10 && s.plan.status !== 'complete'; i++) {
   if (s.plan.status === 'paused') {
    const resume = page.getByRole('button', { name: /^(继续任务|继续办理)$/ }).first();
    await resume.waitFor({ state: 'visible' }); const before = s; await resume.click();
    s = await changed(before, 'resume plan'); continue;
   }
   const confirm = page.getByRole('button', { name: /^手动确认/ });
   await confirm.waitFor({ state: 'visible', timeout: 12000 });
   const ack = page.getByRole('checkbox'); if (await ack.count()) await ack.check();
   const before = s; await confirm.click(); s = await changed(before, 'confirm item');
   const auth = page.getByLabel('功能演示验证码', { exact: true });
   if (s.workflows?.tasks.some(task => task.id === s.workflows.currentTaskId && task.status === 'authenticate')) {
    await auth.waitFor({ state: 'visible', timeout: 12000 });
    await auth.fill('123456'); const preAuth = s;
    await page.getByRole('button', { name: '验证并办理', exact: true }).click();
    s = await changed(preAuth, 'authenticate item');
   }
  }
  assert.equal(s.plan.status, 'complete', 'all plan items must finish');
  assert.equal(s.accounts[0].balance, 580000); assert.equal(s.accounts[0].held, 20000);
  assert.equal(s.receipts.length, 1);
  const goal = s.workflows.records.goals.find(g => g.id === s.plan.steps.find(x => x.functionId === 'IN02').params.goalId);
  assert.equal(goal?.balance, 40000);
  assert.ok(s.plan.steps.every(step => step.status === 'complete'), 'every result must have its own completed state');
  assert.ok(s.plan.steps.find(step => step.functionId === 'IN08')?.result, 'investment acceptance result must be recorded');
  assert.equal((s.workflows.records.holdings || []).length, 0, 'accepted investment is not a holding');
  if (!await monthly.evaluate(el => el.open)) await monthly.locator('summary').click();
  const visible = await monthly.innerText();
  for (const label of ['申请已受理', '预算已保存', '报告已生成', '5,800.00', '5,600.00', '6,200.00', '5,200.00']) assert.ok(visible.includes(label), 'visible results must include ' + label);
  await page.screenshot({ path: path.join(shots, 'results.png'), fullPage: true, animations: 'disabled' });
  report.checks.push('逐项确认及认证；房租凭证一份、活期 5800、储蓄 400、占用 200，未生成持仓');
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
   await mobileContext.route('**/*', route => { const url = new URL(route.request().url()); if (url.origin === base && !url.pathname.startsWith('/api/live/')) return route.continue(); report.errors.push(`Blocked unexpected request: ${url.origin}${url.pathname}`); return route.abort(); });
   const mobile = await mobileContext.newPage(); mobile.on('pageerror', e => report.errors.push(e.message));
   const mobileState = async () => { const r = await mobile.request.get(base + '/api/bank'); assert.equal(r.status(), 200); const data = await r.json(); assert.equal(data.liveConfigured, false); return data.state; };
   const mobileChanged = async before => { const end = Date.now() + 12000; while (Date.now() < end) { const state = await mobileState(); if (state.revision > before.revision) return state; await mobile.waitForTimeout(100); } throw new Error('Timed out waiting for mobile edit'); };
   await mobile.goto(base, { waitUntil: 'networkidle' });
   await mobile.getByRole('button', { name: '设置与连接', exact: true }).click(); await mobile.getByRole('button', { name: '路演场景', exact: true }).click();
   const scenePanel = mobile.getByRole('region', { name: '路演场景' }); await scenePanel.getByRole('combobox', { name: '选择路演场景', exact: true }).click();
   await mobile.locator('.choice-option[data-value="S08"]').click(); await scenePanel.getByRole('button', { name: '加载所选场景', exact: true }).click(); await mobile.getByRole('button', { name: '确认加载场景', exact: true }).click();
   await mobile.waitForFunction(() => document.querySelector('[aria-label="演示场景状态"]')?.textContent?.includes('S08'));
   let ms = await mobileState(); await mobile.getByLabel('输入你的要求', { exact: true }).fill('工资到了，老规矩'); await mobile.getByRole('button', { name: '发送', exact: true }).click(); ms = await mobileChanged(ms);
   for (const amount of [450, 400]) { const title = ms.plan.steps.find(step => step.functionId === 'IN02').title, before = ms; await mobile.getByLabel(title + '金额', { exact: true }).fill(String(amount)); await mobile.getByRole('button', { name: '保存' + title + '金额', exact: true }).click(); ms = await mobileChanged(before); assert.equal(ms.plan.steps.find(step => step.functionId === 'IN02').params.amount, amount); assert.equal(ms.accounts[0].balance, 800000); assert.equal(ms.receipts.length, 0); }
   const layout = await mobile.locator('.monthly-stage').evaluate(el => { const cards = [...el.children].filter(child => child.classList.contains('business-card')); return {overflow: document.documentElement.scrollWidth > innerWidth, widths: cards.map(card => card.getBoundingClientRect().width)}; });
   assert.equal(layout.overflow, false, 'mobile page must not overflow horizontally'); assert.ok(layout.widths.length >= 2 && Math.abs(layout.widths[0] - layout.widths[1]) < 1, 'monthly and current-step cards must have the same width');
   await mobile.screenshot({path: path.join(shots, 'plan-mobile.png'), fullPage: true, animations: 'disabled'});
   report.checks.push('独立 390×844 页面实际编辑储蓄 400→450→400；无横向溢出，计划和当前步骤等宽');
  } finally { await mobileContext.close(); }
  assert.deepEqual(report.errors, []); report.status = 'passed';
 } catch (e) {
  report.status = 'failed'; report.failure = e.stack || String(e); process.exitCode = 1;
  await page.screenshot({ path: path.join(shots, 'failure.png'), fullPage: true, animations: 'disabled' }).catch(() => {});
 } finally { save(); await context.close(); await browser.close(); console.log('Report: ' + reportFile); }
})().catch(e => { report.status = 'failed'; report.failure = e.stack || String(e); save(); console.error(e); process.exitCode = 1; });
