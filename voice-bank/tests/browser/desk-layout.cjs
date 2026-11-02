// Desktop desk layout against the real page and local sandbox; no Qwen, microphone or test-only business APIs.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base = process.env.BANK_TEST_URL || 'http://127.0.0.1:5194';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base)) throw new Error('This test is restricted to a local sandbox.');
const reportFile = process.env.BANK_TEST_REPORT || path.join(os.homedir(), '30_Developer', 'webank-desk-layout', 'report.json');
if (!path.isAbsolute(reportFile)) throw new Error('BANK_TEST_REPORT must be an absolute path.');
fs.mkdirSync(path.dirname(reportFile), { recursive: true });
const shots = fs.mkdtempSync(path.join(path.dirname(reportFile), 'desk-shots-'));
const report = { status: 'running', base, realQwen: false, checks: [], errors: [], screenshots: shots };
const save = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
(async () => {
 const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
 const context = await browser.newContext({ viewport: { width: 1440, height: 860 } });
 const page = await context.newPage();
 page.on('pageerror', e => report.errors.push(e.message));
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
 const card = () => page.getByRole('region', { name: '功能办理卡片', exact: true });
 const confirmCurrent = async () => {
  const before = await state();
  const ack = card().getByRole('checkbox'); if (await ack.count()) await ack.check();
  await card().getByRole('button', { name: /^手动确认/ }).click();
  await page.getByLabel('功能演示验证码', { exact: true }).fill('123456');
  await card().getByRole('button', { name: '验证并办理', exact: true }).click();
  return until(s => s.revision > before.revision + 1, 'authenticated step');
 };
 const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no horizontal scroll');
 const shot = name => page.screenshot({ path: path.join(shots, name + '.png') });
 try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '设置与连接', exact: true }).click();
  await page.getByRole('button', { name: '重置演示数据', exact: true }).click();
  await page.getByRole('button', { name: '重置演示', exact: true }).click();
  await page.waitForTimeout(400);

  // Three columns on a wide screen; the composer lives in the conversation column.
  const columns = await page.locator('.desk > *').count();
  assert.equal(columns, 3);
  const chat = page.getByRole('complementary', { name: '对话区', exact: true });
  await chat.getByLabel('输入你的要求', { exact: true }).waitFor();
  await page.getByRole('complementary', { name: '鹅豆', exact: true }).locator('.mascot-stage').waitFor();
  await noOverflow();
  report.checks.push('宽屏三栏：对话区含输入框，鹅豆独立一栏，无横向滚动');

  await send('给张三转五百元');
  const log = page.getByRole('log', { name: '对话', exact: true });
  await log.getByText('给张三转五百元', { exact: true }).waitFor();
  assert.ok(await log.locator('.chat-bubble.is-assistant').count() >= 1, 'assistant reply in the feed');
  await card().waitFor();
  await shot('wide-transfer');
  report.checks.push('文字指令进入对话流，业务卡片出现在中间栏');

  // Load S08 through the page and open the saved monthly plan.
  await page.getByRole('button', { name: '设置与连接', exact: true }).click();
  await page.getByRole('button', { name: '路演场景', exact: true }).click();
  await page.getByRole('combobox', { name: '选择路演场景', exact: true }).click();
  await page.locator('.choice-option[data-value="S08"]').click();
  await page.getByRole('button', { name: '加载所选场景', exact: true }).click();
  await page.getByRole('button', { name: '确认加载场景', exact: true }).click();
  await until(s => s.sceneId === 'S08', 'S08 loaded');
  await send('工资到了，老规矩');
  const map = page.getByRole('region', { name: '任务地图', exact: true });
  await map.waitFor();
  assert.equal(await map.locator('.station').count(), 4);
  await page.getByRole('button', { name: '继续办理', exact: true }).click();
  await map.locator('.station.is-current').waitFor();
  report.checks.push('S08 月度计划显示为 4 站任务地图，当前一站高亮');

  let s = await confirmCurrent();
  await map.locator('.station').first().getByText('已转出').waitFor();
  const receipts = page.getByRole('region', { name: '办理回执', exact: true });
  await receipts.getByText('已转出').waitFor();
  s = await confirmCurrent();
  const risk = page.getByRole('region', { name: '风险匹配', exact: true });
  await risk.waitFor();
  const riskText = await risk.innerText();
  assert.match(riskText, /C3/); assert.match(riskText, /R\d/);
  const disclosure = page.getByRole('region', { name: '费用与风险', exact: true });
  assert.match(await disclosure.innerText(), /不保证本金/);
  assert.equal(await card().getByRole('button', { name: /^手动确认/ }).isDisabled(), true, 'purchase waits for the risk acknowledgement');
  await shot('wide-invest-risk');
  report.checks.push('申购核对卡显示测评等级、产品风险和非存款提示');

  s = await confirmCurrent();
  await map.locator('.station').nth(2).getByText('已受理 · 待结算').waitFor();
  await receipts.getByText('已受理 · 待结算').waitFor();
  const receiptText = await receipts.innerText();
  assert.doesNotMatch(receiptText, /policyVersion|checklist|audit/i);
  assert.ok(!(await map.locator('.station').nth(2).getAttribute('class')).includes('tone-ok'), 'accepted order is not drawn as success');
  await shot('wide-monthly-done');
  report.checks.push('申购只显示已受理·待结算，不显示成功；回执不含内部审计字段');

  // Margins, gaps and all three columns widen together as room appears; the centre stays widest.
  let previous = null;
  for (const [width, height] of [[1008, 750], [1280, 800], [1440, 860], [1920, 1080], [2560, 1300]]) {
   await page.setViewportSize({ width, height });
   await page.waitForTimeout(300);
   const m = await page.evaluate(() => { const r = s => document.querySelector(s).getBoundingClientRect(); const [chat, centre, goose] = [...document.querySelectorAll('.desk > *')].map(el => el.getBoundingClientRect().width); return { margin: r('.desk-chat').left, chat, centre, goose }; });
   assert.ok(m.centre > m.chat && m.centre > m.goose, `${width}: centre ${m.centre} wider than ${m.chat} / ${m.goose}`);
   assert.ok(m.centre >= 440, `${width}: centre ${m.centre} keeps a card readable`);
   if (previous) for (const key of ['margin', 'chat', 'centre', 'goose']) assert.ok(m[key] >= previous[key], `${width}: ${key} ${m[key]} does not shrink from ${previous[key]}`);
   const fit = await page.evaluate(() => { const r = s => document.querySelector(s).getBoundingClientRect(); return { chat: r('.desk-chat'), composer: r('.desk-chat .composer'), mic: r('.desk-chat .control-button') }; });
   assert.ok(fit.mic.left >= fit.chat.left && fit.composer.right <= fit.chat.right, `${width}: input row stays inside the conversation column`);
   assert.ok(fit.mic.width >= 40, `${width}: microphone button keeps its size (${fit.mic.width})`);
   previous = m;
   await noOverflow();
  }
  report.checks.push('1008→2560 宽度下边距、两侧栏、中间栏一起变宽，中间栏始终最宽，无横向滚动；输入行不超出对话栏');

  // Narrower than 1000px the serial layout returns.
  await page.setViewportSize({ width: 990, height: 750 });
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.desk').count(), 0, '990px stays serial');
  report.checks.push('宽度 990px 保持单列');

  // Phones keep the serial layout.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.desk').count(), 0);
  assert.ok(await page.locator('.business-card:visible').count() >= 1);
  await noOverflow();
  await page.setViewportSize({ width: 320, height: 640 });
  await page.waitForTimeout(300);
  const phone = await page.evaluate(() => { const r = s => document.querySelector(s).getBoundingClientRect(); return { composer: r('.composer'), mic: r('.control-button') }; });
  assert.ok(phone.mic.left >= 0 && phone.composer.right <= 320 && phone.mic.width >= 40, '320px phone keeps the input row on screen');
  await noOverflow();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await shot('phone-serial');
  report.checks.push('手机宽度回到单列，无横向滚动');


  assert.deepEqual(report.errors, []);
  report.status = 'passed';
 } catch (error) {
  report.status = 'failed'; report.failure = error.stack || String(error); process.exitCode = 1;
  await shot('failure').catch(() => {});
 } finally {
  save(); await browser.close();
  console.log('Report: ' + reportFile);
  console.log(report.status, report.checks.length + ' checks');
 }
})();
