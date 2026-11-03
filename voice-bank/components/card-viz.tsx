'use client';
import { createContext, Fragment, useContext, type ReactNode } from 'react';
import { AlarmClock, ArrowRight, Ban, BookOpen, CalendarDays, Check, CreditCard, Goal, Landmark, Lightbulb, Lock, ShieldAlert, Snowflake, Sparkles, Target, TrendingUp, User } from 'lucide-react';
import type { BankState } from '@/lib/bank/types';
import type { FlowTask } from '@/lib/workflows/types';
import { contactsOf } from '@/lib/bank/recipients';
import { localDate } from '@/lib/ui/business';
import { clampRatio, cumulativeSteps, dailyNet, eventMonths, monthGrid, orderSteps, segments } from '@/lib/ui/viz';
import { Chip, InvestRisk } from './desk';
import { standingLimits } from '@/lib/workflows/limits';

/** Opens a new card for the user to review; it never executes anything by itself. */
export const FollowUp = createContext<((functionId: string, params: Record<string, unknown>) => void) | null>(null);

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown) => Array.isArray(value) ? value.map(record) : [];
const num = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0;
const text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
export const yuan = (cents: number) => `${cents < 0 ? '-' : ''}¥${(Math.abs(cents) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** Tight tiles drop “.00” on whole amounts; cents still show when there are any. */
const whole = (cents: number) => cents % 100 ? yuan(cents) : `¥${(cents / 100).toLocaleString('zh-CN')}`;
const CYCLE: Record<string, string> = { monthly: '每月', yearly: '每年', weekly: '每周', daily: '每日' };
const cycle = (value: unknown) => CYCLE[text(value)] || text(value);

/* ---------- Primitives ---------- */

export function Kpis({ items }: { items: { label: string; value: string; note?: string; lead?: boolean }[] }) {
  return <div className="viz-kpis">{items.map(item => <div key={item.label} className={item.lead ? 'is-lead' : ''}><small>{item.label}</small><b>{item.value}</b>{item.note && <span>{item.note}</span>}</div>)}</div>;
}

/** Part-to-whole with a legend, so identity is never carried by colour alone. */
export function StackBar({ rows, label }: { rows: { label: string; value: number }[]; label: string }) {
  const parts = segments(rows);
  if (!parts.length) return null;
  return <figure className="viz-stack" aria-label={label}>
    <div className="viz-stack-bar" aria-hidden>{parts.map(part => <span key={part.label} data-tip={`${part.label} ${yuan(part.value)} · ${(part.share * 100).toFixed(1)}%`} style={{ flexGrow: Math.max(part.share, .012), background: `var(--series-${part.slot})` }}/>)}</div>
    {parts.length > 1 && <ul className="viz-legend">{parts.map(part => <li key={part.label}><i style={{ background: `var(--series-${part.slot})` }}/>{part.label}<b>{yuan(part.value)}</b><span>{(part.share * 100).toFixed(0)}%</span></li>)}</ul>}
  </figure>;
}

/** A single ratio against a limit; the words carry the numbers. */
export function Meter({ value, max, label, note, tone = 'blue' }: { value: number; max: number; label: string; note?: string; tone?: 'blue' | 'ok' | 'wait' | 'risk' }) {
  return <div className="viz-meter" role="img" aria-label={`${label}：${yuan(value)} / ${yuan(max)}`}>
    <div className="viz-meter-head"><span>{label}</span><b>{yuan(value)}<small> / {yuan(max)}</small></b></div>
    <div className="viz-meter-track"><span className={`tone-${tone}`} style={{ width: `${clampRatio(max ? value / max : 0) * 100}%` }}/></div>
    {note && <small className="viz-meter-note">{note}</small>}
  </div>;
}

/** Progress ring around the one number that matters. */
export function Ring({ ratio, center, caption }: { ratio: number; center: string; caption?: string }) {
  const r = 42, length = 2 * Math.PI * r, part = clampRatio(ratio);
  return <div className="viz-ring" role="img" aria-label={`${caption || '进度'} ${center}`}>
    <svg viewBox="0 0 100 100" aria-hidden><circle cx="50" cy="50" r={r} className="viz-ring-track"/>{part > 0 && <circle cx="50" cy="50" r={r} className="viz-ring-value" strokeDasharray={`${Math.max(part * length, 3)} ${length}`} transform="rotate(-90 50 50)"/>}</svg>
    <div><b>{center}</b>{caption && <small>{caption}</small>}</div>
  </div>;
}

export function RankBars({ rows, label }: { rows: { label: string; value: number; note?: string }[]; label: string }) {
  const largest = Math.max(1, ...rows.map(row => Math.abs(row.value)));
  return <ul className="viz-rank" aria-label={label}>{rows.map(row => <li key={row.label} data-tip={`${row.label} ${yuan(row.value)}`}>
    <span className="viz-rank-label">{row.label}{row.note && <small>{row.note}</small>}</span>
    <span className="viz-rank-track"><i className={row.value < 0 ? 'is-negative' : ''} style={{ width: `${Math.abs(row.value) / largest * 100}%` }}/></span>
    <b>{yuan(row.value)}</b>
  </li>)}</ul>;
}

export function Columns({ rows, label }: { rows: { key: string; tick: string; value: number; tip: string; emphasis?: boolean }[]; label: string }) {
  const largest = Math.max(1, ...rows.map(row => Math.abs(row.value)));
  const anyNegative = rows.some(row => row.value < 0);
  return <figure className={`viz-columns ${anyNegative ? 'has-negative' : ''}`} aria-label={label}><figcaption>{label}</figcaption><div>{rows.map(row => <div key={row.key} data-tip={row.tip}>
    <span className="viz-col-plot"><i className={`${row.value < 0 ? 'is-negative' : ''} ${row.emphasis ? 'is-emphasis' : ''}`} style={{ height: `${Math.max(Math.abs(row.value) / largest * 100, 2)}%` }}/></span>
    <small>{row.tick}</small>
  </div>)}</div></figure>;
}

/** An ordered scale with one marked level, and optionally a second one to compare against. */
export function LevelScale({ prefix, level, compareLevel, comparePrefix, caption }: { prefix: string; level: number; compareLevel?: number; comparePrefix?: string; caption?: string }) {
  return <div className="viz-scale" role="img" aria-label={`${caption || '等级'} ${prefix}${level}${compareLevel != null ? `，${comparePrefix}${compareLevel}` : ''}（共 5 级）`}>
    <ol>{[1, 2, 3, 4, 5].map(step => <li key={step} className={`${step <= level ? 'is-filled' : ''} ${step === level ? 'is-mark' : ''} ${step === compareLevel ? 'is-compare' : ''}`}><i/><small>{[step === level ? `${prefix}${step}` : '', step === compareLevel ? `${comparePrefix}${step}` : ''].filter(Boolean).join(' · ') || step}</small></li>)}</ol>
    {caption && <span>{caption}</span>}
  </div>;
}

export function ProcessSteps({ steps, label }: { steps: { label: string; state: 'done' | 'current' | 'todo' | 'void' }[]; label: string }) {
  return <ol className="viz-steps" aria-label={label}>{steps.map((step, index) => <li key={step.label} className={`is-${step.state}`} aria-current={step.state === 'current' ? 'step' : undefined}><span>{step.state === 'done' ? <Check aria-hidden size={12} strokeWidth={3}/> : step.state === 'void' ? <Ban aria-hidden size={12}/> : index + 1}</span>{step.label}</li>)}</ol>;
}

const initial = (name: string) => name.trim().slice(-1) || '·';
function hue(name: string) { let sum = 0; for (const char of name) sum += char.charCodeAt(0); return sum % 8 + 1; }
export function Avatar({ name, icon }: { name: string; icon?: ReactNode }) {
  return <span className="viz-avatar" aria-hidden style={{ background: `var(--series-${hue(name)})` }}>{icon || initial(name)}</span>;
}

type FlowNode = { icon?: ReactNode; title: string; sub?: string };
/** Where the money goes, read left to right. Shown before and after execution alike. */
export function MoneyFlow({ from, to, amount, note }: { from: FlowNode; to: FlowNode; amount: string; note?: string }) {
  const node = (item: FlowNode) => <div className="viz-flow-node"><Avatar name={item.title} icon={item.icon}/><b>{item.title}</b>{item.sub && <small>{item.sub}</small>}</div>;
  return <div className="viz-flow" role="img" aria-label={`${from.title} 到 ${to.title}，${amount}${note ? `，${note}` : ''}`}>
    {node(from)}
    <div className="viz-flow-link"><b>{amount}</b><span><ArrowRight aria-hidden size={16}/></span>{note && <small>{note}</small>}</div>
    {node(to)}
  </div>;
}

/* ---------- Bank card ---------- */

const CARD_STATE: Record<string, { label: string; tone: 'ok' | 'info' | 'wait' | 'risk' | 'muted' }> = {
  active: { label: '正常', tone: 'ok' }, frozen: { label: '临时冻结', tone: 'info' }, lost: { label: '正式挂失', tone: 'risk' }, restricted: { label: '受限制', tone: 'wait' }, activated: { label: '已激活', tone: 'ok' },
};
/** A card face. Only the tail is ever drawn; status changes come from the card record. */
export function CardPlate({ card, previewStatus }: { card: Record<string, unknown>; previewStatus?: string }) {
  const status = previewStatus || text(card.status) || 'active';
  const state = CARD_STATE[status] || { label: status, tone: 'muted' as const };
  return <div className={`viz-plate is-${status}`} role="img" aria-label={`${text(card.name)} 尾号 ${text(card.tail)}，${state.label}${previewStatus ? '（办理后）' : ''}`}>
    <div className="viz-plate-top"><span><Landmark aria-hidden size={14}/>知行银行</span><em>{previewStatus ? `办理后 · ${state.label}` : state.label}</em></div>
    <i className="viz-plate-chip" aria-hidden/>
    <div className="viz-plate-number" aria-hidden>•••• •••• •••• {text(card.tail)}</div>
    <div className="viz-plate-foot"><b>{text(card.name)}</b>{num(card.limit) > 0 && <small>限额 {yuan(num(card.limit))}</small>}</div>
    {status === 'frozen' && <Snowflake className="viz-plate-mark" aria-hidden size={72}/>}
    {status === 'lost' && <Ban className="viz-plate-mark" aria-hidden size={72}/>}
    {status === 'restricted' && <Lock className="viz-plate-mark" aria-hidden size={60}/>}
  </div>;
}

/* ---------- Domain visuals ---------- */

export function AccountsViz({ accounts }: { accounts: Record<string, unknown>[] }) {
  const withBalance = accounts.filter(item => typeof item.balance === 'number');
  const total = withBalance.reduce((sum, item) => sum + num(item.balance), 0);
  return <div className="viz-group">
    {withBalance.length > 0 && <div className="viz-hero"><small>{withBalance.length > 1 ? `总余额 · ${withBalance.length} 个账户` : '账户余额'}</small><strong>{yuan(total)}</strong></div>}
    {withBalance.length > 1 && <StackBar label="账户余额分布" rows={withBalance.map(item => ({ label: text(item.name), value: num(item.balance) }))}/>}
    <div className="viz-tiles">{accounts.map((item, index) => <div className="viz-tile" key={text(item.id) || index}><Avatar name={text(item.name)} icon={<CreditCard size={16}/>}/><div><b>{text(item.name) || '账户'}</b><small>尾号 {text(item.tail) || '—'}</small></div>{typeof item.balance === 'number' && <strong>{yuan(item.balance)}{typeof item.available === 'number' && item.available !== item.balance && <small>可用 {yuan(item.available)}（{yuan(num(item.held))} 申购占用）</small>}</strong>}</div>)}</div>
  </div>;
}

const subGroup = (item: Record<string, unknown>) => item.status === 'cancelled' ? 2 : item.cancellationPending === true || item.externalPending === true ? 1 : 0;
const SUB_GROUPS = ['生效中', '取消处理中', '已解除'];
function SubscriptionRows({ rows }: { rows: Record<string, unknown>[] }) {
  const follow = useContext(FollowUp);
  // Grouped by state so a cancelled or pending mandate never sits among the active ones.
  const sorted = [...rows].sort((a, b) => subGroup(a) - subGroup(b)), grouped = new Set(sorted.map(subGroup)).size > 1;
  return <ul className="viz-subs">{sorted.map((item, index) => <Fragment key={text(item.id)}>{grouped && (index === 0 || subGroup(item) !== subGroup(sorted[index - 1])) ? <li className="viz-subs-group" aria-hidden>{SUB_GROUPS[subGroup(item)]}</li> : null}<li>
    <Avatar name={text(item.name)}/>
    <div className="viz-subs-main"><b>{text(item.name)}</b><small>{[cycle(item.cycle), item.nextChargeAt ? `下次 ${text(item.nextChargeAt)}` : ''].filter(Boolean).join(' · ')}</small></div>
    <span className="viz-subs-tags">
      <Chip badge={item.channel === 'bank' ? { label: '银行代扣', tone: 'info' } : { label: '外部平台', tone: 'muted' }}/>
      {item.protected === true && <Chip badge={{ label: '保护类', tone: 'wait' }}/>}
      {item.status === 'cancelled' && <Chip badge={{ label: '银行协议已解除', tone: 'muted' }}/>}
      {item.cancellationPending === true && <Chip badge={{ label: '取消待核对', tone: 'wait' }}/>}
      {item.externalPending === true && <Chip badge={{ label: '待你在平台完成取消', tone: 'pending' }}/>}
    </span>
    <strong>{yuan(num(item.amount))}</strong>
    {follow && item.status === 'active' && item.protected !== true && !subGroup(item) && <button className="pill-button" onClick={() => follow('SU04', { subscriptionId: item.id })}>不再使用 · 看处理路径</button>}
  </li></Fragment>)}</ul>;
}
export function SubscriptionRadar({ rows, inference }: { rows: Record<string, unknown>[]; inference?: string }) {
  if (!rows.length) return <EmptyViz title="没有查到订阅" note="这里只显示已授权范围内的周期扣费。"/>;
  const active = rows.filter(item => item.status === 'active' && item.cycle === 'monthly');
  const month = active.reduce((sum, item) => sum + num(item.amount), 0);
  return <div className="viz-group">
    <Kpis items={[{ label: '每月固定支出（生效中）', value: yuan(month), lead: true }, { label: '生效中', value: `${rows.filter(item => item.status === 'active').length} 项` }, ...(rows.some(item => item.status === 'cancelled') ? [{ label: '已解除', value: `${rows.filter(item => item.status === 'cancelled').length} 项` }] : [])]}/>
    <StackBar label="每月扣费构成" rows={active.map(item => ({ label: text(item.name), value: num(item.amount) }))}/>
    <SubscriptionRows rows={rows}/>
    {inference && <p className="note-line">{inference}</p>}
  </div>;
}

export function ChargeCalendar({ value }: { value: unknown }) {
  const result = record(value), events = list(result.calendar).map(item => ({ date: text(item.date), name: text(item.name), amount: num(item.amount), status: text(item.status) }));
  const months = eventMonths(events);
  return <div className="viz-group">
    {typeof result.available === 'number' && typeof result.planned === 'number' && <Meter label="已知计划支出 / 可用余额" value={result.planned} max={Math.max(result.available, result.planned)} tone={result.planned > result.available ? 'risk' : 'blue'}/>}
    {months.map(month => <figure className="viz-calendar" key={month} aria-label={`${month} 扣款日历`}>
      <figcaption><CalendarDays aria-hidden size={15}/>{month.replace('-', ' 年 ')} 月</figcaption>
      <div className="viz-calendar-grid" role="presentation">{['一', '二', '三', '四', '五', '六', '日'].map(day => <small key={day}>{day}</small>)}
        {monthGrid(month, events).map((cell, index) => cell ? <div key={cell.date} className={cell.events.length ? 'has-event' : ''} data-tip={cell.events.length ? cell.events.map(item => `${item.name} ${yuan(item.amount)}`).join('、') : undefined}><span>{cell.day}</span>{cell.events.length > 0 && <i/>}</div> : <div key={`blank-${index}`} className="is-blank"/>)}
      </div>
    </figure>)}
    <ul className="viz-agenda">{events.map(item => <li key={item.date + item.name}><time>{item.date.slice(5)}</time><b>{item.name}</b><small>{item.status}</small><strong>{yuan(item.amount)}</strong></li>)}</ul>
  </div>;
}

export function GoalViz({ goal, plan }: { goal: Record<string, unknown>; plan?: { amount: number; direction: string } }) {
  const target = num(goal.target), balance = num(goal.balance), after = plan ? balance + (plan.direction === 'deposit' ? plan.amount : -plan.amount) : balance;
  const ratio = target ? after / target : 0;
  return <div className="viz-goal">
    <Ring ratio={ratio} center={`${(clampRatio(ratio) * 100).toFixed(ratio > 0 && ratio < .1 ? 1 : 0)}%`} caption={plan ? '办理后' : '已存'}/>
    <div>
      <b className="viz-goal-name"><Target aria-hidden size={16}/>{text(goal.name) || '储蓄目标'}</b>
      <Kpis items={[{ label: plan ? '办理后已存' : '已存', value: yuan(after) }, { label: '目标', value: yuan(target) }, { label: '还差', value: yuan(Math.max(target - after, 0)) }]}/>
      {goal.deadline != null && <small className="viz-goal-deadline">截止 {text(goal.deadline)}{num(goal.monthlyAmount) > 0 ? ` · 每月计划 ${yuan(num(goal.monthlyAmount))}` : ''}</small>}
    </div>
  </div>;
}

export function ProductScale({ risk }: { risk: unknown }) {
  return typeof risk === 'number' && risk > 0 ? <LevelScale prefix="R" level={risk} caption="产品风险等级"/> : null;
}

function HoldingsViz({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) return <EmptyViz title="当前没有持仓" note="已受理的申购在份额确认前不算持有。"/>;
  const total = rows.reduce((sum, item) => sum + num(item.value), 0), profit = rows.reduce((sum, item) => sum + num(item.profit), 0);
  return <div className="viz-group">
    <Kpis items={[{ label: '持仓市值（合成数据）', value: yuan(total), lead: true }, { label: '累计收益', value: `${profit > 0 ? '+' : ''}${yuan(profit)}`, note: '合成数据，不代表未来' }]}/>
    <StackBar label="持仓构成" rows={rows.map(item => ({ label: text(item.name), value: num(item.value) }))}/>
    <ul className="viz-agenda">{rows.map(item => <li key={text(item.id)}><time><TrendingUp aria-hidden size={14}/></time><b>{text(item.name)}</b><small>成本 {yuan(num(item.cost))}</small><strong>{yuan(num(item.value))}</strong></li>)}</ul>
  </div>;
}

function OrdersViz({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) return <EmptyViz title="还没有理财订单"/>;
  return <ul className="viz-orders">{rows.map(item => <li key={text(item.id)}><div className="viz-orders-head"><b>{item.action === 'redeem' ? '赎回' : '申购'} · {text(item.name)}</b><strong>{yuan(num(item.amount))}</strong></div><ProcessSteps label="订单进度" steps={orderSteps(item)}/>{item.createdAt != null && <small>{localDate(text(item.createdAt))} · 编号 …{text(item.id).slice(-8)}</small>}</li>)}</ul>;
}

function RulesViz({ rows, bank }: { rows: Record<string, unknown>[]; bank?: BankState }) {
  if (!rows.length) return <EmptyViz title="还没有规则" note="规则最长期限和次数都由你确认，不会自动续期。"/>;
  return <ul className="viz-rules">{rows.map(item => {
    const contact = bank && contactsOf(bank).find(c => c.id === item.recipientId);
    return <li key={text(item.id)}><AlarmClock aria-hidden size={18}/><div><b>{contact ? `${contact.name} · ${contact.label}` : text(item.name) || text(item.productId) || '周期规则'}</b><small>{cycle(item.schedule)}{item.executionState === 'scheduled_not_connected' ? ' · 自动执行尚未启用' : ''}</small></div><strong>{yuan(num(item.amount))}</strong><Chip badge={item.status === 'active' ? { label: '生效', tone: 'ok' } : item.status === 'paused' ? { label: '已暂停', tone: 'wait' } : { label: '已结束', tone: 'muted' }}/></li>;
  })}</ul>;
}

function ContactsViz({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) return <EmptyViz title="还没有联系人"/>;
  return <div className="viz-tiles">{rows.map((item, index) => <div className="viz-tile" key={text(item.id) || index}><Avatar name={text(item.label) + text(item.name)}/><div><b>{text(item.name) || text(item.alias) || '联系人'}</b><small>{[item.label, item.bank, item.tail && `尾号 ${text(item.tail)}`].filter(Boolean).map(text).join(' · ')}</small></div></div>)}</div>;
}

function TransfersViz({ rows, }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) return <EmptyViz title="还没有转账记录"/>;
  return <ul className="viz-agenda">{rows.map((item, index) => <li key={text(item.id) || index}><time>{text(item.createdAt).slice(5, 10) || '—'}</time><b>{text(item.recipient) || text(item.name) || '转账'}</b><small>编号 …{text(item.id).slice(-8)}</small><strong>{yuan(num(item.amount))}</strong></li>)}</ul>;
}

export function SimpleScale({ level, validUntil }: { level: number; validUntil?: string }) {
  return <div className="viz-group"><LevelScale prefix="C" level={level} caption="风险测评等级（沙箱）"/>{validUntil && <small className="viz-goal-deadline">有效期至 {localDate(validUntil).slice(0, 10)}</small>}</div>;
}

export function EmptyViz({ title, note }: { title: string; note?: string }) {
  return <div className="viz-empty"><Sparkles aria-hidden size={22}/><b>{title}</b>{note && <small>{note}</small>}</div>;
}

function Checklist({ items, icon }: { items: string[]; icon?: ReactNode }) {
  return <ol className="viz-checklist">{items.map((item, index) => <li key={item}><span>{icon || index + 1}</span>{item}</li>)}</ol>;
}

function PathCards({ rows }: { rows: Record<string, unknown>[] }) {
  return <div className="viz-tiles">{rows.map(item => <div className="viz-path" key={text(item.id) || text(item.name)}><div><CreditCard aria-hidden size={18}/><b>{text(item.name)}</b>{item.status != null && <Chip badge={{ label: text(item.status), tone: item.status === '未接入' ? 'muted' : 'info' }}/>}</div>{item.use != null && <p>{text(item.use)}</p>}{item.nextStep != null && <small>{text(item.nextStep)}</small>}</div>)}</div>;
}

/**
 * The picture for each read-only or finished result, chosen by business. Returning null falls
 * back to plain fields. Text facts stay in the expandable detail, so nothing is dropped.
 */
export function businessViz(functionId: string, value: unknown, bank?: BankState): ReactNode | null {
  const row = record(value), rows = list(value);
  switch (functionId) {
    case 'TR01': case 'TR02': return Array.isArray(value) ? <AccountsViz accounts={rows}/> : null;
    case 'TR04': case 'IN13':
      return Array.isArray(value) ? <RulesViz rows={rows} bank={bank}/> : row.amount != null ? <RulesViz rows={[row]} bank={bank}/> : null;
    case 'TR06': return Array.isArray(value) ? <TransfersViz rows={rows}/> : null;
    case 'TR08': case 'TR09': return Array.isArray(value) ? <ContactsViz rows={rows}/> : null;
    case 'BI04': {
      const signals = list(row.signals);
      return <div className="viz-group"><Kpis items={[{ label: '需核实的线索', value: `${signals.length} 笔`, lead: true }, { label: '核对范围', value: `${list(row.transactions).length} 笔` }]}/>{signals.map(item => <p className="warn-line" key={text(item.transactionId)}><ShieldAlert aria-hidden size={15}/> {text(item.reason)}</p>)}</div>;
    }
    case 'BI05': return <SubscriptionRadar rows={list(row.subscriptions)} inference={text(row.inference)}/>;
    case 'BI08': {
      const spending = record(row.spending), budgets = list(row.budgets);
      if (Array.isArray(row.budgets)) return budgets.length ? <div className="viz-group">{budgets.filter(item => typeof item.amount === 'number').map(item => <Meter key={text(item.id)} label={`${text(item.period) || text(item.name)} · ${text(item.category) || '全部'}`} value={num(spending.netExpenses)} max={num(item.amount)} tone={num(spending.netExpenses) > num(item.amount) ? 'risk' : 'blue'} note="已用来自统计范围内的净支出"/>)}</div> : <EmptyViz title="还没有预算" note="预算只是标记，不扣款也不冻结。"/>;
      if (typeof row.amount === 'number') return <Kpis items={[{ label: `${text(row.period)} · ${text(row.category) || '全部'}预算`, value: yuan(row.amount), lead: true, note: '不扣款 · 不冻结' }]}/>;
      return null;
    }
    case 'BI09': return typeof row.total === 'number' ? <div className="viz-group"><Kpis items={[{ label: `${num(row.periodCount)} 期累计本金（试算）`, value: yuan(row.total), lead: true, note: '不含收益，未实际存入' }]}/><Columns label="本金累计" rows={cumulativeSteps(row.total, num(row.periodCount)).map(step => ({ key: String(step.period), tick: String(step.period), value: step.value, tip: `第 ${step.period} 期 ${yuan(step.value)}` }))}/></div> : null;
    case 'SU01': return Array.isArray(value) ? <SubscriptionRadar rows={rows}/> : null;
    case 'SU07': return <div className="viz-group"><Kpis items={[{ label: `${text(record(row.actual).period)} 实际订阅支出`, value: yuan(num(record(row.actual).netExpenses)), lead: true }, { label: '预计每月少支出', value: yuan(num(row.projectedMonthlyReduction)), note: '尚未发生' }]}/><RankBars label="订阅金额" rows={list(row.subscriptions).map(item => ({ label: text(item.name), value: num(item.amount), note: cycle(item.cycle) }))}/></div>;
    case 'SU08': return <ChargeCalendar value={value}/>;
    case 'IN01': case 'IN03': case 'IN04': return row.target != null ? <GoalViz goal={row}/> : null;
    case 'IN02': return row.goal ? <div className="viz-group"><Kpis items={[{ label: row.direction === 'deposit' ? '已存入目标' : '已转回账户', value: yuan(num(row.moved)), lead: true }]}/><GoalViz goal={record(row.goal)}/></div> : null;
    case 'IN05': {
      const profile = record(row.profile || row);
      if (typeof profile.level === 'number') return <SimpleScale level={profile.level} validUntil={text(profile.validUntil)}/>;
      return row.assessmentState === 'not_found' ? <EmptyViz title="还没有风险测评" note="正式测评不是课程，也不是游戏等级。"/> : null;
    }
    case 'IN10': return Array.isArray(value) ? <HoldingsViz rows={rows}/> : null;
    case 'IN08': case 'IN09': case 'IN11': case 'IN12': return Array.isArray(value) ? <OrdersViz rows={rows}/> : row.action != null ? <OrdersViz rows={[row]}/> : null;
    case 'IN14': case 'SU03': return Array.isArray(value) ? rows.length ? <RulesViz rows={rows}/> : <EmptyViz title="还没有提醒" note="提醒只是站内通知，不会开启扣款或申购。"/> : null;
    case 'IN15': {
      const points = Array.isArray(row.points) ? row.points.map(text) : [], product = record(row.product);
      return <div className="viz-group">
        <div className="viz-learn"><BookOpen aria-hidden size={22}/><div><b>投教小课（自愿 · 可跳过）<span className="viz-learn-tag">不是购买门槛</span></b>{points.length ? <ol className="viz-learn-points">{points.map(point => <li key={point}>{point}</li>)}</ol> : <p>{text(row.content)}</p>}<small><Lightbulb aria-hidden size={13}/> 学不学都不改变风险测评；能否交易只看有效正式测评、机构适当性规则和产品规则</small></div></div>
        {bank && product.id ? <InvestRisk bank={bank} task={{ functionId: 'IN08', params: { productId: product.id } }}/> : null}
      </div>;
    }
    case 'CA01': return Array.isArray(value) ? <div className="viz-plates">{rows.map(item => <CardPlate key={text(item.id)} card={item}/>)}</div> : null;
    case 'CA02': case 'CA06': case 'CA07': return row.tail ? <div className="viz-plates is-single"><CardPlate card={row}/></div> : null;
    case 'CA03': return Array.isArray(row.paths) ? <PathCards rows={list(row.paths)}/> : null;
    case 'CA04': case 'CA05': {
      const card = record(row.card || row);
      return card.tail ? <div className="viz-plates is-single"><CardPlate card={card}/></div> : null;
    }
    case 'CA09': return Array.isArray(row.bindings) ? (list(row.bindings).length ? <ul className="viz-agenda">{list(row.bindings).map((item, index) => <li key={index}><time><Goal aria-hidden size={14}/></time><b>{text(item.name) || text(item.merchant)}</b><small>{text(item.status)}</small></li>)}</ul> : <EmptyViz title="没有已记录的绑定" note="不承诺掌握完整的第三方绑定。"/>) : null;
    default: return null;
  }
}

/** Spending shape for a statistics result: share by category, then day by day. Refunds net out of their day. */
export function SpendCharts({ rows }: { rows: Record<string, unknown>[] }) {
  const byCategory = new Map<string, number>();
  for (const item of rows) {
    const sign = item.kind === 'expense' ? 1 : item.kind === 'refund' ? -1 : 0;
    if (sign) byCategory.set(text(item.category) || '未分类', (byCategory.get(text(item.category) || '未分类') || 0) + sign * num(item.amount));
  }
  const parts = [...byCategory].filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
  const days = dailyNet(rows);
  if (!parts.length && days.length < 2) return null;
  return <div className="viz-group">
    {parts.length > 0 && <StackBar label="支出构成（按类别）" rows={parts}/>}
    {days.length > 1 && <Columns label="每日净支出" rows={days.map(day => ({ key: day.date, tick: day.date.slice(5), value: day.value, tip: `${day.date} ${yuan(day.value)}` }))}/>}
  </div>;
}

/** Rows behind a spending total: merchant-mapped categories are marked as guesses and can be corrected one by one. */
export function BillDetail({ rows }: { rows: Record<string, unknown>[] }) {
  const follow = useContext(FollowUp);
  const spent = rows.filter(item => item.kind === 'expense');
  if (!spent.length) return null;
  const guessed = spent.filter(item => item.classificationSource !== 'user-confirmed');
  // Latest first, corrected rows kept in view; a long month folds the rest away.
  const ordered = [...spent].sort((a, b) => Number(b.classificationSource === 'user-confirmed') - Number(a.classificationSource === 'user-confirmed') || text(b.date).localeCompare(text(a.date)));
  const shown = ordered.slice(0, 5), rest = ordered.slice(5);
  const line = (item: Record<string, unknown>) => { const mine = item.classificationSource === 'user-confirmed'; return <li key={text(item.id)} className={mine ? 'is-mine' : ''}>
    <time>{text(item.date).slice(5)}</time><span>{text(item.merchant)}</span><strong>{(num(item.amount) / 100).toFixed(2)}</strong>
    <em>{mine ? <><s>推断</s><b>{text(item.category)}</b><Chip badge={{ label: '你的纠正', tone: 'info' }}/></> : `${text(item.category)}（推断）`}</em>
    {follow && !mine ? <button className="pill-button" onClick={() => follow('BI03', { transactionId: item.id })}>纠正</button> : <i/>}
  </li>; };
  return <div className="viz-group">
    {guessed.length > 0 && <p className="bill-chip"><Check aria-hidden size={14}/> 分类：{guessed.length} 笔 {yuan(guessed.reduce((sum, item) => sum + num(item.amount), 0))} 按商户推断 · 不代表实际商品</p>}
    <section className="bill-detail" aria-label="明细 · 可纠正分类">
      <b className="bill-detail-title">明细 · 可纠正分类</b>
      <ul>{shown.map(line)}</ul>
      {rest.length > 0 && <details className="bill-detail-more"><summary>还有 {rest.length} 笔</summary><ul>{rest.map(line)}</ul></details>}
      <small>默认只改这一笔 · 不批量改同类商户历史 · 原始流水不变</small>
    </section>
  </div>;
}

/** Steps a guide returns stay numbered and visible, not hidden in a field list. */
export function GuideSteps({ value }: { value: unknown }) {
  const row = record(value);
  const items = [row.guide, row.nextActions, row.officialSteps].find(Array.isArray) as string[] | undefined;
  return items?.length ? <Checklist items={items.filter(item => typeof item === 'string')}/> : null;
}

/* ---------- Review visuals: what will happen, drawn before it happens ---------- */

export function ReviewViz({ bank, task, receipt }: { bank: BankState; task: FlowTask; receipt?: boolean }) {
  const p = task.params, id = task.functionId;
  const records = bank.workflows?.records;
  const account = bank.accounts.find(item => item.id === p.accountId);
  const from: FlowNode = account ? { icon: <CreditCard size={16}/>, title: account.name, sub: `尾号 ${account.tail}` } : { icon: <CreditCard size={16}/>, title: '付款账户' };
  const cents = Math.round(Number(p.amount) * 100) || 0;
  const amount = yuan(cents);
  const budgetAfter = account ? <Meter label="本次占可用余额" value={cents} max={Math.max(account.balance - (account.held || 0), cents)} note={`办理后预计余额 ${yuan(account.balance - cents)}`} tone={cents > account.balance - (account.held || 0) ? 'risk' : 'blue'}/> : null;
  if (id === 'TR03' || id === 'TR04') {
    const contact = contactsOf(bank).find(item => item.id === p.recipientId);
    if (!contact) return null;
    return <div className="viz-group"><MoneyFlow from={from} to={{ title: contact.name, sub: `${contact.label} · 尾号 ${contact.tail}` }} amount={amount} note={id === 'TR04' ? cycle(p.schedule) : text(p.note)}/>{id === 'TR03' && !receipt && budgetAfter}</div>;
  }
  if (id === 'TR05' && p.action === 'create') {
    const shares = list(record(task.result).participants);
    return <div className="viz-group"><Kpis items={[{ label: '总额', value: yuan(num(record(task.result).total)), lead: true }, { label: '人数', value: `${shares.length} 人`, note: undefined }, { label: '其他人应收', value: yuan(num(record(task.result).receivable)) }]}/><StackBar label="每人分摊" rows={shares.map(item => ({ label: text(item.name), value: num(item.amount) }))}/></div>;
  }
  if (id === 'TR05' && p.action === 'remind') return <div className="viz-tiles">{list(record(task.result).reminders).map(item => <div className="viz-tile" key={text(item.to)}><Avatar name={text(item.to)} icon={<User size={15}/>}/><div><b>{text(item.to)}</b><small>{text(item.text)}</small></div><strong>{yuan(num(item.amount))}</strong></div>)}</div>;
  if (id === 'IN02') {
    const goal = records?.goals?.find(item => item.id === p.goalId);
    if (!goal) return null;
    const goalNode = { icon: <Target size={16}/>, title: text(goal.name), sub: '目标账户' };
    return <div className="viz-group"><MoneyFlow from={p.direction === 'deposit' ? from : goalNode} to={p.direction === 'deposit' ? goalNode : from} amount={amount}/><GoalViz goal={goal} plan={{ amount: cents, direction: text(p.direction) }}/></div>;
  }
  if (id === 'IN01' && p.target != null) return <GoalViz goal={{ name: p.name, target: Math.round(Number(p.target) * 100), balance: 0, deadline: p.deadline }}/>;
  if (id === 'IN04') {
    const goal = records?.goals?.find(item => item.id === p.goalId);
    if (!goal) return null;
    if (p.amount == null) return <GoalViz goal={goal}/>;
    const limits = standingLimits(cents, p.schedule);
    // Execution falls back to the daily account when none was named, so the card says so instead of a blank payer.
    const payer = bank.accounts.find(item => item.id === (p.accountId || 'daily'));
    const source: FlowNode = payer ? { icon: <CreditCard size={16}/>, title: payer.name, sub: `尾号 ${payer.tail}${p.accountId ? '' : ' · 默认'}` } : from;
    return <div className="viz-group"><MoneyFlow from={source} to={{ icon: <Target size={16}/>, title: text(goal.name), sub: '本人目标账户' }} amount={amount} note={text(p.schedule)}/>
      <div className="viz-limits"><Kpis items={[{ label: '单笔', value: whole(limits.perRun), lead: true }, { label: '次数', value: `${limits.runs} 次` }, { label: '累计上限', value: whole(limits.cap) }, { label: '期限', value: `${limits.days} 天` }]}/></div>
      <small className="viz-limits-note">到期不自动续期 · 随时暂停 · 修改账户或金额将作废旧授权并重新确认{limits.capped ? ' · 超过 90 天的部分不在本次授权内' : ''}</small></div>;
  }
  if (id === 'IN08' || id === 'IN13') {
    const product = records?.products?.find(item => item.id === p.productId);
    return product ? <MoneyFlow from={from} to={{ icon: <TrendingUp size={16}/>, title: text(product.name), sub: `风险 R${text(product.risk)}` }} amount={amount} note={id === 'IN13' ? cycle(p.schedule) : '受理 ≠ 成交'}/> : null;
  }
  if (id === 'IN09') {
    const holding = records?.holdings?.find(item => item.id === p.holdingId);
    return holding ? <MoneyFlow from={{ icon: <TrendingUp size={16}/>, title: text(holding.name), sub: `市值 ${yuan(num(holding.value))}` }} to={from} amount={amount} note="到账前不增加余额"/> : null;
  }
  if (id === 'IN12') { const order = records?.orders?.find(item => item.id === p.orderId); return order ? <OrdersViz rows={[order]}/> : null; }
  if (id === 'SU04' || id === 'SU06') { const sub = records?.subscriptions?.find(item => item.id === p.subscriptionId); return sub ? <SubscriptionTile sub={sub}/> : null; }
  if (id === 'BI03') {
    const tx = records?.transactions?.find(item => item.id === p.transactionId);
    return tx ? <div className="viz-recat"><div><b>{text(tx.merchant)}</b><small>{text(tx.date)} · {yuan(num(tx.amount))}</small></div><span><s>{text(tx.category)}</s><ArrowRight aria-hidden size={15}/><b>{text(p.category) || '待选择'}</b></span><small>默认只改这一笔 · 原始流水不变</small></div> : null;
  }
  if (id === 'BI08' && typeof p.amount !== 'undefined') return <Kpis items={[{ label: `${text(p.period)} · ${text(p.category) || '全部'}预算`, value: amount, lead: true, note: '不扣款 · 不冻结' }]}/>;
  if (['CA02', 'CA04', 'CA05', 'CA06', 'CA07', 'CA08'].includes(id)) {
    const card = records?.cards?.find(item => item.id === p.cardId);
    if (!card) return null;
    const after = id === 'CA06' ? (p.action === 'unfreeze' ? 'active' : 'frozen') : id === 'CA07' ? 'lost' : undefined;
    return <div className="viz-plates is-compare"><CardPlate card={card}/>{after && <><ArrowRight aria-hidden size={20}/><CardPlate card={card} previewStatus={after}/></>}</div>;
  }
  return null;
}

function SubscriptionTile({ sub }: { sub: Record<string, unknown> }) {
  return <div className="viz-tile"><Avatar name={text(sub.name)}/><div><b>{text(sub.name)}</b><small>{[cycle(sub.cycle), sub.channel === 'bank' ? '银行代扣通道' : '外部平台', sub.nextChargeAt ? `下次 ${text(sub.nextChargeAt)}` : ''].filter(Boolean).join(' · ')}</small></div><strong>{yuan(num(sub.amount))}</strong></div>;
}
