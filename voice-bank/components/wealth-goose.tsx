"use client";

import { useEffect, useRef } from 'react';
import type { MascotAction, MascotCue } from '@/lib/mascot/scenario';
import { advancePlayback, createPlayback, frameId, requestPlayback, type Clips } from '@/lib/mascot/sequence';

type Manifest = { size: number; columns: number; framesPerSheet: number; sheets: string[]; actions: Record<MascotAction, { name: string; fps: number; cyclic: boolean; safeExitFrames: number[]; enter: number[]; loop: number[]; exit: number[] }> };
let manifestPromise: Promise<{ manifest: Manifest; clips: Clips }> | undefined;
function loadManifest() {
  manifestPromise ??= fetch('/mascot/manifest.json').then(async response => {
    if (!response.ok) throw new Error('Mascot unavailable');
    const wire = await response.json() as Manifest;
    const clips = {} as Clips;
    for (const id of Object.keys(wire.actions) as MascotAction[]) {
      const clip = wire.actions[id];
      clips[id] = { ...clip, loop: clip.cyclic, loopFrames: clip.loop };
    }
    return { manifest: wire, clips };
  }).catch(error => { manifestPromise = undefined; throw error; });
  return manifestPromise;
}

export function WealthGoose({ cue, small }: { cue: MascotCue; small: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const latest = useRef(cue);
  useEffect(() => { latest.current = cue; }, [cue]);

  useEffect(() => {
    let disposed = false, raf = 0;
    const images = new Map<number, HTMLImageElement>();
    const loading = new Map<number, Promise<HTMLImageElement>>();
    const failed = new Set<number>();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let previousTime = 0;
    const resume = () => { previousTime = 0; };
    document.addEventListener('visibilitychange', resume);
    reduced.addEventListener('change', resume);

    void loadManifest().then(({ manifest, clips }) => {
      if (disposed) return;
      const canvas = canvasRef.current, context = canvas?.getContext('2d');
      if (!canvas || !context) return;
      let playback = createPlayback(latest.current);
      let shown = -1;
      const sheetFor = (id: number) => Math.floor(id / manifest.framesPerSheet);
      const load = (sheet: number): Promise<HTMLImageElement> => {
        const cached = images.get(sheet);
        if (cached) { images.delete(sheet); images.set(sheet, cached); return Promise.resolve(cached); }
        const pending = loading.get(sheet);
        if (pending) return pending;
        if (failed.has(sheet) || disposed) return Promise.reject(new Error('Unavailable sheet'));
        const image = new Image();
        const promise = new Promise<HTMLImageElement>((resolve, reject) => {
          image.onload = () => {
            loading.delete(sheet);
            if (disposed) { reject(new Error('Disposed')); return; }
            images.set(sheet, image);
            // At most four decoded sheets (48 MiB at this atlas size).
            while (images.size > 4) images.delete(images.keys().next().value!);
            resolve(image);
          };
          image.onerror = () => { loading.delete(sheet); failed.add(sheet); reject(new Error('Unavailable sheet')); };
          image.src = `/mascot/${manifest.sheets[sheet]}`;
        });
        loading.set(sheet, promise);
        return promise;
      };
      const preload = (id: number) => { void load(sheetFor(id)).catch(() => {}); };
      const draw = (id: number) => {
        const sheet = sheetFor(id), image = images.get(sheet);
        if (!image) { preload(id); return false; }
        if (shown !== id) {
          const cell = id % manifest.framesPerSheet, size = manifest.size;
          context.clearRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, cell % manifest.columns * size, Math.floor(cell / manifest.columns) * size, size, size, 0, 0, canvas.width, canvas.height);
          canvas.hidden = false;
          stageRef.current?.classList.add('mascot-ready');
          shown = id;
        }
        return true;
      };
      const tick = (now: number) => {
        if (disposed) return;
        playback = requestPlayback(playback, latest.current);
        if (!document.hidden) {
          if (reduced.matches) {
            const action = latest.current.action;
            draw(clips[action].loopFrames[0]);
            if (stageRef.current) stageRef.current.dataset.action = action;
          } else {
            const id = frameId(playback, clips);
            if (draw(id)) {
              if (stageRef.current) { stageRef.current.dataset.action = playback.action; stageRef.current.dataset.phase = playback.phase; }
              const next = advancePlayback(playback, clips);
              preload(frameId(next, clips));
              // Look ahead one sheet, with bounded requests during slow loads.
              const segment = playback.phase === 'loop' ? clips[playback.action].loopFrames : playback.phase === 'exit' ? clips[playback.action].exit : clips[playback.action].enter;
              preload(segment[Math.min(segment.length - 1, playback.frame + manifest.framesPerSheet)]);
              if (!previousTime) previousTime = now;
              if (now - previousTime >= 1000 / clips[playback.action].fps) {
                playback = next;
                previousTime = now; // Do not skip poses after a slow frame or hidden tab.
              }
            } else previousTime = now;
          }
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }).catch(() => { /* A static transparent poster remains visible if assets fail. */ });
    return () => {
      disposed = true; cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', resume);
      reduced.removeEventListener('change', resume);
      images.clear();
    };
  }, []);

  return <div ref={stageRef} className={`mascot-stage ${small ? 'compact' : ''}`} aria-hidden="true" data-action="idle">
    {/* eslint-disable-next-line @next/next/no-img-element -- Local sequence poster; no optimizer is needed. */}
    <img className="mascot-poster" src="/mascot/neutral.webp" width="512" height="512" alt="" fetchPriority="high" />
    <canvas ref={canvasRef} width="512" height="512" hidden />
  </div>;
}
