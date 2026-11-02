'use client';
// Shared building blocks for the demo-video stage. Motion is a pure function of demo time t,
// so every captured frame is reproducible.
import { createContext, useContext, type CSSProperties, type ReactNode } from 'react';
import type { View } from '@/lib/demo/runtime';

export const TimeContext = createContext<{ t: number; view: View } | null>(null);
export const useDemo = () => useContext(TimeContext)!;

export const clamp = (x: number) => Math.max(0, Math.min(1, x));
export const ease = (x: number) => 1 - Math.pow(1 - clamp(x), 3);
export const yuan = (fen: number, digits = 2) => (fen / 100).toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: 2 });

/** Fade/slide-in that starts at `at` seconds. */
export function appear(t: number, at: number, dur = 0.32, dy = 14): CSSProperties {
  const p = ease((t - at) / dur);
  return { opacity: p, transform: `translateY(${(1 - p) * dy}px)` };
}
export function flashOn(t: number, at: number | undefined, dur = 1.2) {
  return at !== undefined && t >= at && t < at + dur;
}

export function Appear({ at, children, className, dy, id }: { at: number; children: ReactNode; className?: string; dy?: number; id?: string }) {
  const { t } = useDemo();
  if (t < at) return null;
  return <div className={className} style={appear(t, at, 0.32, dy)} data-demo={id}>{children}</div>;
}

export type TagKind = 'fact' | 'infer' | 'suggest' | 'user' | 'rule' | 'calc' | 'sim' | 'draft';
const TAG_TEXT: Record<TagKind, string> = { fact: '事实', infer: '推断', suggest: '建议', user: '用户登记', rule: '已有规则', calc: '确定性计算', sim: '模拟回执', draft: '草稿' };
export function Tag({ kind, children }: { kind: TagKind; children?: ReactNode }) {
  return <span className={`tag tag-${kind}`}>{children ?? TAG_TEXT[kind]}</span>;
}

export function Chip({ tone, children, id }: { tone: 'ok' | 'wait' | 'pending' | 'info' | 'risk' | 'muted' | 'void'; children: ReactNode; id?: string }) {
  return <span className={`chip chip-${tone}`} data-demo={id}>{children}</span>;
}

export function Card({ title, badge, children, id, at, className, icon }: { title: ReactNode; badge?: ReactNode; children: ReactNode; id?: string; at: number; className?: string; icon?: ReactNode }) {
  const { t } = useDemo();
  if (t < at) return null;
  return <section className={`dcard ${className || ''}`} style={appear(t, at)} data-demo={id}>
    <header className="dcard-head">{icon}<h3>{title}</h3>{badge && <div className="dcard-badge">{badge}</div>}</header>
    {children}
  </section>;
}

export function Btn({ id, children, kind = 'primary', done, disabled }: { id: string; children: ReactNode; kind?: 'primary' | 'ghost' | 'danger'; done?: boolean; disabled?: boolean }) {
  const { t, view } = useDemo();
  const pressed = view.clicks.some(c => c.target === id && t >= c.at && t < c.at + 0.18);
  return <button type="button" className={`dbtn dbtn-${kind} ${done ? 'is-done' : ''} ${pressed ? 'is-pressed' : ''}`} data-demo={id} disabled={disabled}>{children}</button>;
}

export function Row({ k, v, tag, id, strong }: { k: ReactNode; v: ReactNode; tag?: ReactNode; id?: string; strong?: boolean }) {
  return <div className={`drow ${strong ? 'is-strong' : ''}`} data-demo={id}><span className="drow-k">{k}</span><span className="drow-v">{v}</span>{tag && <span className="drow-tag">{tag}</span>}</div>;
}

/** Streams text as it is spoken: characters revealed proportionally across [start, end]. */
export function spoken(text: string, t: number, start: number, end: number) {
  if (t >= end) return text;
  const p = clamp((t - start) / Math.max(0.1, end - start));
  return text.slice(0, Math.ceil(text.length * p));
}
