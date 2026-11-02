import type { BankState } from '@/lib/bank/types';
const labels = { passed: '已核验', clarify: '待确认', blocked: '已暂停', pending: '待前序完成' };
export function ChecklistExplanation({ bank }: { bank: BankState }) {
  const routing = bank.routing;
  const execution = bank.checklist && (!routing || routing.workflowId === bank.checklist.workflowId) ? bank.checklist : null;
  if (!routing && !execution) return null;
  const question = routing?.outcome === 'unsupported' ? routing.question : execution?.question || routing?.question;
  return <details className="decision-panel"><summary>查看办理依据<span>{question ? '有待完成的检查' : '已核验当前条件'}</span></summary>
    {question && <p className="decision-question">{question}</p>}
    {routing && <section><h3>① 意图识别</h3><p>流程：{routing.workflowId || '等待明确业务'}</p>
      <ol>{routing.checks.map(check => <li key={check.id} data-status={check.status}><strong>{labels[check.status]}</strong><span>{check.title}：{check.reason}</span></li>)}</ol>
      {!!routing.evidence.length && <ul className="field-evidence">{routing.evidence.map((item,i)=><li key={i}>{item.field === 'recipient' ? '收款人' : item.field === 'account' ? '付款账户' : item.field === 'amount' ? '金额' : item.field}依据：{item.quote}（{item.source === 'utterance' ? '本轮原话' : item.source === 'user-card' ? '页面明确操作' : '当前任务记录'}）</li>)}</ul>}
    </section>}
    {execution && <section><h3>② 执行检查单</h3><ol>{execution.checks.map(check=><li key={check.id} data-status={check.status}><strong>{labels[check.status]}</strong><span>{check.title}{check.status !== 'passed' && check.status !== 'pending' ? '：'+check.reason : ''}<small>{check.id}</small></span></li>)}</ol></section>}
    {!!bank.audit?.length && <section><h3>最近办理记录</h3><ol>{bank.audit.slice(-5).reverse().map(entry=><li key={entry.id}><span>{entry.workflowId || '意图澄清'} · {entry.outcome === 'proceed' ? '通过当前阶段' : entry.outcome === 'unsupported' ? '执行能力未接入' : entry.outcome === 'blocked' ? '暂停' : '等待澄清'}<small>{entry.at} · {entry.policyVersion}</small></span></li>)}</ol></section>}
  </details>;
}
