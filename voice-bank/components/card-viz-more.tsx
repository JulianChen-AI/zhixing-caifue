'use client';
// Visuals for portfolio review, product detail and comparison, invitations, merchant guidance, reminders and
// transfer risk. Pure rendering of facts the engine already computed; nothing here decides or executes anything.
import { Fragment, useContext, type ReactNode } from 'react';
import { BookOpen, ExternalLink, Gift, MessageCircle, NotebookPen, PieChart, ShieldAlert, Store, TrendingDown, TrendingUp } from 'lucide-react';
import type { BankState } from '@/lib/bank/types';
import type { FlowTask } from '@/lib/workflows/types';
import { businessDay } from '@/lib/demo/clock';
import { inviteText } from '@/lib/workflows/invite';
import { transferRisk } from '@/lib/workflows/risk';
import { upperAmount } from '@/lib/bank/amount-words';
import { localDate } from '@/lib/ui/business';
import { Chip } from './desk';
import { EmptyViz, FollowUp, Kpis, LevelScale, ProcessSteps, yuan } from './card-viz';

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown) => Array.isArray(value) ? value.map(record) : [];
const num = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0;
const text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const DAY = 86400000;
const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);
const md = (iso: string) => `${Number(iso.slice(5, 7))}月${Number(iso.slice(8, 10))}日`;
const weekday = (iso: string) => '日一二三四五六'[new Date(iso + 'T12:00:00Z').getUTCDay()];

/* ---------- Primitives ---------- */

type Part = { label: string; value: number };
/** Part-to-whole as a ring with a legend; shares are the values themselves (percent). */
export function Donut({ rows, label, center, caption }: { rows: Part[]; label: string; center?: string; caption?: string }) {
  const total = rows.reduce((sum, row) => sum + Math.max(row.value, 0), 0);
  if (!total) return null;
  const r = 38, length = 2 * Math.PI * r;
  let offset = 0;
  return <figure className="vx-donut" aria-label={`${label}：${rows.map(row => `${row.label}${Math.round(row.value / total * 100)}%`).join('，')}`}>
    <div className="vx-donut-ring">
      <svg viewBox="0 0 100 100" aria-hidden>
        <circle cx="50" cy="50" r={r} className="vx-donut-track"/>
        {rows.map((row, index) => { const part = Math.max(row.value, 0) / total * length, gap = rows.length > 1 ? 1.6 : 0;
          const arc = <circle key={row.label} cx="50" cy="50" r={r} fill="none" stroke={`var(--series-${index % 8 + 1})`} strokeWidth="13" strokeDasharray={`${Math.max(part - gap, .5)} ${length}`} strokeDashoffset={-offset} transform="rotate(-90 50 50)"/>;
          offset += part; return arc; })}
      </svg>
      {center && <div><b>{center}</b>{caption && <small>{caption}</small>}</div>}
    </div>
    <ul className="vx-legend">{rows.map((row, index) => <li key={row.label}><i style={{ background: `var(--series-${index % 8 + 1})` }}/><span>{row.label}</span><b>{Math.round(row.value / total * 100)}%</b></li>)}</ul>
  </figure>;
}

type Point = { date: string; label: string; value?: number; tone?: 'buy' | 'today' | 'event' | 'remind' };
/** Dated events on one axis from the first to the last; dot area follows the amount. */
export function Timeline({ points, label }: { points: Point[]; label: string }) {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 2) return null;
  const start = Date.parse(sorted[0].date), span = Math.max(Date.parse(sorted.at(-1)!.date) - start, DAY);
  const largest = Math.max(1, ...sorted.map(point => point.value || 0));
  return <figure className="vx-timeline" aria-label={`${label}：${sorted.map(point => `${point.date} ${point.label}${point.value ? ' ' + yuan(point.value) : ''}`).join('；')}`}>
    <figcaption>{label}</figcaption>
    <div className="vx-timeline-track">
      {sorted.map((point, index) => { const at = (p: Point) => (Date.parse(p.date) - start) / span * 100, left = at(point), size = point.value ? 10 + 14 * Math.sqrt(point.value / largest) : 12;
        // A label that would run into its right-hand neighbour's goes above the line instead.
        const above = index < sorted.length - 1 && at(sorted[index + 1]) - left < 22 && !(index > 0 && left - at(sorted[index - 1]) < 22 && (index - 1) % 2 === 0);
        return <span key={point.date + index} className={`vx-tl-point is-${point.tone || 'event'} ${left > 70 ? 'is-end' : left < 15 ? 'is-start' : ''} ${above ? 'is-above' : ''}`} style={{ left: `${left}%` }} data-tip={`${point.date} ${point.label}${point.value ? ' ' + yuan(point.value) : ''}`}>
          <i style={{ width: size, height: size }}/>
          <small><b>{point.label}{point.value ? ` ${yuan(point.value)}` : ''}</b>{md(point.date)}</small>
        </span>; })}
    </div>
  </figure>;
}

