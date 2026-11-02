'use client';
// Visual-acceptance gallery: renders every business card with the production
// components against local fixtures. It never contacts the bank API or voice services.
import { useEffect, useMemo, useState } from 'react';
import { WorkflowPanel } from '@/components/workflow-panel';
import { TaskHistory, ConversationHistory } from '@/components/serial-stage';
import { initialState, reduceBank } from '@/lib/bank/engine';
import type { BankAction, BankState } from '@/lib/bank/types';
import { USER_FUNCTIONS, UNSUPPORTED_FUNCTIONS } from '@/lib/workflows/catalog';
import { choices, requiredFields } from '@/lib/workflows/fields';
import { currentWorkflow } from '@/lib/workflows/engine';
import type { Params } from '@/lib/workflows/types';

type Shot = { key: string; label: string; bank: BankState };

const AMOUNT_KEYS = /amount|total|limit|threshold|target/i;
const noop = async () => {};
const wf = (bank: BankState, command: Record<string, unknown>) =>
  reduceBank(bank, { type: 'workflow', command: { source: 'card', ...command } } as BankAction, crypto.randomUUID());

/** Walk one function through collecting → review → authenticate → complete, keeping each stage. */
function stages(functionId: string, title: string): Shot[] {
  const shots: Shot[] = [];
  const add = (label: string, bank: BankState) => shots.push({ key: `${functionId}-${label}`, label: `${functionId} ${title} · ${label}`, bank });
  try {
    let bank = wf(initialState(), { operation: 'run', functionId, params: {} });
    let task = currentWorkflow(bank);
    if (!task) return shots;
    add(task.status, bank);
    // Fill missing required fields from the first available choice so write flows reach review.
    for (let i = 0; i < 4 && task && task.status === 'collecting'; i++) {
      const params: Params = { ...task.params };
      for (const key of requiredFields(functionId, params)) {
        if (params[key] != null && params[key] !== '') continue;
        const first = choices(bank, key)[0]?.value;
        if (first != null) params[key] = first;
        else if (AMOUNT_KEYS.test(key)) params[key] = 100;
        else if (key === 'participants') params[key] = ['甲', '乙', '丙'];
        else if (key === 'period') params[key] = '2026-10';
        else if (key === 'note') params[key] = '示例';
      }
      bank = wf(bank, { operation: 'amend', taskId: task.id, params });
      task = currentWorkflow(bank);
    }
    if (task && task.status !== 'collecting' && shots[shots.length - 1].key !== `${functionId}-${task.status}`) add(task.status, bank);
    if (task?.status === 'review' && task.reviewToken) {
      bank = wf(bank, { operation: 'confirm', taskId: task.id, token: task.reviewToken });
      task = currentWorkflow(bank);
      if (task) add(task.status, bank);
      if (task?.status === 'authenticate' && task.verificationId) {
        bank = wf(bank, { operation: 'authenticate', taskId: task.id, token: task.verificationId, code: '123456' });
        task = currentWorkflow(bank);
        if (task) add(task.status, bank);
      }
    }
  } catch (error) {
    add('生成失败', initialState());
    shots[shots.length - 1].label += `：${error instanceof Error ? error.message : String(error)}`;
  }
  return shots;
}

