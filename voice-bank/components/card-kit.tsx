'use client';
import type { ReactNode } from 'react';
import { CircleCheck, CircleDashed, CreditCard, Database, FileText, Hourglass, Lock, Receipt, Route, Search, ShieldAlert, ShieldCheck, TriangleAlert, Users, Wallet } from 'lucide-react';
import type { BankState } from '@/lib/bank/types';
import type { FlowTask } from '@/lib/workflows/types';
import { aaView, receiptStatus, subscriptionStates, type CardIcon, type CardHeadView } from '@/lib/ui/cards';
import { Chip } from './desk';

const ICONS: Record<CardIcon, typeof Search> = { search: Search, shield: ShieldCheck, lock: Lock, receipt: Receipt, users: Users, route: Route, card: CreditCard, alert: TriangleAlert, database: Database, wallet: Wallet, file: FileText, pending: Hourglass };
const yuan = (cents: number) => (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The header every business card shares: icon, title, status chip, then its own control. */
export function CardHead({ head, children }: { head: CardHeadView; children?: ReactNode }) {
  const Icon = ICONS[head.icon];
  return <div className="card-top card-head"><Icon aria-hidden size={20}/><h2>{head.title}</h2><span className="card-head-end">{head.badge && <Chip badge={head.badge}/>}{children}</span></div>;
}

export function Row({ label, value, strong }: { label: ReactNode; value: ReactNode; strong?: boolean }) {
  return <div className={`card-row ${strong ? 'is-strong' : ''}`}><span>{label}</span><span>{value}</span></div>;
}

export function ReceiptStatus({ bank, task }: { bank: BankState; task: FlowTask }) {
  const status = receiptStatus(bank, task);
  if (!status) return null;
  const Icon = status.tone === 'ok' ? CircleCheck : status.tone === 'pending' ? Hourglass : status.tone === 'risk' ? ShieldAlert : CircleDashed;
  return <div className={`receipt-status tone-${status.tone}`}><Icon aria-hidden size={22}/>{status.label}{status.note && <small>{status.note}</small>}</div>;
}

/** The split before anything is created; the card totals it again in plain sight. */
export function AaCalculation({ bank, task }: { bank: BankState; task: FlowTask }) {
  const aa = aaView(bank, task.result);
  if (!aa) return null;
  const items = Array.isArray(task.params.adjustments) ? task.params.adjustments as { label: string; amount: number; participants: string[] }[] : [];
  return <section aria-label="分摊明细">
    {items.length > 0 && <p className="aa-rule">按你的说明计算：{items.map(item => `${item.label} ${item.amount} 元由 ${item.participants.join('、')} 分摊`).join('；')}，其余所有人均分</p>}
    <table className="aa-table"><thead><tr><th>成员</th><th>明细</th><th className="r">应付</th></tr></thead>
      <tbody>{aa.members.map(member => <tr key={member.name}><td>{member.name}{member.payer && <em>垫付人</em>}</td><td className="muted">{member.detail}</td><td className="r">{yuan(member.amount)}</td></tr>)}</tbody></table>
    <div className={`aa-assert ${aa.balanced ? '' : 'is-off'}`}><span><CircleCheck aria-hidden size={16}/>{aa.members.length} 人合计 {yuan(aa.members.reduce((sum, member) => sum + member.amount, 0))} ＝ 总额 {yuan(aa.total)}</span><span><CircleCheck aria-hidden size={16}/>其他人应收 <b>{yuan(aa.receivable)}</b> 元</span></div>
  </section>;
}

/** Money received and reminders sent are separate columns: a reminder never counts as payment. */
export function AaStatus({ bank, value, busy, onRemind }: { bank: BankState; value: unknown; busy?: boolean; onRemind?: (sessionId: string) => void }) {
  const aa = aaView(bank, value);
  if (!aa) return null;
  const others = aa.members.filter(member => !member.payer);
  return <section className="aa-status" aria-label="收款状态">
    <div className="stat-split">
      <div><small>已收</small><b className="is-ok">{yuan(aa.received)}</b></div>
      <div><small>待收</small><b className="is-wait">{yuan(aa.outstanding)}</b></div>
      <div><small>应收</small><b>{yuan(aa.receivable)}</b></div>
    </div>
    <div className="stat-bar" aria-hidden><span style={{ width: `${aa.receivable ? aa.received / aa.receivable * 100 : 0}%` }}/></div>
    <table className="aa-table"><thead><tr><th>成员</th><th className="r">应付</th><th>到账状态</th><th>提醒发送状态</th></tr></thead>
      <tbody>{others.map(member => <tr key={member.name}><td>{member.name}</td><td className="r">{yuan(member.amount)}</td>
        <td><Chip badge={member.paid ? { label: '已到账', tone: 'ok' } : { label: '未到账', tone: 'wait' }}/></td>
        <td>{member.reminder === 'sent' ? <Chip badge={{ label: '已发送', tone: 'info' }}/> : <span className="muted">{member.paid ? '无需提醒' : '未发送'}</span>}</td></tr>)}</tbody></table>
    {onRemind && aa.unpaid.length > 0 && <div className="card-actions"><button className="secondary-button" disabled={busy} onClick={() => onRemind(aa.id)}>提醒待付的 {aa.unpaid.join('、')}</button></div>}
    <p className="note-line">提醒前重查付款状态，已付者不再提醒；“已发送”不等于“已到账”。</p>
  </section>;
}

export function SubscriptionStates({ value }: { value: unknown }) {
  return <div className="four-state" aria-label="订阅状态">{subscriptionStates(value).map(item => <div key={item.key}><small>{item.label}</small><Chip badge={{ label: item.state, tone: item.tone }}/></div>)}</div>;
}
