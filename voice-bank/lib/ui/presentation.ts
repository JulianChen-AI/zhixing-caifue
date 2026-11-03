import type { BankState } from '../bank/types.ts';
import type { FlowTask } from '../workflows/types.ts';

/** Public wording only. Raw tool messages and execution state stay unchanged. */
export function userMessage(message: string): string {
  if (!message) return '';
  if (/命中转账风险信号|升级核验尚未接入/.test(message)) return '这笔转账存在风险，暂时无法继续。请核对收款信息。';
  if (/请明确要取消哪项任务/.test(message)) return '请指定要取消的业务，或说“取消全部剩余任务”。';
  if (/成员称呼没听清|AA参与者必须|AA参与者只能/.test(message)) return '没有听清成员姓名，请再说一次，或在卡片中填写。';
  if (/复杂非均分/.test(message)) return '暂不支持非均分，请选择均分。';
  if (/利率试算工具/.test(message)) return '目前可以试算本金，暂不支持利息试算。';
  if (/采用稿未规定/.test(message)) return '仅支持撤销北京时间当日创建、尚未确认的申购订单，截止当日 24:00。';
  if (/模型不能代填|信息已经确认，请在卡片完成演示认证/.test(message)) return '请输入验证码。';
  if (/设备\/外部通道适配器|查询适配器|写操作适配器/.test(message)) return '暂不支持这项业务。';
  if (/API Key|业务空间|模型权限|Qwen.*(?:连接失败|尚未配置)|语音连接信息无效/.test(message)) return '语音暂不可用，可以使用文字输入。';
  if (/中文女声|Tina 音色|缓存语音|声音暂时无法缓存/.test(message)) return '暂时无法播放声音，文字结果仍可查看。';
  if (/只读结果播报|后台最新进度已显示|后台进度已显示/.test(message)) return '语音已中断，当前结果已保留。';
  if (/复核|旧回复|未经核实的回复|这轮回复尚未核实|本轮模型未及时/.test(message)) return '暂时无法回复，请查看当前业务进度。';
  if (/请求超时|结果尚未确认|未确认成功|不要重复提交/.test(message)) return '暂时未能确认结果，请查看当前业务进度。';
  if (/外层步骤尚未/.test(message)) return '任务清单已暂停，点“继续办理”后再处理这一步。';
  if (/当前外层步骤/.test(message)) return '请先处理清单里当前这一步，前面的步骤办完才会轮到它。';
  if (/白名单|字符串数组|布尔值|JSON|参数格式|不支持的参数|数值字段格式/.test(message)) return '请检查当前业务的信息后重试。';
  if (/随会话状态和 revision|本次参数或路径未触发/.test(message)) return '';
  return message;
}

