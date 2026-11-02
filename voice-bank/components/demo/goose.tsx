'use client';
// Mascot canvas for the demo stage: draws the frame that gooseFrameAt() picks for time t.
import { useEffect, useRef } from 'react';
import { gooseFrameAt, type GooseManifest } from '@/lib/demo/goose';
import { useDemo } from './kit';

let manifest: GooseManifest | null = null;
const sheets = new Map<number, HTMLImageElement>();
const loading = new Map<number, Promise<HTMLImageElement>>();
/** Image loads the capture loop must wait for before taking a frame. */
export const pendingLoads = new Set<Promise<unknown>>();

export function loadGooseManifest() {
  const p = fetch('/mascot/manifest.json').then(r => r.json() as Promise<GooseManifest>).then(m => { manifest = m; return m; });
  pendingLoads.add(p); void p.finally(() => pendingLoads.delete(p));
  return p;
}

function sheet(index: number): HTMLImageElement | null {
  const ready = sheets.get(index);
  if (ready) { sheets.delete(index); sheets.set(index, ready); return ready; }
  if (!loading.has(index) && manifest) {
    const image = new Image();
    const p = new Promise<HTMLImageElement>((resolve, reject) => {
      image.onload = () => image.decode().catch(() => {}).then(() => {
        loading.delete(index); sheets.set(index, image);
        while (sheets.size > 8) sheets.delete(sheets.keys().next().value!);
        resolve(image);
      });
      image.onerror = () => { loading.delete(index); reject(new Error('sheet')); };
    });
    image.src = `/mascot/${manifest.sheets[index]}`;
    loading.set(index, p);
    pendingLoads.add(p); void p.catch(() => {}).finally(() => pendingLoads.delete(p));
  }
  return null;
}

export function DemoGoose({ size = 300 }: { size?: number }) {
  const { t, view } = useDemo();
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawn = useRef(-1);
  useEffect(() => {
    if (!manifest || !canvas.current) return;
    const id = gooseFrameAt(view.goose, t, manifest);
    const index = Math.floor(id / manifest.framesPerSheet);
    const draw = (image: HTMLImageElement) => {
      const ctx = canvas.current?.getContext('2d');
      if (!ctx || !manifest) return;
      const cell = id % manifest.framesPerSheet, s = manifest.size;
      ctx.clearRect(0, 0, 512, 512);
      ctx.drawImage(image, cell % manifest.columns * s, Math.floor(cell / manifest.columns) * s, s, s, 0, 0, 512, 512);
      drawn.current = id;
    };
    if (drawn.current === id) return;
    const ready = sheet(index);
    if (ready) draw(ready);
    else void loading.get(index)?.then(image => { if (gooseFrameAt(view.goose, t, manifest!) === id) draw(image); });
    // Warm the next sheet so playback does not stall at sheet boundaries.
    sheet(Math.min(manifest.sheets.length - 1, Math.floor(gooseFrameAt(view.goose, t + 1, manifest) / manifest.framesPerSheet)));
  });
  return <canvas ref={canvas} width={512} height={512} style={{ width: size, height: size }} className="goose-canvas" aria-hidden="true" />;
}