/** Cost against value on the same scale, with the difference spelled out. */
function CostValue({ cost, value }: { cost: number; value: number }) {
  const top = Math.max(cost, value, 1), diff = value - cost;
  const bar = (label: string, amount: number, cls: string) => <div className="vx-cv-row"><span>{label}</span><span className="vx-cv-track"><i className={cls} style={{ width: `${Math.max(amount / top * 100, 1.5)}%` }}/></span><b>{yuan(amount)}</b></div>;
  return <div className="vx-cv" role="img" aria-label={`成本 ${yuan(cost)}，市值 ${yuan(value)}，${diff > 0 ? '浮盈' : diff < 0 ? '浮亏' : '持平'} ${yuan(Math.abs(diff))}`}>
    {bar('投入成本', cost, 'is-cost')}{bar('当前市值', value, diff < 0 ? 'is-down' : 'is-value')}
  </div>;
}
function GainChip({ profit, rate }: { profit: number; rate: number | null }) {
  const tone = profit > 0 ? 'up' : profit < 0 ? 'down' : 'flat';
  return <span className={`vx-gain is-${tone}`}>{profit > 0 ? <TrendingUp aria-hidden size={14}/> : profit < 0 ? <TrendingDown aria-hidden size={14}/> : null}{profit === 0 ? '不赚不亏' : `${profit > 0 ? '+' : '-'}${yuan(Math.abs(profit))}`}{rate != null && profit !== 0 ? ` · ${(rate * 100).toFixed(2)}%` : ''}</span>;
}
function Badges({ items }: { items: { label: string; tone: 'ok' | 'info' | 'wait' | 'risk' | 'muted' | 'pending' }[] }) {
  return <div className="vx-badges">{items.map(item => <Chip key={item.label} badge={item}/>)}</div>;
}

/* ---------- Portfolio review (IN16) ---------- */

export function PortfolioReviewCard({ value, bank }: { value: unknown; bank?: BankState }) {
  const row = record(value), items = list(row.holdings), questions = Array.isArray(row.questions) ? row.questions.map(text) : [];
  const follow = useContext(FollowUp), today = text(row.asOf) || (bank ? businessDay(bank) : '');
  if (!items.length) return <EmptyViz title="没有可复盘的持仓"/>;
  const notes = list(row.notes);
  return <div className="viz-group">
    {items.map(item => {
      const buys = list(item.buys), profit = num(item.profit), rate = typeof item.profitRate === 'number' ? item.profitRate : null;
      return <section className="vx-panel" key={text(item.holdingId)}>
        <header className="vx-panel-head"><b>{text(item.name)}</b>{typeof item.risk === 'number' && <Chip badge={{ label: `R${item.risk}`, tone: 'info' }}/>}<GainChip profit={profit} rate={rate}/></header>
        <CostValue cost={num(item.cost)} value={num(item.value)}/>
        <Kpis items={[{ label: '持有', value: item.holdingDays != null ? `${num(item.holdingDays)} 天` : '—' }, { label: '买入', value: `${buys.length} 次` }, { label: '平均每次', value: buys.length ? yuan(Math.round(buys.reduce((sum, buy) => sum + num(buy.amount), 0) / buys.length)) : '—' }]}/>
        <Timeline label="买入记录" points={[...buys.map(buy => ({ date: text(buy.date), label: '买入', value: num(buy.amount), tone: 'buy' as const })), ...(today ? [{ date: today, label: '今天', tone: 'today' as const }] : [])]}/>
      </section>;
    })}
    {list(row.pending).length > 0 && <p className="note-line">另有 {list(row.pending).length} 笔申购等待份额确认。</p>}
    {questions.length > 0 && <section className="vx-questions" aria-label="复盘问题">
      <header><BookOpen aria-hidden size={18}/><b>想一想</b></header>
      <ol>{questions.map(question => <li key={question}>{question}</li>)}</ol>
      {follow && <button className="pill-button" onClick={() => follow('IN16', { action: 'note' })}><NotebookPen aria-hidden size={14}/> 把想法记成复盘笔记</button>}
    </section>}
    {notes.length > 0 && <section className="vx-notes" aria-label="我的复盘笔记"><b>我的复盘笔记</b>{notes.map((note, index) => <blockquote key={index}>{text(note.note)}<small>{text(note.createdAt).slice(0, 10)}</small></blockquote>)}</section>}
  </div>;
}

