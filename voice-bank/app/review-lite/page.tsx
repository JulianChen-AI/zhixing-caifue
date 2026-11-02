'use client';

import { useRef, useState, type CSSProperties } from 'react';
import { WorkflowPanel } from '@/components/workflow-panel';
import { initialState, reduceBank } from '@/lib/bank/engine';
import type { BankAction, BankState } from '@/lib/bank/types';
import { runQuickReview, type QuickCheck } from '@/lib/workflows/quick-review';

function interactiveFixture(check?: QuickCheck): BankState {
  let bank = check?.bank ? structuredClone(check.bank) : initialState();
  bank.view = 'workflow';
  return bank;
}

function runAaAction(state: BankState, action: 'create' | 'list'): BankState {
  return reduceBank(state, {
    type: 'workflow',
    command: {
      operation: 'run', functionId: 'TR05', source: 'card',
      params: action === 'create'
        ? { action, total: 100, participants: ['甲', '乙', '丙'] }
        : { action },
    },
  }, crypto.randomUUID());
}

const panel: CSSProperties = {
  width: 'min(1120px, 100%)', margin: '0 auto', padding: '32px 20px 64px', color: '#243248',
};
const button: CSSProperties = {
  border: 0, borderRadius: 12, padding: '11px 16px', background: '#167df3', color: '#fff', cursor: 'pointer', fontWeight: 600,
};
const secondary: CSSProperties = {
  ...button, background: '#eef3f8', color: '#40536d', border: '1px solid #dfe7f0',
};

