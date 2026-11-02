// Builds the offline product surface from the app source. Only two build-time patches are
// applied (the app files on disk are untouched): a state hook so the replay can set recorded
// states, and local asset paths plus an external frame clock for the mascot.
import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url'; import crypto from 'node:crypto';
const here = path.dirname(fileURLToPath(import.meta.url));
const WB = process.env.VOICE_BANK || path.resolve(here, '../../..');
const require = createRequire(path.join(WB, 'package.json'));
const esbuild = require('esbuild');
const dist = path.join(here, 'dist'); fs.mkdirSync(dist, { recursive: true });

const patches = {
  [path.join(WB, 'app/page.tsx')]: source => {
    const anchor = 'const [viewportHeight, setViewportHeight] = useState<number>();';
    if (!source.includes(anchor)) throw new Error('page.tsx anchor moved');
    return source.replace(anchor, anchor + `
  useEffect(()=>{(window as any).__filmSetState=(p:any)=>{bankRef.current=p.bank;setBank(p.bank);setConfigured(true);modeRef.current='live';setMode('live');setPhase(p.phase);setBusy(!!p.busy);setVerifiedReply(p.reply||'');transcriptRef.current=p.messages||[];setMessages(p.messages||[]);setDrawer(p.drawer??null);setError('');};},[]);`);
  },
  [path.join(WB, 'components/wealth-goose.tsx')]: source => {
    const loop = 'void loadManifest().then(';
    if (!source.includes(loop) || !source.includes('"/mascot/neutral.webp"')) throw new Error('wealth-goose anchors moved');
    return source.replace(loop, 'if(!(window as any).__FILM_CLOCK)' + loop).replace('"/mascot/neutral.webp"', '"assets/mascot/neutral.webp"');
  },
};
const plugin = {
  name: 'film', setup(build) {
    build.onResolve({ filter: /^@\// }, async args => build.resolve('./' + args.path.slice(2), { resolveDir: WB, kind: args.kind }));
    build.onLoad({ filter: /\.(tsx|ts)$/ }, async args => {
      const patch = patches[args.path]; if (!patch) return undefined;
      return { contents: patch(fs.readFileSync(args.path, 'utf8')), loader: args.path.endsWith('x') ? 'tsx' : 'ts' };
    });
  },
};
await esbuild.build({ entryPoints: [path.join(here, 'src/replay.tsx')], bundle: true, format: 'iife', minify: true, jsx: 'automatic', target: 'es2022', outfile: path.join(dist, 'product-replay.js'), define: { 'process.env.NODE_ENV': '"production"' }, nodePaths: [path.join(WB, 'node_modules')], loader: { '.json': 'json' }, plugins: [plugin], logLevel: 'warning' });

const cssDir = path.join(WB, 'dist/client/_next/static/css');
const css = fs.readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => fs.readFileSync(path.join(cssDir, f), 'utf8')).join('\n');
const timeline = fs.readFileSync(path.join(here, 'data/timeline.js'), 'utf8');
const bundle = fs.readFileSync(path.join(dist, 'product-replay.js'), 'utf8');
const freeze = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}html{scrollbar-width:none}html::-webkit-scrollbar{display:none}';
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><style>${freeze}</style></head><body><div id="root"></div><script>${timeline}</script><script>${bundle}</script></body></html>`;
fs.writeFileSync(path.join(dist, 'product-surface.js'), 'window.PRODUCT_SURFACE = ' + JSON.stringify(html).replace(/<\/script/gi, '<\\/script') + ';\n');

const mascotOut = path.join(here, 'assets/mascot'); fs.mkdirSync(mascotOut, { recursive: true });
for (const f of fs.readdirSync(path.join(WB, 'public/mascot'))) fs.copyFileSync(path.join(WB, 'public/mascot', f), path.join(mascotOut, f));
const digest = f => crypto.createHash('sha256').update(fs.readFileSync(path.join(WB, f))).digest('hex');
fs.writeFileSync(path.join(dist, 'product-source.json'), JSON.stringify({ builtAt: new Date().toISOString(), sourceRoot: WB, files: ['app/page.tsx', 'components/workflow-panel.tsx', 'components/serial-stage.tsx', 'components/wealth-goose.tsx', 'lib/workflows/review.ts'].map(file => ({ file, sha256: digest(file) })) }, null, 1));
console.log('built', (fs.statSync(path.join(dist, 'product-surface.js')).size / 1024).toFixed(0) + 'KB');
