'use client';
import { useContext } from 'react';
import { PhoneCall, ShieldAlert } from 'lucide-react';
import type { BankAction, BankState } from '@/lib/bank/types';
import type { FlowTask } from '@/lib/workflows/types';
import { Chip } from './desk';
import { InvestRisk } from './desk';
import { FollowUp } from './card-viz';

/**
 * A transfer stopped by scam wording. It says first that no money moved, then which words triggered it and what
 * to do next. There is no retry: the same words would stop it again, and only the user can verify the story.
 */
export function FraudStop({ task, busy, onAction }: { task: FlowTask; busy: boolean; onAction: (action: BankAction) => Promise<void> }) {
  const words = task.riskSignals || [];
  return <section className="fraud-stop" aria-label="风险拦截">
    <div className="fraud-banner"><ShieldAlert aria-hidden size={22}/><div><b>资金没有转出，账户没有扣款</b><span>这笔转账在提交前被规则拦下，不是模型的判断</span></div></div>
    {words.length > 0 && <div className="fraud-words"><small>识别到的说法</small><span>{words.map(word => <Chip key={word} badge={{ label: word, tone: 'risk' }}/>)}</span></div>}
    <dl className="fraud-facts">
      <div><dt>为什么拦</dt><dd>“安全账户”“涉嫌洗钱要配合调查”“先交解冻费或保证金”是冒充公检法、刷单返利等骗局的常见说法，钱一旦转给个人账户很难追回。</dd></div>
      <div><dt>银行不会</dt><dd>让你把钱转到所谓安全账户，也不会在电话里索要验证码。</dd></div>
    </dl>
    <ol className="fraud-steps">
      <li>先挂断电话，不要按对方要求转账、下载软件或共享屏幕</li>
      <li>拨打 96110 反诈专线或 110 核实</li>
      <li>需要银行协助时，通过官方客服电话或网点办理</li>
    </ol>
    <div className="fraud-actions">
      <a className="secondary-button" href="tel:96110"><PhoneCall aria-hidden size={16}/>拨打 96110 核实</a>
      <button type="button" className="primary-button" disabled={busy} onClick={() => void onAction({ type: 'workflow', command: { operation: 'cancel', taskId: task.id, source: 'card' } })}>我知道了，结束这笔</button>
    </div>
  </section>;
}

/** The suitability reading for a purchase: the formal assessment beside the product risk, with the two ways forward. */
export function SuitabilityStop({ bank, task, busy, onAction, onEdit }: { bank: BankState; task: FlowTask; busy: boolean; onAction: (action: BankAction) => Promise<void>; onEdit: () => void }) {
  return <section className="suitability-stop" aria-label="适当性检查">
    <AssessmentPair bank={bank} productId={typeof task.params.productId === 'string' ? task.params.productId : undefined}/>
    <div className="fraud-actions">
      <button type="button" className="secondary-button" disabled={busy} onClick={onEdit}>改选产品</button>
      <button type="button" className="text-button" disabled={busy} onClick={() => void onAction({ type: 'workflow', command: { operation: 'cancel', taskId: task.id, source: 'card' } })}>先不买了</button>
    </div>
  </section>;
}

/** Assessment and product risk side by side; without a valid assessment the left column says so instead of a level. */
export function AssessmentPair({ bank, productId }: { bank: BankState; productId?: string }) {
  const profile = bank.workflows?.riskProfile, product = bank.workflows?.records.products?.find(item => item.id === productId);
  if (profile && product) return <InvestRisk bank={bank} task={{ functionId: 'IN08', params: { productId: product.id } }}/>;
  return <section className="invest-risk" aria-label="风险匹配">
    <div className="risk-pair">
      <div><small>你的风险测评</small><b>—</b><span>还没有有效的正式测评；口头说的等级不算</span></div>
      {product ? <div><small>{String(product.name)}</small><b>R{String(product.risk)}</b><span>非存款 · 不保本</span></div> : <div><small>产品风险</small><b>R1–R5</b><span>测评后按等级匹配</span></div>}
      <div><small>机构规则匹配结果</small><Chip badge={{ label: '需先测评', tone: 'wait' }}/><span>确定性规则 · 非模型判断</span></div>
    </div>
  </section>;
}

/** Next steps after a lesson: the lesson never changes eligibility, so the way forward is the formal assessment or a product list. */
export function LessonNext({ assessed }: { assessed: boolean }) {
  const follow = useContext(FollowUp);
  if (!follow) return null;
  return <div className="lesson-next">
    {!assessed && <button type="button" className="secondary-button" onClick={() => follow('IN05', { action: 'assess' })}>去做风险测评</button>}
    <button type="button" className="secondary-button" onClick={() => follow('IN06', {})}>看看理财产品</button>
  </div>;
}