export default function LiteReviewPage() {
  const [results, setResults] = useState<QuickCheck[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [bank, setBank] = useState<BankState>(() => initialState());
  const bankRef = useRef(bank);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const selected = results?.find((item) => item.id === selectedId) ?? null;
  const passed = results?.filter((item) => item.pass).length ?? 0;

  function installFixture(check?: QuickCheck) {
    const next = interactiveFixture(check);
    bankRef.current = next;
    setBank(next);
    setNotice('已载入本页隔离的演示数据；不会联系银行或语音服务。');
  }

  function runAll() {
    const next = runQuickReview();
    setResults(next);
    setSelectedId(1);
    installFixture(next[0]);
  }

  function select(check: QuickCheck) {
    setSelectedId(check.id);
    installFixture(check);
  }

  function rerunSelected() {
    if (!selected) return;
    const fresh = runQuickReview(selected.id)[0];
    if (!fresh) return;
    setResults((current) => current?.map((item) => item.id === fresh.id ? fresh : item) ?? [fresh]);
    installFixture(fresh);
  }

  function startNormalAa() {
    const next = runAaAction(initialState(), 'create');
    bankRef.current = next;
    setBank(next);
    setNotice('已切换到正常 AA 体验。上方仍保留超限检查证据；点击“恢复本项演示数据”可返回。下方新建的 ¥100、3 人均分 AA 草稿等待你核对并明确确认，不会自动提交。');
  }

  function listExistingAa() {
    const next = runAaAction(bankRef.current, 'list');
    bankRef.current = next;
    setBank(next);
    setNotice('已查询本页演示数据中的 AA 单；上方检查证据仍保留。不会联系银行，也不提供未接入的复杂改算或提醒发送。');
  }

  async function applyLocalAction(action: BankAction) {
    setBusy(true);
    setNotice('');
    try {
      const next = reduceBank(bankRef.current, action, crypto.randomUUID());
      bankRef.current = next;
      setBank(next);
      setNotice('已更新本页演示状态；未联系后台或真实银行。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '本地操作未成功。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={panel}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
        <div>
          <p style={{ margin: '0 0 6px', color: '#75859a', fontSize: 12 }}>本页演示 · 不连接真实机构</p>
          <h1 style={{ margin: 0, fontSize: 'clamp(24px, 4vw, 34px)', letterSpacing: '-.03em' }}>1–20 项快速审核</h1>
        </div>
        <button style={button} onClick={runAll}>运行 20 项快速审核</button>
      </header>

      <p style={{ maxWidth: 820, color: '#5b6c82', lineHeight: 1.7 }}>
        运行后逐项查看预期与实测证据。选择条目会载入隔离的演示数据；下方办理卡片只更新本页状态，不会联系后台、语音服务或银行。全部通过不代表真人语音、真实机构能力或生产验收通过。
      </p>

      {results && <section aria-live="polite" style={{ margin: '20px 0', padding: 16, border: '1px solid #dfe7f0', borderRadius: 16, background: '#fff' }}>
        <strong>快速审核结果：{passed}/20 通过</strong>
        <span style={{ marginLeft: 10, color: '#75859a', fontSize: 13 }}>本页演示数据；不代表外部能力已验证</span>
      </section>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))', gap: 20, alignItems: 'start' }}>
        <section aria-label="快速审核项目" style={{ border: '1px solid #dfe7f0', borderRadius: 18, background: '#fff', overflow: 'hidden' }}>
          <h2 style={{ margin: 0, padding: '16px 18px', fontSize: 17, borderBottom: '1px solid #edf1f5' }}>20 项检查</h2>
          {!results && <p style={{ padding: '0 18px 18px', color: '#718198', lineHeight: 1.6 }}>点击“运行 20 项快速审核”开始。审核结果按条目列出，尚未运行时不预设通过。</p>}
          {results?.map((item) => <button key={item.id} onClick={() => select(item)} aria-pressed={selectedId === item.id} style={{ display: 'grid', gridTemplateColumns: '32px 1fr auto', gap: 10, alignItems: 'start', textAlign: 'left', width: '100%', padding: '13px 16px', border: 0, borderBottom: '1px solid #edf1f5', background: selectedId === item.id ? '#f1f7ff' : '#fff', cursor: 'pointer', color: '#26364d' }}>
            <span style={{ color: item.pass ? '#23855d' : '#bd3f3f', fontVariantNumeric: 'tabular-nums' }}>{String(item.id).padStart(2, '0')}</span>
            <span style={{ lineHeight: 1.45 }}>{item.title}</span>
            <strong style={{ color: item.pass ? '#23855d' : '#bd3f3f', fontSize: 12 }}>{item.pass ? '通过' : '失败'}</strong>
          </button>)}
        </section>

        <section aria-label="所选检查和业务卡片" style={{ minWidth: 0 }}>
          {selected ? <article style={{ padding: 18, border: '1px solid #dfe7f0', borderRadius: 18, background: '#fff', marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start' }}>
              <div><p style={{ margin: '0 0 4px', color: '#77879b', fontSize: 12 }}>检查 {String(selected.id).padStart(2, '0')}</p><h2 style={{ margin: 0, fontSize: 19 }}>{selected.title}</h2></div>
              <strong style={{ color: selected.pass ? '#23855d' : '#bd3f3f', whiteSpace: 'nowrap' }}>{selected.pass ? '通过' : '失败'}</strong>
            </div>
            <p style={{ margin: '14px 0 5px', fontSize: 13, fontWeight: 650 }}>预期</p>
            <p style={{ margin: 0, color: '#53657c', lineHeight: 1.6 }}>{selected.expected}</p>
            <p style={{ margin: '14px 0 5px', fontSize: 13, fontWeight: 650 }}>实测证据</p>
            <p style={{ margin: 0, color: '#53657c', lineHeight: 1.6, overflowWrap: 'anywhere' }}>{selected.id === 20 ? '已记录分类、月报/年报两处前后矛盾；未裁定真实能力。来源行号与原文哈希见下方折叠内容。' : selected.evidence}</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
              <button style={secondary} onClick={() => installFixture(selected)}>恢复本项演示数据</button>
              <button style={secondary} onClick={rerunSelected}>重跑本项</button>
            </div>
            {[3, 4].includes(selected.id) && <aside style={{ marginTop: 16, padding: 14, borderRadius: 12, background: '#fff8e7', color: '#72521b', lineHeight: 1.6 }}>
              这里特意展示超限被拦截，表示保护规则生效；不是说正常 AA 不能发起。
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                <button style={secondary} onClick={startNormalAa}>重新体验正常AA</button>
                <button style={secondary} onClick={listExistingAa}>查看已有 AA 单</button>
              </div>
              <p style={{ margin: '8px 0 0', fontSize: 12 }}>正常示例为 ¥100、3 人均分；创建后会停在确认卡片，须由你明确确认。提醒发送和复杂改算未接入。</p>
            </aside>}
          </article> : <article style={{ padding: 18, border: '1px solid #dfe7f0', borderRadius: 18, background: '#fff', marginBottom: 16, color: '#718198' }}>{results ? '当前没有选择审核项；下方显示本页演示办理，不影响原审核结果。' : '先运行审核，再选择一项查看预期、实测证据和对应办理卡片。'}</article>}

          {selected?.id === 20 ? <aside style={{ padding: 16, border: '1px solid #dfe7f0', borderRadius: 18, background: '#f8fafc', lineHeight: 1.7 }}>
            <h2 style={{ margin: '0 0 8px', fontSize: 17 }}>竞品资料校正说明</h2>
            <p style={{ margin: '0 0 10px' }}>这项只记录竞品资料两处前后矛盾，不是新增银行功能；保留原文，不改源文，也未核实真实银行功能。</p>
            <ul style={{ margin: 0, paddingLeft: 22 }}>
              <li>分类：正文 §3.1 称微众无分类、中行有分析；总表第 450 行表述相反。</li>
              <li>月报/年报：正文 §3.3 称微众无月报/年报、中行有；总表第 452 行表述相反。</li>
            </ul>
            <details style={{ marginTop: 10 }}>
              <summary>来源行号与原文哈希</summary>
              <p style={{ marginBottom: 4 }}>分类：正文第 236–243 行、总表第 450 行；月报/年报：正文第 254–260 行、总表第 452 行。</p>
              <p style={{ marginTop: 4, overflowWrap: 'anywhere' }}>原文 SHA-256：563620d7e1c710ee845c6dcb41b7d021eb47c1c6a821b0a5f5dae56ae250a0fd</p>
            </details>
          </aside> : <div style={{ padding: 16, border: '1px solid #dfe7f0', borderRadius: 18, background: '#f8fafc' }}>
            <h2 style={{ margin: '0 0 5px', fontSize: 17 }}>本页办理卡片</h2>
            <p style={{ margin: '0 0 14px', color: '#718198', fontSize: 12, lineHeight: 1.6 }}>可在卡片里修改、核对或确认演示信息；所有状态只保存在本页，不会联系真实银行。</p>
            {notice && <p role="status" style={{ margin: '0 0 12px', color: '#64758a', fontSize: 12 }}>{notice}</p>}
            <WorkflowPanel bank={bank} busy={busy} onAction={applyLocalAction} />
          </div>}
        </section>
      </div>
      <p style={{ marginTop: 22, color: '#8794a5', fontSize: 12, lineHeight: 1.6 }}>
        说明：固定验证码仅供本页演示，不是真实认证凭据。本页结果不替代浏览器端语音测试、真实手机麦克风验收或任何银行实际服务验证。
      </p>
    </main>
  );
}
