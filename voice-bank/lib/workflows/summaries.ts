/** One sentence that answers a read in words, so chat and speech say the result instead of “结果已显示”. Amounts are cents. */
const yuan = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
  ? `¥${(value / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '';
const CARD_STATUS: Record<string, string> = { active: '正常', frozen: '临时冻结中', lost: '已挂失', restricted: '受限' };

export function readSummary(functionId: string, result: unknown): string {
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
    case 'IN06': return list.length ? `共 ${list.length} 款产品：${list.map(row => `${row.name}${row.risk != null ? `（R${row.risk}）` : ''}`).join('、')}。` : '没有符合条件的产品。';
    case 'TR06': {
      if (!list.length) return '这个范围里没有转账记录。';
      const top = list.slice(0, 3).map(row => `${String(row.createdAt || '').slice(5, 10)} 给${String(row.recipient || '收款人')}转了 ${yuan(row.amount)}`).join('，');
      return `找到 ${list.length} 笔转账：${top}${list.length > 3 ? ' 等' : ''}。`;
    }
    case 'IN10': return list.length ? `你持有 ${list.length} 项理财：${list.map(row => `${row.name} ${yuan(row.value)}`).join('、')}。` : '目前没有理财持仓。';
  }
  return '';
}
