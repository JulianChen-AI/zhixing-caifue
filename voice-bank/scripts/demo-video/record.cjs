// Captures the /demo stage frame by frame (deterministic seek, not screen recording).
// Usage:
//   node scripts/demo-video/record.cjs --url http://127.0.0.1:5201 --out <dir> [--fps 30] [--workers 4] [--from 0 --to 300]
//   node scripts/demo-video/record.cjs --url ... --out <dir> --shots 12.5,40,90   (stills for review)
// Writes frames as <out>/frames/f_00000.jpg plus <out>/timeline.json (lines, acts, chapters).
const path = require('node:path'), os = require('node:os'), fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const url = arg('url', 'http://127.0.0.1:5201'), out = arg('out', 'demo-out');
const fps = Number(arg('fps', 30)), workers = Number(arg('workers', 4));
const shots = arg('shots', '');
const executablePath = process.env.CHROME_PATH || path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell');

async function openStage(browser) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`${url}/demo?capture=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__demo && document.querySelector('.stage'), null, { timeout: 60_000 });
  return { page, errors };
}

(async () => {
  fs.mkdirSync(path.join(out, 'frames'), { recursive: true });
  const browser = await chromium.launch({ executablePath, args: ['--font-render-hinting=none', '--force-color-profile=srgb'] });
  const { page, errors } = await openStage(browser);
  const info = await page.evaluate(() => ({ duration: window.__demo.duration, compiled: window.__demo.compiled, errors: window.__demo.errors }));
  fs.writeFileSync(path.join(out, 'timeline.json'), JSON.stringify(info.compiled, null, 1));
  if (info.errors.length) { console.error('Script errors:', info.errors); process.exitCode = 2; }

  if (shots) {
    for (const t of shots.split(',').map(Number)) {
      await page.evaluate(x => window.__demo.seek(x), t);
      const file = path.join(out, `shot_${String(t).replace('.', '_')}.png`);
      await page.screenshot({ path: file });
      console.log(file);
    }
    if (errors.length) console.error('Page errors:', errors);
    await browser.close();
    return;
  }

  const from = Number(arg('from', 0)), to = Math.min(Number(arg('to', info.duration)), info.duration);
  const first = Math.round(from * fps), last = Math.round(to * fps) - 1;
  const todo = [];
  for (let f = first; f <= last; f++) if (!fs.existsSync(path.join(out, 'frames', `f_${String(f).padStart(5, '0')}.jpg`))) todo.push(f);
  console.log(`frames ${first}–${last}, ${todo.length} to render with ${workers} workers`);
  const pages = [{ page, errors }];
  for (let i = 1; i < workers; i++) pages.push(await openStage(browser));
  // Each worker takes a contiguous block so the mascot sheet cache stays warm.
  const block = Math.ceil(todo.length / workers);
  let done = 0, started = Date.now();
  await Promise.all(pages.map(async ({ page: p }, w) => {
    for (const f of todo.slice(w * block, (w + 1) * block)) {
      await p.evaluate(x => window.__demo.seek(x), f / fps);
      await p.screenshot({ path: path.join(out, 'frames', `f_${String(f).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 95 });
      if (++done % 300 === 0) console.log(`${done}/${todo.length} · ${((Date.now() - started) / done).toFixed(0)} ms/frame`);
    }
  }));
  const pageErrors = pages.flatMap(p => p.errors);
  if (pageErrors.length) { console.error('Page errors:', pageErrors.slice(0, 10)); process.exitCode = 3; }
  console.log(`done ${todo.length} frames in ${((Date.now() - started) / 1000).toFixed(0)} s`);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
