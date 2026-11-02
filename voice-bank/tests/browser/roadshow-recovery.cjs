// Native UI mutations only; the three negative stale-auth checks deliberately POST old cards.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base = process.env.BANK_TEST_URL || 'http://127.0.0.1:5196';
if (base !== 'http://127.0.0.1:5196') throw new Error('This test is restricted to the 5196 local sandbox.');
const reportFile = process.env.BANK_TEST_REPORT || path.join(os.homedir(), '30_Developer', 'webank-roadshow-recovery', 'report.json');
if (!path.isAbsolute(reportFile)) throw new Error('BANK_TEST_REPORT must be an absolute path.');
fs.mkdirSync(path.dirname(reportFile), { recursive: true });
const shots = fs.mkdtempSync(path.join(path.dirname(reportFile), 'recovery-shots-'));
const report = { status: 'running', base, realQwen: false, checks: [], errors: [], screenshots: shots };
const save = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
(async () => {
 const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
 const contexts = [];
 async function create() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } }); contexts.push(context);
  await context.route('**/*', route => { const url = new URL(route.request().url()); if (url.origin === base && !url.pathname.startsWith('/api/live/')) return route.continue(); report.errors.push(`Blocked unexpected request: ${url.origin}${url.pathname}`); return route.abort(); });
  const page = await context.newPage(); page.on('pageerror', e => report.errors.push(e.message));
  const state = async () => { const r = await page.request.get(base + '/api/bank'); assert.equal(r.status(), 200); const data = await r.json(); assert.equal(data.liveConfigured, false, 'provider must be disabled'); return data.state; };
  const until = async (predicate, label) => { const end = Date.now() + 12000; while (Date.now() < end) { const s = await state(); if (predicate(s)) return s; await page.waitForTimeout(100); } throw new Error('Timed out waiting for ' + label); };
  const changed = (before, label) => until(s => s.revision > before.revision, label);
  const send = async text => { const before = await state(); await page.getByLabel('输入你的要求', { exact: true }).fill(text); await page.getByRole('button', { name: '发送', exact: true }).click(); return changed(before, text); };
  await page.goto(base, { waitUntil: 'networkidle' }); await state();
  return { page, state, until, changed, send };
 }
 async function load(c, id) {
  const { page, state } = c; await page.getByRole('button', { name: '设置与连接', exact: true }).click();
  await page.getByRole('button', { name: '路演场景', exact: true }).click();
  const panel = page.getByRole('region', { name: '路演场景' });
  await panel.getByRole('combobox', { name: '选择路演场景', exact: true }).click();
  await page.locator(`.choice-option[data-value="${id}"]`).click();
  await panel.getByRole('button', { name: '加载所选场景', exact: true }).click();
  await page.getByRole('button', { name: '确认加载场景', exact: true }).click();
  await page.waitForFunction(id => document.querySelector('[aria-label="演示场景状态"]')?.textContent?.includes(id), id);
  const s = await state(); assert.equal(s.sceneId, id); return s;
 }
 async function unknown(c, shot) {
  const { page, state, changed, send } = c;
  await load(c, 'S08-U'); let s = await send('工资到了，老规矩'); assert.ok(s.plan?.monthly);
  await page.getByLabel('本月安排', { exact: true }).waitFor({ state: 'visible' });
  const resume = page.getByRole('button', { name: /^(继续任务|继续办理)$/ }).first(); await resume.waitFor({ state: 'visible' });
  let before = s; await resume.click(); s = await changed(before, 'resume monthly');
  const confirm = page.getByRole('button', { name: /^手动确认/ }); await confirm.waitFor({ state: 'visible' });
  before = s; await confirm.click(); s = await changed(before, 'confirm rent');
  const auth = page.getByLabel('功能演示验证码', { exact: true }); await auth.waitFor({ state: 'visible' });
  assert.equal(s.task?.step, 'authenticate'); const token = s.task.verificationId, epoch = s.sceneEpoch; assert.ok(token && epoch);
  await auth.fill('123456'); before = s; await page.getByRole('button', { name: '验证并办理', exact: true }).click();
  s = await changed(before, 'unknown result'); assert.equal(s.plan.status, 'blocked');
  assert.equal(s.workflows.records.transfers.length, 1); assert.equal(s.workflows.records.transfers[0].status, 'unknown'); assert.equal(s.receipts.length, 0); assert.equal(s.accounts[0].balance, 800000);
  await page.getByText(/回查原订单/).first().waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(shots, shot), fullPage: true, animations: 'disabled' });
  return { s, token, epoch };
 }
 async function stale(c, token, epoch) {
  const before = await c.state(); const response = await c.page.request.post(base + '/api/bank', { data: { requestId: crypto.randomUUID(), revision: before.revision, sceneEpoch: epoch, action: { type: 'authenticate', code: '123456', verificationId: token } } });
  assert.ok(response.status() >= 400 && response.status() < 500, `stale auth must be 4xx, got ${response.status()}`);
  const after = await c.state(); assert.equal(after.revision, before.revision); assert.deepEqual(after.accounts, before.accounts); assert.deepEqual(after.receipts, before.receipts); return response.status();
 }
 async function budget(c, first, updates) {
  const { page, send } = c; await load(c, 'S08'); let s = await send('工资到了，老规矩');
  await page.getByLabel('本月安排', { exact: true }).waitFor({ state: 'visible' });
  for (const [text, amount] of [[first, 400], ...updates]) {
   s = await send(text); const entries = s.plan.steps.filter(x => x.functionId === 'BI08'); assert.equal(entries.length, 1); assert.equal(entries[0].params.amount, amount);
   const input = page.getByLabel(entries[0].title + '金额', { exact: true }); await input.waitFor({ state: 'visible' });
   await page.waitForFunction(([label, value]) => document.querySelector(`input[aria-label="${label}"]`)?.value === String(value), [entries[0].title + '金额', amount]);
   assert.equal(s.accounts[0].balance, 800000); assert.equal(s.accounts[0].held || 0, 0); assert.equal(s.receipts.length, 0);
  }
  return s;
 }
 try {
  const c = await create(); const { token, epoch } = await unknown(c, 'unknown.png');
  const status = await stale(c, token, epoch); report.checks.push(`未知结果后旧版认证返回 ${status}；无扣款，原模拟订单一笔，凭证零份`);
  const s01 = await load(c, 'S01'); assert.equal(s01.accounts[0].balance, 28660); assert.notEqual(s01.sceneEpoch, epoch);
  const oldStatus = await stale(c, token, epoch), newStatus = await stale(c, token, s01.sceneEpoch);
  assert.equal((await c.state()).accounts[0].balance, 28660); report.checks.push(`UI 切换 S01 余额 286.60；旧认证旧 epoch=${oldStatus}、新 epoch=${newStatus}，均未改变资金`);
  const d = await create(); await unknown(d, 'unknown-before-reset.png');
  await d.page.getByRole('button', { name: '设置与连接', exact: true }).click(); await d.page.getByRole('button', { name: '重置演示数据', exact: true }).click();
  const beforeReset = await d.state(); await d.page.getByRole('region', { name: '重置演示' }).getByRole('button', { name: '重置演示', exact: true }).click();
  const reset = await d.changed(beforeReset, 'reset'); assert.equal(reset.sceneId, 'default');
  await d.page.waitForFunction(() => document.querySelector('[aria-label="演示场景状态"]')?.textContent?.includes('默认演示')); report.checks.push('独立会话未知结果后通过 UI 重置为 default');
  const e = await create(); await budget(e, '加一个，这周请爸妈吃饭，先留400。', [['先留四百五十', 450], ['先留四百', 400]]);
  const banner = e.page.getByLabel('演示场景状态', { exact: true }); const bannerText = await banner.innerText(); assert.match(bannerText, /模拟数据/); assert.match(bannerText, /模拟时间/);
  const overflow = await e.page.evaluate(() => document.documentElement.scrollWidth > innerWidth); assert.equal(overflow, false, 'mobile layout must not overflow horizontally');
  await e.page.screenshot({ path: path.join(shots, 'budget-mobile.png'), fullPage: true, animations: 'disabled' }); report.checks.push('UI 预算 400→450→400，模拟数据及模拟时间可见，390px 无横溢');
  const f = await create(); await budget(f, '加一个，这周请爸妈吃饭，先留四百。', []); await f.page.screenshot({ path: path.join(shots, 'budget-chinese.png'), fullPage: true, animations: 'disabled' }); report.checks.push('独立会话中文完整剧本创建 400 元预算');
  assert.deepEqual(report.errors, []); report.status = 'passed';
 } catch (e) { report.status = 'failed'; report.failure = e.stack || String(e); process.exitCode = 1; for (const ctx of contexts) for (const page of ctx.pages()) await page.screenshot({ path: path.join(shots, `failure-${contexts.indexOf(ctx)}.png`), fullPage: true, animations: 'disabled' }).catch(() => {}); }
 finally { save(); for (const ctx of contexts) await ctx.close(); await browser.close(); console.log('Report: ' + reportFile); }
})().catch(e => { report.status = 'failed'; report.failure = e.stack || String(e); save(); console.error(e); process.exitCode = 1; });
