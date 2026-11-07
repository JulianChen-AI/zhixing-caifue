'use client';
import { useEffect, useRef, useState } from 'react';
import { CircleCheck, Lock, Map as MapIcon } from 'lucide-react';
import type { BankState } from '@/lib/bank/types';
import type { FlowTask } from '@/lib/workflows/types';
import { businessNow } from '@/lib/demo/clock';
import { localDate } from '@/lib/ui/business';
import { LevelScale } from './card-viz';
import { planStations, recentRecords, riskMatch, type Badge } from '@/lib/ui/desk';

/** The three-column desk appears from 1000px wide; narrower screens keep the serial layout. */
export const WIDE_QUERY = '(min-width: 1000px)';
export function useWideLayout() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(WIDE_QUERY), update = () => setWide(query.matches);
    update(); query.addEventListener('change', update); window.addEventListener('resize', update);
    return () => { query.removeEventListener('change', update); window.removeEventListener('resize', update); };
  }, []);
  return wide;
}

export function Chip({ badge }: { badge: Badge }) {
  return <span className={`desk-chip tone-${badge.tone}`}>{badge.label}</span>;
}

type Message = { id: string; speaker: 'user' | 'assistant'; text: string };
/** The running conversation; the waiting bubble appears as soon as a request leaves. */
export function ChatFeed({ messages, busy, slow, live }: { messages: Message[]; busy: boolean; slow: boolean; live: boolean }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [messages, busy]);
  return <div className="chat-feed" role="log" aria-label="对话">
    {!messages.length && !busy && <p className="chat-empty">可以直接打字或说话，例如“给张三转五百元”。<br/>需要你确认的事，会出现在中间的卡片里。</p>}
    {messages.map(item => <div className={`chat-bubble ${item.speaker === 'user' ? 'is-user' : 'is-assistant'}`} key={item.id}>
      {item.speaker === 'assistant' && <span className="chat-who">鹅豆</span>}
      <p>{item.text}</p>
    </div>)}
    {busy && <div className="chat-bubble is-assistant is-waiting" aria-label="正在处理"><span className="chat-who">鹅豆</span><p><span className="chat-dots"><i/><i/><i/></span>{slow ? '还在处理，请稍等' : '正在核对'}</p></div>}
    <div ref={end}/>
  </div>;
}

/** Read-only overview of a multi-business plan; the card below stays the only place to act. */
export function TaskMap({ bank }: { bank: BankState }) {
  const stations = planStations(bank);
  if (!stations.length) return null;
  const started = stations.some(item => !['muted'].includes(item.badge.tone));
  const badge: Badge = started ? { label: '每一步独立确认 · 独立回执', tone: 'info' } : { label: '尚未执行任何付款或申购', tone: 'wait' };
  return <section className="task-map" aria-label="任务地图">
    <div className="card-head"><MapIcon aria-hidden size={20}/><h2>{bank.plan?.monthly ? `${bank.plan.monthly.period} 本月安排` : '本次任务'} · 跑腿地图</h2><span className="card-head-end"><Chip badge={badge}/></span></div>
    <ol>{stations.map(item => <li key={item.id} className={`station tone-${item.badge.tone} ${item.current ? 'is-current' : ''}`} aria-current={item.current ? 'step' : undefined}>
      <span className="station-dot">{item.badge.tone === 'ok' ? <CircleCheck aria-label="已完成" size={15}/> : item.index}</span>
      <span className="station-body"><b>{item.title}</b><span>{item.badge.label}</span></span>
      {item.write && <span className="booth"><Lock aria-hidden size={11}/>确认岗亭</span>}
    </li>)}</ol>
    {bank.plan?.monthly && <MonthlyBasis bank={bank}/>}
  </section>;
}

