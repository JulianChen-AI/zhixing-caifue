'use client';
// 模拟 IM（本地演示）：messages go to /api/im/simulate, which signs them on the server and runs the same IM handler as the
// webhook. It is not WeChat or WeCom. Authentication never happens here; the reply links to the App card.
import { useState } from 'react';

type Line = { from: 'me' | 'bank'; text: string; link?: string };

export default function ImPage() {
 const [lines, setLines] = useState<Line[]>([{ from: 'bank', text: '这是模拟 IM，不是真实微信或企业微信。可以查询、起草业务；需要认证的一步只能回 App 卡片完成。' }]);
 const [text, setText] = useState('');
 const [busy, setBusy] = useState(false);
 async function send(e: React.FormEvent) {
  e.preventDefault();
  const said = text.trim();
  if (!said || busy) return;
  setLines(l => [...l, { from: 'me', text: said }]); setText(''); setBusy(true);
  try {
   const res = await fetch('/api/im/simulate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: said, messageId: crypto.randomUUID() }) });
   const data = await res.json() as { reply?: string; error?: string; appUrl?: string };
   setLines(l => [...l, { from: 'bank', text: data.reply || data.error || '没有收到回复。', link: data.appUrl }]);
  } catch { setLines(l => [...l, { from: 'bank', text: '发送失败，状态未改变。' }]); }
  finally { setBusy(false); }
 }
 return <main style={{ maxWidth: 560, margin: '0 auto', padding: '16px', fontFamily: 'system-ui, sans-serif', minHeight: '100vh', background: '#f4f5f7', color: '#1d2129' }}>
  <header style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
   <b style={{ fontSize: 18 }}>知行银行 · 财富鹅</b>
   <span data-testid="im-badge" style={{ fontSize: 12, padding: '2px 8px', borderRadius: 10, background: '#fff3cd', color: '#7a5a00' }}>模拟 IM · 本地演示</span>
  </header>
  <ol aria-label="对话" style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 8 }}>
   {lines.map((line, i) => <li key={i} data-from={line.from} style={{ justifySelf: line.from === 'me' ? 'end' : 'start', maxWidth: '85%', padding: '8px 12px', borderRadius: 12, background: line.from === 'me' ? '#95ec69' : '#fff', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
    {line.text}{line.link ? <> <a href={line.link}>打开 App</a></> : null}
   </li>)}
  </ol>
  <form onSubmit={send} style={{ display: 'flex', gap: 8, marginTop: 12 }}>
   <input aria-label="消息" value={text} onChange={e => setText(e.target.value)} placeholder="例如：查一下余额" style={{ flex: 1, minWidth: 0, padding: '10px 12px', borderRadius: 8, border: '1px solid #c9cdd4' }}/>
   <button type="submit" disabled={busy} style={{ padding: '10px 16px', borderRadius: 8, border: 0, background: '#07c160', color: '#fff' }}>{busy ? '发送中' : '发送'}</button>
  </form>
 </main>;
}