/* ---------- Products (IN06, IN07) ---------- */

const assets = (product: Record<string, unknown>): Part[] => list(product.underlying).map(item => ({ label: text(item.asset), value: num(item.share) }));
const liquidityText = (value: unknown) => /T\+1/.test(text(value)) ? '赎回约 T+1 工作日到账' : text(value) || '未提供';
const feeText = (product: Record<string, unknown>) => list(product.fees).map(fee => `${text(fee.name)} ${typeof fee.rate === 'number' ? `${fee.rate}%` : '未提供'}`);

export function ProductDetailCard({ product }: { product: Record<string, unknown> }) {
  const parts = assets(product);
  return <section className="vx-panel">
    <header className="vx-panel-head"><b>{text(product.name)}</b>{product.type != null && <Chip badge={{ label: text(product.type), tone: 'muted' }}/>}</header>
    {typeof product.risk === 'number' && <LevelScale prefix="R" level={product.risk} caption="产品风险等级（1 最低，5 最高）"/>}
    {parts.length ? <Donut label="底层资产构成" rows={parts} center={`${parts.length} 类`} caption="底层资产"/> : <p className="note-line">底层资产构成未提供。</p>}
    <dl className="vx-facts">
      <div><dt>流动性</dt><dd>{liquidityText(product.liquidity)}</dd></div>
      <div><dt>费用</dt><dd>{feeText(product).join(' · ') || '未提供'}</dd></div>
    </dl>
  </section>;
}

export function ProductsCard({ value }: { value: unknown }) {
  const products = (Array.isArray(value) ? value : [value]).map(record).filter(product => product.name != null);
  if (!products.length) return <EmptyViz title="没有符合条件的产品"/>;
  if (products.length === 1) return <ProductDetailCard product={products[0]}/>;
  return <div className="vx-product-grid">{products.map(product => <section className="vx-panel is-compact" key={text(product.id)}>
    <header className="vx-panel-head"><b>{text(product.name)}</b>{typeof product.risk === 'number' && <Chip badge={{ label: `R${product.risk}`, tone: 'info' }}/>}</header>
    <MiniStack parts={assets(product)}/>
    <small className="vx-sub">{liquidityText(product.liquidity)}</small>
  </section>)}</div>;
}

function MiniStack({ parts }: { parts: Part[] }) {
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  if (!total) return <small className="vx-sub">底层资产未提供</small>;
  return <div className="vx-mini">
    <div className="vx-mini-bar" aria-hidden>{parts.map((part, index) => <span key={part.label} style={{ flexGrow: part.value, background: `var(--series-${index % 8 + 1})` }} data-tip={`${part.label} ${part.value}%`}/>)}</div>
    <ul className="vx-legend is-small">{parts.map((part, index) => <li key={part.label}><i style={{ background: `var(--series-${index % 8 + 1})` }}/><span>{part.label}</span><b>{Math.round(part.value / total * 100)}%</b></li>)}</ul>
  </div>;
}

export function CompareCard({ value }: { value: unknown }) {
  const row = record(value), products = list(row.products), differences = list(row.differences).map(item => text(item.label));
  if (products.length < 2) return null;
  const line = (label: string, cell: (product: Record<string, unknown>) => ReactNode, differs?: boolean) => <Fragment key={label}>
    <dt className={differs ? 'is-diff' : ''}>{label}{differs && <i>不同</i>}</dt>
    {products.map(product => <dd key={text(product.id)}>{cell(product)}</dd>)}
  </Fragment>;
  const differs = (label: string) => differences.some(item => item.startsWith(label));
  return <div className="viz-group">
    {differences.length > 0 && <p className="vx-diff-line">主要不同：{differences.map(item => item.replace(/（.*?）/, '')).join('、')}</p>}
    <dl className="vx-compare" style={{ ['--cols' as string]: products.length }}>
      <dt/>{products.map(product => <dd key={text(product.id)} className="vx-compare-name"><b>{text(product.name)}</b><small>{text(product.type)}</small></dd>)}
      {line('风险等级', product => typeof product.risk === 'number' ? <LevelScale prefix="R" level={product.risk}/> : '未提供', differs('风险'))}
      {line('底层资产', product => <MiniStack parts={assets(product)}/>, differs('底层'))}
      {line('流动性', product => liquidityText(product.liquidity), differs('流动'))}
      {line('交易费率', product => typeof product.feeRate === 'number' && product.synthetic === true ? `${product.feeRate}%` : '未提供', differs('当前合成交易费率'))}
    </dl>
  </div>;
}