const BASIS_TAG: Record<string, string> = { TR03: '模板 · 待确认', IN02: '模板 · 内部划款', IN08: '模板 · 投资申请' };
const basisMoney = (cents: number) => (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Where the month's money goes, from recorded income and the plan's own amounts; nothing here moves funds. */
function MonthlyBasis({ bank }: { bank: BankState }) {
  const plan = bank.plan!, period = plan.monthly!.period;
  const income = (bank.workflows?.records.transactions || []).filter(row => row.kind === 'income' && String(row.date || '').startsWith(period)).reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const live = plan.steps.filter(step => step.status !== 'cancelled' && typeof step.params.amount === 'number');
  const out = live.filter(step => BASIS_TAG[step.functionId || '']), budgets = live.filter(step => step.functionId === 'BI08');
  const left = income - out.reduce((sum, step) => sum + Math.round(Number(step.params.amount) * 100), 0);
  return <section className="monthly-basis" aria-label="资金依据">
    <div className="card-head"><h3>资金依据</h3><span className="card-head-end"><Chip badge={{ label: '每项都能修改或删除', tone: 'info' }}/></span></div>
    <dl>
      <div><dt>工资到账</dt><dd>{income ? basisMoney(income) : '未核实'}</dd><Chip badge={income ? { label: '已入账', tone: 'muted' } : { label: '未查到入账', tone: 'wait' }}/></div>
      {out.map(step => <div key={step.id}><dt>− {step.title}</dt><dd>{basisMoney(Math.round(Number(step.params.amount) * 100))}</dd><Chip badge={{ label: BASIS_TAG[step.functionId!], tone: 'muted' }}/></div>)}
      {income > 0 && <div className="is-total"><dt>= 余下</dt><dd>{basisMoney(left)}</dd><Chip badge={{ label: '确定性计算', tone: 'ok' }}/></div>}
      {budgets.map(step => <div key={step.id}><dt>新增 · {String(step.params.category || '预算')}</dt><dd>{basisMoney(Math.round(Number(step.params.amount) * 100))}</dd><Chip badge={{ label: '预算草稿 · 不付款 · 不冻结', tone: 'wait' }}/></div>)}
    </dl>
    <small>余下不等于“全部适合投资的钱”；先保障必要支出，再谈储蓄和理财。</small>
  </section>;
}

/** What the user submitted and what came back; internal audit entries stay out of view. */
export function RecordList({ bank, onOpen }: { bank: BankState; onOpen: () => void }) {
  const rows = recentRecords(bank);
  return <section className="record-list" aria-label="办理回执">
    <div className="record-head"><strong>办理回执</strong>{rows.length > 0 && <button className="text-button" onClick={onOpen}>全部记录</button>}</div>
    {rows.length ? <ul>{rows.map(row => <li key={row.id}>
      <div className="record-main"><b>{row.title}</b><Chip badge={row.badge}/></div>
      {row.detail && <span className="record-detail">{row.detail}</span>}
      {(row.at || row.reference) && <span className="record-meta">{row.at && localDate(row.at)}{row.at && row.reference && ' · '}{row.reference && <span title={row.reference}>编号 …{row.reference.slice(-8)}</span>}</span>}
    </li>)}</ul> : <p className="record-empty">办完的业务会在这里留下回执。受理、待结算和结果未知会分开标注。</p>}
  </section>;
}

/** Suitability facts shown before a purchase; the engine's check is still the only gate. */
export function InvestRisk({ bank, task }: { bank: BankState; task: Pick<FlowTask, 'functionId' | 'params'> }) {
  const match = riskMatch(bank, task, businessNow(bank));
  if (!match) return null;
  return <section className="invest-risk" aria-label="风险匹配">
    <div className="risk-pair">
      <div><small>你的风险测评</small><b>C{match.profileLevel}</b><span>{match.expired ? '已过期，需要重新测评' : `有效期至 ${localDate(match.validUntil).slice(0, 10)}`}</span></div>
      <div><small>{match.productName}</small><b>R{match.productRisk}</b></div>
      <div><small>机构规则匹配结果</small><Chip badge={match.within ? { label: '匹配', tone: 'ok' } : { label: match.expired ? '测评已过期' : '不匹配', tone: 'risk' }}/></div>
    </div>
    <LevelScale prefix="C" level={match.profileLevel} comparePrefix="R" compareLevel={match.productRisk} caption="产品风险不高于测评等级才可购买"/>
    {!match.within && <p className="risk-verdict is-outside">{match.expired ? '测评已过期，系统不会受理这笔申购。' : '产品风险高于你的测评，系统不会受理这笔申购。'}</p>}
    <details className="risk-learn"><summary>R 级和 C 级是什么意思？</summary><p>R1–R5 表示产品风险由低到高，C1–C5 表示你能承受的风险由低到高。只能买不高于自己测评等级的产品；测评有有效期，过期要重新做。等级不是收益承诺。</p></details>
  </section>;
}

/** Fees and possible loss, read and acknowledged on the card. The engine still decides the purchase. */
export function InvestDisclosure({ bank, task, acknowledged, onAcknowledge }: { bank: BankState; task: FlowTask; acknowledged: boolean; onAcknowledge: (value: boolean) => void }) {
  const match = riskMatch(bank, task, businessNow(bank));
  if (!match) return null;
  return <section className="invest-disclosure" aria-label="费用与风险">
    <div className="fee-chips">{match.fees.length ? match.fees.map(fee => <span key={fee.name}>{fee.name} {fee.rate}%</span>) : <span>{match.feeRate != null ? `交易费率 ${match.feeRate}%` : '费率未提供'}</span>}</div>
    <ul className="risk-box">
      <li><b>可能亏损</b>：理财非存款，产品有风险，投资须谨慎。净值可能下跌，不保证本金。</li>
      {match.liquidity && <li><b>流动性</b>：{match.liquidity}</li>}
      <li>提交后先是“已受理”，份额确认前不算持有。</li>
    </ul>
    <label className={`risk-ack ${acknowledged ? 'is-on' : ''}`}><input type="checkbox" checked={acknowledged} onChange={event => onAcknowledge(event.target.checked)}/>我已了解费用、可能亏损和非实时到账，自行决定是否继续</label>
  </section>;
}
