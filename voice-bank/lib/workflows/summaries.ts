/** One sentence that answers a read in words, so chat and speech say the result instead of “结果已显示”. Amounts are cents. */
const yuan = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
  ? `¥${(value / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '';
const CARD_STATUS: Record<string, string> = { active: '正常', frozen: '临时冻结中', lost: '已挂失', restricted: '受限' };

const underlying = (product: Record<string, unknown>) => Array.isArray(product.underlying) && product.underlying.length
  ? (product.underlying as { asset: string; share: number }[]).map(u => `${u.asset}${u.share}%`).join('、') : '';
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Reads whose result is one record: a month report, a goal with its projection, a cancellation status. */
function recordSummary(functionId: string, result: Record<string, unknown>): string {
  if (functionId === 'IN16' && typeof result.spokenSummary === 'string') return result.spokenSummary;
  if (functionId === 'IN07' && Array.isArray(result.products)) {
    // Comparing what each product holds is part of the comparison, not a recommendation.
    const products = result.products.map(object), held = products.map(p => `${String(p.name)}：${underlying(p) || '底层资产未提供'}`).join('；');
    return `对比 ${products.length} 款产品：${products.map(p => `${String(p.name)}（R${String(p.risk)}）`).join('、')}。底层资产（合成数据）——${held}。这只是同口径对比，不构成买卖建议。`;
  }
  if (functionId === 'BI06' && typeof object(result.summary).netExpenses === 'number') {
    // “花超了吗”: this month, the same days of last month, the difference, and whether a budget exists.
    const now = object(result.summary), was = object(result.comparison), change = Number(was.changeAmount);
    const transfers = (Array.isArray(result.categoryBreakdown) ? result.categoryBreakdown.map(object) : []).find(row => row.category === '转账');
    const month = /^\d{4}-\d{2}$/.test(String(result.period)) ? `${Number(String(result.period).slice(5))}月` : `${String(result.period || '')}年`;
    const compare = typeof was.baselineNetExpenses === 'number' ? `；${was.sameDays ? `上月同期（${was.sameDays}）` : '上月'}${yuan(was.baselineNetExpenses)}，${change > 0 ? `多花了 ${yuan(change)}` : change < 0 ? `少花了 ${yuan(-change)}` : '持平'}` : `；${String(was.unavailableReason || '没有上月数据可比')}`;
    const share = transfers && Number(transfers.grossExpenses) ? `其中转给别人 ${yuan(Number(transfers.grossExpenses))}，不完全是消费。` : '';
    return `${month}${was.sameDays ? '到目前' : ''}净支出 ${yuan(now.netExpenses)}${compare}。${share}${result.hasBudget ? '' : '你还没有设预算，所以只能和上月比；需要的话可以设一个月度预算。'}`;
  }
  if (functionId === 'IN03' && typeof result.target === 'number') {
    const plan = object(result.projection), done = `${String(result.name || '目标')}已存 ${yuan(result.balance)}，目标 ${yuan(result.target)}，还差 ${yuan(result.remaining)}。`;
    if (plan.available && Number(plan.months) > 0) {
      const reach = String(plan.reachBy), deadline = typeof result.deadline === 'string' ? result.deadline.slice(0, 7) : '';
      const late = deadline && `${reach}-28` > String(result.deadline) ? `比截止日期 ${result.deadline} 晚，想按时攒够需要每月多存一些。` : deadline ? `能赶在截止日期 ${result.deadline} 之前。` : '';
      return `${done}${String(plan.basis)}约 ${yuan(plan.monthly)}，如果结余都存进目标，大约 ${plan.months} 个月后（${reach.slice(0, 4)}年${Number(reach.slice(5))}月）能攒够，${late}这是按过去记录的估算，不是承诺。`;
    }
    return done + (plan.reason ? String(plan.reason) : '');
  }
  if (functionId === 'SU05') {
    // “刚才取消了吗”: the bank mandate's state, and what is still the provider's to do.
    const sub = object(result.subscription), name = String(sub.name || '这项订阅'), pending = (Array.isArray(result.cancellations) ? result.cancellations.map(object) : []).some(c => c.status === 'external_pending');
    if (sub.status === 'cancelled') return `${name}的银行代扣已经解除，后续续费已停止，以后不会再从银行扣款${sub.benefitUntil ? `；本期权益到 ${sub.benefitUntil}` : ''}。以前的扣款不会退还。`;
    if (sub.cancellationPending) return `${name}的取消请求已经提交，结果还在等待核对；结果回来前续费仍可能发生。`;
    if (pending) return `${name}需要你在服务方平台完成取消，银行这边还看不到结果，续费仍可能发生。`;
    return `${name}的代扣还在生效，没有取消记录。需要的话可以现在办理。`;
  }
  return '';
}

export function readSummary(functionId: string, result: unknown): string {
  if (result && typeof result === 'object' && !Array.isArray(result)) return recordSummary(functionId, result as Record<string, unknown>);
  if (!Array.isArray(result)) return '';
  const list = result.map(row => (row && typeof row === 'object' ? row : {}) as Record<string, unknown>);
  switch (functionId) {
    case 'TR02': return list.map(row => `${row.name}余额 ${yuan(row.balance)}${typeof row.available === 'number' ? `，可用 ${yuan(row.available)}` : ''}`).join('；') + '。';
    case 'TR01': return `共 ${list.length} 个账户：${list.map(row => `${row.name}（尾号${row.tail}）`).join('、')}。`;
    case 'CA01': return `共 ${list.length} 张银行卡：${list.map(row => `${row.name}${row.tail ? `（${row.tail}）` : ''}${CARD_STATUS[String(row.status)] || ''}`).join('，')}。`;
    case 'SU01': {
      if (!list.length) return '没有查到订阅。';
      const active = list.filter(row => row.status === 'active'), monthly = active.filter(row => row.cycle === 'monthly').reduce((sum, row) => sum + (Number(row.amount) || 0), 0), stopped = list.length - active.length;
      return `生效中的订阅有 ${active.length} 项，每月固定支出 ${yuan(monthly)}${stopped ? `；另有 ${stopped} 项已解除` : ''}。`;
    }
    case 'IN06': if (list.length === 1 && underlying(list[0])) return `${list[0].name}（R${list[0].risk}）的底层资产（合成数据）：${underlying(list[0])}。底层资产说明钱投向哪里，不代表收益或保本。`;
      return list.length ? `共 ${list.length} 款产品：${list.map(row => `${row.name}${row.risk != null ? `（R${row.risk}）` : ''}`).join('、')}。` : '没有符合条件的产品。';
    case 'TR06': {
      if (!list.length) return '这个范围里没有转账记录。';
      const top = list.slice(0, 3).map(row => `${String(row.createdAt || '').slice(5, 10)} 给${String(row.recipient || '收款人')}转了 ${yuan(row.amount)}`).join('，');
      return `找到 ${list.length} 笔转账：${top}${list.length > 3 ? ' 等' : ''}。`;
    }
    case 'IN10': return list.length ? `你持有 ${list.length} 项理财：${list.map(row => `${row.name} ${yuan(row.value)}`).join('、')}。` : '目前没有理财持仓。';
  }
  return '';
}
