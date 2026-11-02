// Offline replay of one real run. Every bank state shown here was returned by the backend
// during the recorded Qwen session (or, for the authentication step, produced by the same
// reducer from the recorded review state). No bank, voice or model service is contacted.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import Home from '@/app/page';
import { mascotCue } from '@/lib/mascot/scenario';
import { advancePlayback, createPlayback, frameId, requestPlayback, type Clips } from '@/lib/mascot/sequence';
import manifestWire from '@/public/mascot/manifest.json';

type Segment = { from: number; to: number; state: string; phase: 'listening' | 'speaking' | 'thinking'; busy?: boolean; reply?: { text: string; from: number; to: number }; hold?: string; scroll?: { from: number; to: number; y0: number; y1: number }; code?: { from: number; to: number } };
type Timeline = { duration: number; states: Record<string, any>; segments: Segment[] };
const film = window as any;
film.__FILM_CLOCK = true;
const timeline: Timeline = film.FILM_TIMELINE;
const initial = timeline.states.initial;

const nativeFetch = window.fetch.bind(window);
window.fetch = async (input: any, options?: any) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url === '/api/bank') return new Response(JSON.stringify({ state: initial, liveConfigured: true }), { headers: { 'Content-Type': 'application/json' } });
  if (String(url).startsWith('/api/')) throw new Error('Film replay never calls bank or voice APIs.');
  return nativeFetch(input, options);
};

const root = createRoot(document.getElementById('root')!);
root.render(<Home />);

const manifest = manifestWire as any;
const clips = Object.fromEntries(Object.entries(manifest.actions).map(([id, a]: any) => [id, { ...a, loop: a.cyclic, loopFrames: a.loop }])) as Clips;
const segmentAt = (t: number) => timeline.segments.find(s => t >= s.from && t < s.to) || timeline.segments[timeline.segments.length - 1];
const payloadAt = (t: number) => {
  const s = segmentAt(t), bank = timeline.states[s.state];
  let text = '';
  if (s.reply) { const chars = Array.from(s.reply.text), p = Math.max(0, Math.min(1, (t - s.reply.from) / Math.max(0.01, s.reply.to - s.reply.from))); text = chars.slice(0, Math.ceil(chars.length * p)).join(''); }
  else if (s.hold) text = s.hold;
  const busy = !!s.busy, phase = s.phase === 'thinking' ? 'listening' : s.phase;
  return { bank, busy, phase, messages: text ? [{ id: 'assistant:film', speaker: 'assistant', text }] : [], reply: '', segment: s };
};
// Mascot frames follow the product's own cue mapping, advanced on a fixed 12 FPS clock.
const FPS = 12, frames: number[] = [];
{
  const cueAt = (t: number) => { const p = payloadAt(t); return mascotCue({ bank: p.bank, phase: p.phase, mode: 'live', muted: false, busy: p.busy, connecting: false, closing: false, recovering: false, error: '' }); };
  let playback = createPlayback(cueAt(0));
  for (let i = 0; i <= Math.ceil(timeline.duration * FPS); i++) { playback = requestPlayback(playback, cueAt(i / FPS)); frames.push(frameId(playback, clips)); playback = advancePlayback(playback, clips); }
}
const sheets = new Map<number, Promise<HTMLImageElement>>();
const sheet = (index: number) => {
  if (!sheets.has(index)) sheets.set(index, new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = `assets/mascot/${manifest.sheets[index]}`; }));
  return sheets.get(index)!;
};
let lastFrame = -1;
async function drawMascot(t: number) {
  const id = frames[Math.min(frames.length - 1, Math.floor(t * FPS))], image = await sheet(Math.floor(id / manifest.framesPerSheet));
  const canvas = document.querySelector('.mascot-stage canvas') as HTMLCanvasElement | null;
  if (!canvas) return;
  if (id !== lastFrame) {
    const cell = id % manifest.framesPerSheet, size = manifest.size, context = canvas.getContext('2d')!;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, cell % manifest.columns * size, Math.floor(cell / manifest.columns) * size, size, size, 0, 0, canvas.width, canvas.height);
    lastFrame = id;
  }
  canvas.hidden = false; canvas.parentElement!.classList.add('mascot-ready');
}

let lastKey = '';
const setNativeValue = (input: HTMLInputElement, value: string) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); };
film.ProductReplay = {
  duration: timeline.duration,
  async ready() {
    for (let i = 0; i < 200 && !film.__filmSetState; i++) await new Promise(r => setTimeout(r, 20));
    if (!film.__filmSetState) throw new Error('Product component did not mount.');
    await Promise.all(Array.from(new Set(frames.map(id => Math.floor(id / manifest.framesPerSheet)))).map(sheet));
    this.render(0); await drawMascot(0);
  },
  render(t: number) {
    const p = payloadAt(t), s = p.segment;
    const key = JSON.stringify([s.state, p.busy, p.phase, p.messages[0]?.text || '']);
    if (key !== lastKey) { flushSync(() => film.__filmSetState(p)); lastKey = key; }
    const code = document.querySelector('input[aria-label="功能演示验证码"],input[aria-label="演示验证码"]') as HTMLInputElement | null;
    if (code && s.code) { const n = Math.max(0, Math.min(6, Math.floor(6 * (t - s.code.from) / (s.code.to - s.code.from)))); const value = '123456'.slice(0, n); if (code.value !== value) setNativeValue(code, value); }
    const y = s.scroll ? s.scroll.y0 + (s.scroll.y1 - s.scroll.y0) * Math.max(0, Math.min(1, (t - s.scroll.from) / (s.scroll.to - s.scroll.from))) : 0;
    window.scrollTo(0, Math.round(y));
    void drawMascot(t);
  },
  async renderAt(t: number) { this.render(t); await drawMascot(t); await new Promise(r => requestAnimationFrame(() => r(null))); },
  geometry(selector: string) { const el = document.querySelector(selector); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; },
};
