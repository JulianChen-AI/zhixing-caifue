// Frame-exact export: seeks the film page frame by frame, captures screenshots and pipes them
// to ffmpeg, then mixes every voice clip at its timeline position.
// Usage: node export.cjs [--4k|--hd] [--frames 1,10.5,33] [--out name]
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), { spawn, execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const args = process.argv.slice(2), flag = n => args.includes(n), opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const here = __dirname, root = path.resolve(here, '..'), out = path.join(root, 'out');
const scale = flag('--4k') ? 2 : 1, fps = Number(opt('--fps') || 30);
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--allow-file-access-from-files'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: scale });
    const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('file://' + path.join(here, 'index.html'));
    await page.evaluate(() => window.FilmPreview.setClean(true));
    await page.waitForFunction(() => window.FilmPreview && window.FilmPreview.ready, null, { timeout: 30000 });
    const duration = await page.evaluate(() => window.FilmPreview.duration);
    const frames = opt('--frames');
    if (frames) {
      const dir = path.join(root, 'work/frames'); fs.mkdirSync(dir, { recursive: true });
      for (const t of frames.split(',').map(Number)) { await page.evaluate(t => window.FilmPreview.seek(t), t); await page.screenshot({ path: path.join(dir, `f-${String(t).padStart(5, '0')}.png`) }); }
      console.log(JSON.stringify({ frames: frames.split(','), errors }));
      return;
    }
    const name = opt('--out') || `transfer-aa-real-${scale === 2 ? '3840x2160' : '1920x1080'}`;
    const silent = path.join(root, 'work', name + '-silent.mp4');
    const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', scale === 2 ? '16' : '18', '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart', silent], { stdio: ['pipe', 'inherit', 'inherit'] });
    const total = Math.round(duration * fps), started = Date.now();
    for (let i = 0; i < total; i++) {
      await page.evaluate(t => window.FilmPreview.seek(t), i / fps);
      const jpg = await page.screenshot({ type: 'jpeg', quality: 94 });
      if (!ff.stdin.write(jpg)) await new Promise(r => ff.stdin.once('drain', r));
      if (i % (fps * 5) === 0) process.stdout.write(`frame ${i}/${total} ${((Date.now() - started) / 1000).toFixed(0)}s\n`);
    }
    ff.stdin.end(); await new Promise((r, j) => ff.on('close', c => c ? j(new Error('ffmpeg ' + c)) : r()));
    // Voice mix: each clip delayed to its start, summed without normalizing so clip levels stay as delivered.
    const T = JSON.parse(fs.readFileSync(path.join(out, 'timeline.json'), 'utf8'));
    const inputs = T.audio.flatMap(a => ['-i', path.join(out, a.file)]);
    const filter = T.audio.map((a, i) => `[${i}:a]adelay=${Math.round(a.start * 1000)}:all=1[a${i}]`).join(';') + ';' + T.audio.map((_, i) => `[a${i}]`).join('') + `amix=inputs=${T.audio.length}:normalize=0,apad=whole_dur=${duration}[mix]`;
    const mix = path.join(out, 'voice-mix.wav');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', filter, '-map', '[mix]', '-ar', '48000', '-ac', '2', '-t', String(duration), mix]);
    const final = path.join(out, name + '.mp4');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', silent, '-i', mix, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', final]);
    console.log(JSON.stringify({ final, frames: total, seconds: (Date.now() - started) / 1000, errors }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
