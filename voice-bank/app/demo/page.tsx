'use client';
// Demo-video stage (演示环境专用，不进入正式产品). Plays the director script in real time, or,
// with ?capture=1, waits for window.__demo.seek(t) so each video frame is rendered deterministically.
// Keys: space play/pause · ←/→ ±5 s · 1–8 jump to chapter · r restart.
import { useEffect, useMemo, useRef, useState } from 'react';
import voiceLines from '@/lib/demo/voice-lines.json';
import voiceManifest from '@/public/demo/voice/manifest.json';
import { CHAPTERS, VIDEO_SECONDS } from '@/lib/demo/script';
import { compile } from '@/lib/demo/timeline';
import { viewAt } from '@/lib/demo/runtime';
import { Stage } from '@/components/demo/stage';
import { loadGooseManifest, pendingLoads } from '@/components/demo/goose';
import './demo.css';

declare global { interface Window { __demo?: { duration: number; compiled: unknown; errors: string[]; seek: (t: number) => Promise<number> } } }

const seconds = Object.fromEntries(Object.entries(voiceManifest.clips).map(([id, c]) => [id, c.seconds]));
const nextFrame = () => new Promise(r => requestAnimationFrame(() => r(null)));

export default function DemoPage() {
  const compiled = useMemo(() => compile(CHAPTERS, voiceLines, seconds, VIDEO_SECONDS), []);
  const params = typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const capture = params.get('capture') === '1';
  const withAudio = params.get('audio') === '1';
  const [t, setT] = useState(Number(params.get('t')) || 0);
  const [playing, setPlaying] = useState(!capture);
  const [ready, setReady] = useState(false);
  const [scale, setScale] = useState(1);
  const [, bump] = useState(0);
  const resolveSeek = useRef<((v: number) => void) | null>(null);
  const audio = useRef<Map<string, HTMLAudioElement>>(new Map());

  useEffect(() => { void loadGooseManifest().then(() => setReady(true)); }, []);
  useEffect(() => {
    const fit = () => setScale(capture ? 1 : Math.min(window.innerWidth / 1920, window.innerHeight / 1080));
    fit(); window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [capture]);

  // Real-time playback for preview; capture mode is driven only by seek().
  useEffect(() => {
    if (capture || !playing || !ready) return;
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      setT(x => Math.min(compiled.duration, x + (now - last) / 1000));
      last = now; raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [capture, playing, ready, compiled.duration]);

  // Optional voice playback in preview, aligned to each line's start.
  useEffect(() => {
    if (!withAudio || capture) return;
    for (const line of compiled.lines) {
      let el = audio.current.get(line.id);
      if (!el) { el = new Audio(`/demo/voice/${line.id}.wav`); audio.current.set(line.id, el); }
      const inside = t >= line.start && t < line.end;
      if (inside && playing && el.paused) { el.currentTime = t - line.start; void el.play().catch(() => {}); }
      if ((!inside || !playing) && !el.paused) el.pause();
    }
  }, [t, playing, withAudio, capture, compiled.lines]);

  useEffect(() => {
    if (capture) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ') { e.preventDefault(); setPlaying(p => !p); }
      if (e.key === 'ArrowRight') setT(x => Math.min(compiled.duration, x + 5));
      if (e.key === 'ArrowLeft') setT(x => Math.max(0, x - 5));
      if (e.key === 'r') setT(0);
      const n = Number(e.key);
      if (n >= 1 && n <= compiled.chapters.length) setT(compiled.chapters[n - 1].start + 0.01);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [capture, compiled]);

  const view = useMemo(() => viewAt(compiled, t), [compiled, t]);

  // Resolve a pending seek once React has committed, images are decoded and fonts are ready.
  useEffect(() => {
    const done = resolveSeek.current;
    if (!done) return;
    resolveSeek.current = null;
    void (async () => {
      await document.fonts.ready;
      for (let i = 0; i < 3; i++) { await nextFrame(); while (pendingLoads.size) await Promise.allSettled([...pendingLoads]); }
      await nextFrame();
      done(t);
    })();
  });

  useEffect(() => {
    window.__demo = {
      duration: compiled.duration, compiled, errors: viewAt(compiled, compiled.duration + 1).errors,
      seek: (next: number) => new Promise<number>(resolve => { resolveSeek.current = resolve; setT(next); setPlaying(false); bump(x => x + 1); }),
    };
  }, [compiled]);

  if (!ready) return <div className="demo-loading">载入演示……</div>;
  return <div className={`demo-root ${capture ? 'is-capture' : ''}`}>
    <div className="stage-scale" style={{ transform: `scale(${scale})` }}>
      <Stage compiled={compiled} view={view} />
    </div>
    {!capture && params.get('hud') !== '0' && <div className="hud">{t.toFixed(1)}s / {compiled.duration}s · {compiled.chapters.find(c => t >= c.start && t < c.end)?.title} · {playing ? '播放' : '暂停'}（空格）{view.errors.length ? ` · 错误 ${view.errors.length}` : ''}</div>}
  </div>;
}