const amount = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
  ? `¥${(value / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '';
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** The card title names the task; controls and fields explain the current step. */
export function businessTitle(functionId: string, fallback: string): string {
  const titles: Record<string, string> = {
    TR01: '账户', TR02: '账户余额', TR03: '转账', BI01: '账单明细', BI02: '收支统计',
    BI06: '收支报告', SU01: '订阅', SU08: '扣款日历', IN06: '理财产品', IN07: '产品对比', CA01: '银行卡',
  };
  return titles[functionId] || fallback.replace(/^查询(?![和及与])/, '');
}

export function workflowMessage(task: FlowTask): string {
  if (task.status === 'review') {
    if (task.functionId === 'SU04') return '停止银行代扣后，商户订阅和退款需另行处理。';
    if (task.functionId === 'CA07') return '挂失后旧卡将无法恢复。';
    return '';
  }
  if (task.status === 'authenticate') return '';
  if (task.status === 'cancelled') return '这项业务没有提交，已放下；没有扣款或改动。';
  if (task.status === 'queued') return '等待前面的业务完成。';
  if (task.status === 'unsupported') return '暂不支持这项业务。';
  if (task.status === 'external') return '请到服务商的订阅管理页面关闭续费。';
  if (task.status !== 'complete') return userMessage(task.message);

  const result = object(task.result);
  const list = Array.isArray(task.result) ? task.result.map(object) : [];
  if (task.functionId === 'TR02') return list.length ? list.map(row => `${row.name}余额 ${amount(row.balance)}${typeof row.available === 'number' ? `，其中 ${amount(row.held)} 已被理财申购占用，可用 ${amount(row.available)}` : ''}`).join('；') + '。' : '没有查到可用账户。';
  if (task.functionId === 'TR01') return `共 ${list.length} 个账户。`;
  if (task.functionId === 'CA01') return `共 ${list.length} 张银行卡。`;
  if (task.functionId === 'SU01') return list.length ? `共 ${list.length} 项订阅。` : '没有查到订阅。';
  if (task.functionId === 'IN06') return list.length ? `共 ${list.length} 款产品。` : '没有符合条件的产品。';
  if (['BI01', 'BI02', 'BI06'].includes(task.functionId)) {
    const summary = object(result.summary || result.current);
    const guessed = Array.isArray(result.transactions) ? result.transactions.map(object).filter(row => row.kind === 'expense' && row.classificationSource !== 'user-confirmed').length : 0;
    if (typeof summary.netExpenses === 'number') return `净支出 ${amount(summary.netExpenses)}，退款 ${amount(summary.refunds)}。${guessed ? '类别是按已授权流水的商户推断的，不代表实际商品，也不含未接入的平台。你可以看明细或纠正分类。' : ''}`;
  }
  if (task.functionId === 'IN05') {
    if (result.assessmentState === 'not_found') return '你还没有完成风险测评。';
    if (result.assessmentState === 'expired') return '风险测评已过期。';
    const profile = object(result.profile || result);
    if (typeof profile.level === 'number') return `风险测评等级：${profile.level} 级。`;
  }
  if (task.functionId === 'IN08' && result.status === 'pending') return `申购已受理：${amount(result.amount)} 已占用、尚未扣款，等待份额确认。`;
  if (task.functionId === 'IN09' && result.status === 'pending') return '赎回已受理，资金尚未到账。';
  if (task.functionId === 'IN12' && result.status === 'cancelled') return '订单已撤销。';
  if (task.functionId === 'CA06') return result.status === 'frozen' ? '银行卡已冻结。' : result.status === 'active' ? '银行卡已解冻。' : '';
  if (task.functionId === 'CA07' && result.status === 'lost') return '银行卡已挂失。';
  if (task.functionId === 'IN01') return '储蓄目标已创建。';
  if (task.functionId === 'IN02' && typeof result.moved === 'number') return `${amount(result.moved)} 已${result.direction === 'deposit' ? '存入目标' : '转回账户'}。`;
  if (task.functionId === 'TR05' && result.status === 'awaiting_participants') return 'AA 收款单已创建，等待参与者确认。';
  if (task.functionId === 'TR05' && Array.isArray(result.reminders)) return `已通过模拟通道发送 ${result.reminders.length} 条私密提醒（演示，不是真实消息），收款进度不变。`;
  if (task.functionId === 'TR03' && typeof result.amount === 'number') return `${amount(result.amount)} 已转出。`;
  if (task.functionId === 'SU04' && result.status === 'bank_cancelled') { const sub = object(result.subscription); return `${String(sub.name || '该服务')}后续续费已停止；以前的扣款不退还${sub.benefitUntil ? `，本期权益到 ${String(sub.benefitUntil)}` : ''}。`; }
  if (task.functionId === 'SU04' && result.status === 'pending') return String(result.notice || '取消请求已提交，结果待核对。');
  if (task.functionId === 'SU06') return '银行代扣已恢复。';
  if (result.status === 'received' || result.status === 'supplement_received') return '申请已收件，等待审核。';
  if (result.status === 'requested') return '申请已提交。';
  if (['TR04', 'IN13'].includes(task.functionId) && !Array.isArray(task.result)) {
    if (result.status === 'cancelled') return '规则已删除。';
    if (result.status === 'paused') return '规则已暂停。';
    return '规则已保存，自动执行尚未启用。';
  }
  if (/^查询完成，结果来自当前合成演示数据。/.test(task.message)) return '';
  if (/^已完成当前沙箱操作。/.test(task.message)) return '已保存。';
  return userMessage(task.message).replace(/ 部分附加请求尚未完成[\s\S]*$/, '');
}

export function replyForState(state: BankState): string {
  // A query a checklist finished on the way to the next card is said first; otherwise its result never reaches the chat.
  const said = checklistResults(state), reply = currentReply(state);
  return said && !reply.startsWith(said) ? said + reply : reply;
}
/** Results of queries the checklist finished on the way to the current card, in the words the chat shows. */
export const checklistResults = (state: BankState) => (state.plan?.announcements || []).filter(line => /”：/.test(line)).map(line => userMessage(line)).join('');
function currentReply(state: BankState): string {
  if (state.sayOnly) return userMessage(state.sayOnly);
  const task = state.view === 'workflow' ? state.workflows?.tasks.find(item => item.id === state.workflows?.currentTaskId) : undefined;
  if (task) {
    const message = workflowMessage(task);
    if (message) return message;
    if (task.status === 'review') return '请核对本次办理信息。';
    if (task.status === 'authenticate') return '请输入验证码。';
    if (task.status === 'complete') return '结果已显示。';
  }
  if (state.view === 'balance') return state.accounts.map(account => `${account.name}余额 ${amount(account.balance)}${account.held ? `，可用 ${amount(account.balance - account.held)}` : ''}`).join('；') + '。';
  return userMessage(state.lastReply);
}

/** The card already carries routine prompts; additional explanations remain available. */
export function cardCaption(state: BankState | null, text: string) {
  if (!text || /^(?:请核对本次办理信息。|请输入验证码。|结果已显示。)$/.test(text)) return '';
  const task = state?.view === 'workflow' ? state.workflows?.tasks.find(item => item.id === state.workflows?.currentTaskId) : undefined;
  if (task && text === workflowMessage(task)) return '';
  return text;
}

/** Fields requiring unavailable services are not offered as usable controls. */
export const unavailableFields = new Set([
  'receiptExport', 'peerComparison', 'share', 'includeSafetyHistory', 'verifyReminder', 'evidenceExport',
  'prepareEvidence', 'includeProjection', 'reserveReminder', 'expiryReminder', 'interestAssumption',
  'adjustments', 'reminder', 'narrative', 'cashOrNet', 'includeProjected', 'autoSave', 'accountType',
]);

export const fieldLabels: Record<string, string> = {
  accountType: '账户类型', status: '状态', merchant: '商户', type: '产品类型', source: '导入来源', file: '文件',
  applicationId: '申请记录', replacementId: '补卡申请', relatedTransactionId: '关联交易',
  ledgerId: '账本', members: '成员', choice: '选项', note: '备注',
};

export function resultMessage(field: string, text: string): string {
  if (field === 'liquidity' && /沙箱手动推进/.test(text)) return '赎回预计 T+1 工作日到账，演示订单需手动结算。';
  if (field === 'calendarNotice') return '预计到账日未计入法定节假日，实际到账以订单状态为准。';
  if (field === 'executionNotice' || field === 'execution') {
    if (/自动|调度/.test(text)) return '规则已保存，自动执行尚未启用。';
    if (/已在当前会话沙箱扣款/.test(text)) return '';
  }
  if (field === 'delivery') return '提醒已保存，暂不支持外部推送。';
  if (field === 'riskNotice') return '历史表现不代表未来。';
  if (field === 'worstCase') return '可能发生本金损失。';
  if (field === 'feeNotice') return /费用未知/.test(text) ? '赎回费用尚未确定。' : '';
  if (field === 'notice') {
    if (/只读办理路径/.test(text)) return '';
    if (/仅反映当前沙箱会话|仅为沙箱问卷评分|合成产品和费用|不承诺掌握完整第三方/.test(text)) return '';
    if (/自动扣款调度/.test(text)) return '自动转存尚未启用。';
    if (/沙箱收件/.test(text)) return '申请已收件，等待审核。';
    if (/未自动登录、未取消、未核验/.test(text)) return '完成后请在服务商页面核对订阅状态。';
    if (/司法限制不能通过本沙箱/.test(text)) return '司法限制需通过发卡机构处理。';
    if (/旧演示卡已正式挂失/.test(text)) return '旧卡已挂失，第三方绑定需分别更新。';
  }
  return userMessage(text);
}