export default function CardsGallery() {
  const offered = useMemo(() => USER_FUNCTIONS.filter(item => !UNSUPPORTED_FUNCTIONS.has(item.id)), []);
  const unsupported = useMemo(() => USER_FUNCTIONS.filter(item => UNSUPPORTED_FUNCTIONS.has(item.id)), []);
  const modules = useMemo(() => [...new Map(USER_FUNCTIONS.map(item => [item.moduleId, item.moduleName])).entries()], []);
  const [module, setModule] = useState('all');
  // Fixtures embed random ids and timestamps, so they are built after mount to keep SSR and hydration identical.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const sections = useMemo(() => mounted ? [...offered, ...unsupported].map(item => ({ item, shots: stages(item.id, item.title) })) : [], [mounted, offered, unsupported]);
  const shown = sections.filter(({ item }) => module === 'all' || item.moduleId === module);
  const total = shown.reduce((n, s) => n + s.shots.length, 0);
  const history = useMemo(() => {
    let bank = initialState();
    for (const item of offered.slice(0, 3)) bank = wf(bank, { operation: 'run', functionId: item.id, params: {} });
    return bank;
  }, [offered]);
  const catalog = useMemo(() => initialState(), []);

  const cell = { minWidth: 0 } as const;
  const caption = { margin: '0 0 8px', fontSize: 12, color: '#64748b', overflowWrap: 'anywhere' } as const;
  const wrap = (children: React.ReactNode) => <div className="app serial-app has-card" style={{ minHeight: 0, height: 'auto', padding: 0, background: 'none', alignItems: 'stretch' }}><div className="card-stage" style={{ padding: 0 }}>{children}</div></div>;

  return <main style={{ maxWidth: 1400, margin: '0 auto', padding: '24px 20px 80px', background: '#fafbfc', minHeight: '100dvh' }}>
    <h1 style={{ margin: '0 0 6px', fontSize: 26 }}>卡片视觉验收</h1>
    <p style={{ margin: '0 0 16px', color: '#64748b', fontSize: 13, lineHeight: 1.6 }}>使用正式组件和本页隔离的演示数据逐个渲染业务卡片，不联系银行或语音服务。每项依次展示补充信息、待确认、验证身份、办理结果（能走到哪一步取决于该业务）。当前显示 {total} 张。</p>
    <nav aria-label="业务类别" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
      {[['all', '全部'], ...modules].map(([id, name]) => <button key={id} aria-pressed={module === id} onClick={() => setModule(id)} style={{ padding: '6px 12px', borderRadius: 999, border: '1px solid #dfe7f0', background: module === id ? '#167df3' : '#fff', color: module === id ? '#fff' : '#40536d', cursor: 'pointer' }}>{name}</button>)}
    </nav>

    {mounted && module === 'all' && <section style={{ marginBottom: 40 }}>
      <h2 style={{ fontSize: 18 }}>通用卡片</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(340px,1fr))', gap: 24, alignItems: 'start' }}>
        <div style={cell}><p style={caption}>选择业务</p>{wrap(<WorkflowPanel bank={catalog} busy={false} onAction={noop} serial catalog />)}</div>
        <div style={cell}><p style={caption}>办理进度</p>{wrap(<TaskHistory bank={history} busy={false} onAction={noop} onClose={() => {}} />)}</div>
        <div style={cell}><p style={caption}>对话记录</p>{wrap(<ConversationHistory messages={[{ id: '1', speaker: 'user', text: '给张三转五百元' }, { id: '2', speaker: 'assistant', text: '好的，请核对转账信息。' }]} onClose={() => {}} />)}</div>
        <div style={cell}><p style={caption}>设置</p>{wrap(<section className="business-card serial-card settings-card" aria-label="设置"><div className="card-top"><span>设置</span><button className="text-button">返回</button></div><h2>设置</h2><div className="settings-list">{['开始语音对话', '使用文字对话', '关闭文字播报', '对话记录', '办理记录', '重置演示数据'].map(t => <button className="secondary-button" key={t}>{t}</button>)}</div></section>)}</div>
        <div style={cell}><p style={caption}>重置确认</p>{wrap(<section className="business-card serial-card" aria-label="重置演示"><h2>重新开始演示？</h2><p className="card-description">清除当前演示交易，并恢复初始余额。</p><button className="primary-button">重置演示</button><button className="text-button">返回</button></section>)}</div>
        <div style={cell}><p style={caption}>办理已暂停</p>{wrap(<section className="business-card serial-card" aria-label="当前步骤"><h2>办理已暂停</h2><p className="card-description">已填写的信息会保留。</p><button className="primary-button">继续办理</button><button className="text-button">取消剩余任务</button></section>)}</div>
      </div>
    </section>}

    {shown.map(({ item, shots }) => <section key={item.id} id={item.id} style={{ marginBottom: 36 }}>
      <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>{item.id} {item.title}{UNSUPPORTED_FUNCTIONS.has(item.id) && '（暂不可用）'}</h2>
      <p style={{ margin: '0 0 12px', color: '#64748b', fontSize: 12 }}>{item.moduleName}</p>
      {shots.length ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(340px,1fr))', gap: 24, alignItems: 'start' }}>
        {shots.map(shot => <div key={shot.key} style={cell}><p style={caption}>{shot.label}</p>{wrap(<WorkflowPanel bank={shot.bank} busy={false} onAction={noop} serial />)}</div>)}
      </div> : <p style={{ color: '#b45309', fontSize: 13 }}>该业务没有生成卡片（引擎直接拒绝或不支持）。</p>}
    </section>)}
  </main>;
}