/* ---------- Invitation (TR10) ---------- */

export function InviteCard({ invitee, message, sent, createdAt }: { invitee: string; message: string; sent: boolean; createdAt?: string }) {
  return <div className="viz-group">
    <div className="vx-chat" aria-label={`发给${invitee}的邀请`}>
      <div className="vx-chat-head"><MessageCircle aria-hidden size={15}/>发给 <b>{invitee}</b></div>
      <p className="vx-bubble">{message}</p>
      {createdAt && <small>{localDate(createdAt)}</small>}
    </div>
    {sent && <ProcessSteps label="邀请进度" steps={[{ label: '起草', state: 'done' }, { label: '确认', state: 'done' }, { label: '已发送', state: 'done' }, { label: '等待回应', state: 'current' }]}/>}
  </div>;
}
export function InviteList({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) return <EmptyViz title="还没有发出邀请"/>;
  return <ul className="vx-invites">{rows.map(item => <li key={text(item.id)}><Gift aria-hidden size={16}/><b>{text(item.invitee)}</b><small>{localDate(text(item.createdAt))}</small><Chip badge={{ label: text(item.statusText) || '已发送', tone: 'info' }}/></li>)}</ul>;
}

/* ---------- Merchant guidance (TR11) ---------- */

export function MerchantGuideCard({ value }: { value: unknown }) {
  const row = record(value), steps = Array.isArray(row.guide) ? row.guide.map(text) : [];
  return <div className="viz-group">
    <div className="vx-external"><Store aria-hidden size={26}/><div><b>{text(row.item) || '这件商品'}在商户官方渠道下单</b><small>付款后回来就能在账单里看到这笔</small></div></div>
    <ol className="vx-steps">{steps.map((step, index) => <li key={step}><span>{index + 1}</span>{step}</li>)}</ol>
  </div>;
}

/* ---------- Reminder and goal dates ---------- */

export function DateCountdown({ date, title, today, note }: { date: string; title: string; today: string; note?: string }) {
  const left = days(today, date);
  return <div className="vx-date">
    <div className="vx-date-leaf" aria-hidden><small>{Number(date.slice(5, 7))}月</small><b>{Number(date.slice(8, 10))}</b><small>周{weekday(date)}</small></div>
    <div><b>{title}</b><span>{left > 0 ? `${left} 天后` : left === 0 ? '就是今天' : `已过去 ${-left} 天`} · {md(date)}</span>{note && <small>{note}</small>}</div>
  </div>;
}
export function ReminderCard({ bank, task }: { bank: BankState; task: FlowTask }) {
  const p = task.params, at = text(p.remindAt).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(at)) return null;
  const today = businessDay(bank), goal = list(bank.workflows?.records.goals).find(item => /生日/.test(text(item.name)) && text(item.deadline) >= at);
  return <div className="viz-group">
    <DateCountdown date={at} title="提醒你" today={today} note="站内提醒"/>
    {goal && <Timeline label="时间线" points={[{ date: today, label: '今天', tone: 'today' }, { date: at, label: '提醒', tone: 'remind' }, { date: text(goal.deadline), label: text(goal.name), tone: 'event' }]}/>}
  </div>;
}

/* ---------- Transfer risk and amount read-back ---------- */

export function TransferRiskBanner({ bank, task }: { bank: BankState; task: FlowTask }) {
  if (!['TR03'].includes(task.functionId) || task.status !== 'review') return null;
  const amount = Math.round(Number(task.params.amount) * 100) || 0;
  const risk = transferRisk(bank, { recipientId: typeof task.params.recipientId === 'string' ? task.params.recipientId : null, amount: amount || null });
  return risk.elevated ? <div className="vx-risk" role="note"><ShieldAlert aria-hidden size={18}/><div><b>请特别核对</b><div className="vx-badges">{risk.reasons.map(reason => <Chip key={reason} badge={{ label: reason, tone: 'risk' }}/>)}</div></div></div> : null;
}
/** The amount in financial capitals, read back under the money flow. */
export function UpperAmount({ cents }: { cents: number }) {
  return cents > 0 ? <p className="vx-upper" aria-label="大写金额"><span>大写</span><b>{upperAmount(cents)}</b></p> : null;
}

/* ---------- Review note (IN16 note) ---------- */

export function NotePreview({ note }: { note: string }) {
  return <blockquote className="vx-note-card"><NotebookPen aria-hidden size={16}/>{note}</blockquote>;
}

