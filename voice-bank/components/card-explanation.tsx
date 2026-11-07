'use client';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { cardSnapshot, cardDataKey, createExplanationCache, type CardSnapshot } from '@/lib/bank/card-explanation';
import type { FlowTask } from '@/lib/workflows/types';
import { ChevronUp, RotateCw, Sparkles } from 'lucide-react';

type Cache = ReturnType<typeof createExplanationCache>;
const ExplanationContext = createContext<Cache | null>(null);
const newCache = () => createExplanationCache(async () => { throw new Error('Missing explanation loader'); });

export function CardExplanationProvider({ children }: { children: ReactNode }) {
  const [cache] = useState(newCache);
  return <ExplanationContext.Provider value={cache}>{children}</ExplanationContext.Provider>;
}

export function CardExplanation({ task, sceneEpoch }: { task: FlowTask; sceneEpoch?: string }) {
  if (task.status !== 'complete') return null;
  let snapshot: CardSnapshot | null;
  try { snapshot = cardSnapshot(task.functionId, task.result); }
  catch { return null; }
  if (!snapshot) return null;
  // New data remounts the request view: old answers/errors cannot flash on the new card.
  return <ExplanationRequest key={cardDataKey(snapshot)} taskId={task.id} snapshot={snapshot} sceneEpoch={sceneEpoch}/>;
}

function ExplanationRequest({ taskId, snapshot, sceneEpoch }: { taskId: string; snapshot: CardSnapshot; sceneEpoch?: string }) {
  const shared = useContext(ExplanationContext), [local] = useState(newCache), cache = shared || local;
  const [text, setText] = useState(() => cache.peek(snapshot) || '');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const explain = async () => {
    setBusy(true); setError('');
    try {
      const result = await cache.get(snapshot, async card => {
        const response = await fetch('/api/bank/explain', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000),
          body: JSON.stringify({ taskId, key: cardDataKey(card), sceneEpoch }),
        });
        if (!response.ok) throw new Error('Explanation unavailable');
        const body = await response.json() as { text?: unknown };
        if (typeof body.text !== 'string' || !body.text.trim()) throw new Error('Invalid explanation');
        return body.text;
      });
      if (active.current) setText(result);
    } catch { if (active.current) setError('AI 讲解暂不可用，请直接查看卡片，或稍后重试。'); }
    finally { if (active.current) setBusy(false); }
  };
  const [open, setOpen] = useState(true);
  if (!text && !busy && !error) return <button type="button" className="ai-explain-trigger" onClick={() => void explain()}><Sparkles aria-hidden size={15}/>AI 讲解</button>;
  return <section aria-label="AI 讲解" aria-live="polite" className="ai-explain">
    <header><span className="ai-explain-title"><Sparkles aria-hidden size={14}/>AI 讲解</span>
      {text && <button type="button" className="ai-explain-icon" aria-label={open ? '收起' : '展开'} aria-expanded={open} onClick={() => setOpen(!open)}><ChevronUp aria-hidden size={16} style={{ transform: open ? 'none' : 'rotate(180deg)' }}/></button>}
      {error && !busy && <button type="button" className="ai-explain-icon" aria-label="重试" onClick={() => void explain()}><RotateCw aria-hidden size={15}/></button>}
    </header>
    {busy && <div className="ai-explain-skeleton" role="status" aria-label="正在讲解"><i/><i/><i/></div>}
    {text && open && <p>{text}</p>}
    {error && !busy && <p className="ai-explain-error" role="alert">{error}</p>}
  </section>;
}
