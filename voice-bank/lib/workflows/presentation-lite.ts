import { businessNow } from '../demo/clock.ts';
import type { BankState } from '../bank/types.ts';
import type { Params, Row } from './types.ts';

const feeNames = ['申购费', '赎回费', '管理费', '托管费'] as const;

/** A zero synthetic transaction rate is known for this sandbox only; ongoing fees remain unknown. */
export function productDetail(product: Row): Row {
 const knownSyntheticZero = product.synthetic === true && product.feeRate === 0;
 return {
  ...product,
  fees: feeNames.map((name, index) => ({
   name,
   rate: index < 2 && knownSyntheticZero ? 0 : null,
   basis: index < 2 && knownSyntheticZero ? '当前合成交易费率为0；不代表真实产品费率' : '当前数据未提供',
  })),
  worstCase: '可能发生本金损失；当前合成数据未提供或保证最大亏损上限。',
  riskNotice: '历史表现不代表未来；产品信息为合成演示数据，不构成真实产品风险揭示。',
 };
}

const present = (value: unknown) => value !== null && value !== undefined && value !== '';

export function compareProducts(products: Row[]): object {
 const details = products.map(productDetail);
 const fields = [
  { field: 'risk', label: '风险等级', read: (product: Row) => product.risk },
  { field: 'liquidity', label: '流动性', read: (product: Row) => product.liquidity },
  { field: 'fee', label: '当前合成交易费率', read: (product: Row) => product.synthetic === true && typeof product.feeRate === 'number' ? product.feeRate : null },
 ];
 const differences: { field: string; label: string; values: { productId: string; productName: unknown; reading: unknown }[] }[] = [];
 const missing: { field: string; productId: string; productName: unknown; label: string; reason: string }[] = [];

 for (const { field, label, read } of fields) {
  const values = products.map(product => ({ productId: product.id, productName: product.name, reading: read(product) }));
  for (const item of values) if (!present(item.reading)) missing.push({ field, productId: item.productId, productName: item.productName, label, reason: '当前产品数据未提供，不能按0处理。' });
  const known = values.filter(item => present(item.reading)).map(item => JSON.stringify(item.reading));
  if (new Set(known).size > 1) differences.push({ field, label, values });
 }

 for (const product of products) {
  const fees = productDetail(product).fees as { name: string; rate: number | null }[];
  fees.forEach((fee, index) => {
   if (fee.rate === null) missing.push({
    field: ['subscriptionFee','redemptionFee','managementFee','custodyFee'][index],
    productId: product.id,
    productName: product.name,
    label: fee.name,
    reason: '当前数据未提供。',
   });
  });
 }

 return { products: details, comparedFields: fields.map(({ field, label }) => ({ field, label })), differences, missing };
}

function nextBeijingBusinessDay(now = new Date()): string {
 const parts = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
 }).formatToParts(now);
 const part = (type: string) => parts.find(item => item.type === type)?.value || '';
 const day = new Date(Date.UTC(Number(part('year')), Number(part('month')) - 1, Number(part('day'))));
 do day.setUTCDate(day.getUTCDate() + 1); while (day.getUTCDay() === 0 || day.getUTCDay() === 6);
 return day.toISOString().slice(0, 10);
}

export function redemptionQuote(state: BankState, params: Params): object {
 const records = state.workflows?.records || {};
 const holding = (records.holdings || []).find(row => row.id === params.holdingId);
 const product = (records.products || []).find(row => row.id === holding?.productId);
 const yuan = Number(params.amount);
 const amount = Number.isFinite(yuan) && yuan > 0 && Math.abs(yuan * 100 - Math.round(yuan * 100)) < 1e-7
  ? Math.round(yuan * 100)
  : null;
 const fee = product?.synthetic === true && product.feeRate === 0 ? 0 : null;
 return {
  amount,
  fee,
  netAmount: amount === null || fee === null ? null : amount - fee,
  estimatedArrivalAt: nextBeijingBusinessDay(new Date(businessNow(state))),
  calendarNotice: '按北京时间估算T+1工作日；仅跳过周末，未接入法定节假日日历。此日期仅为预估，沙箱资金需手动推进结算，尚未到账。',
  feeNotice: fee === null ? '当前赎回费用未知，净额不能据此确定。' : '仅当前合成交易费率为0；不代表真实产品费率。',
 };
}

type ApplicationPath = { id: 'debit' | 'credit' | 'virtual'; name: string; use: string; status: string; nextStep: string };
const applicationPaths: ApplicationPath[] = [
 { id: 'debit', name: '借记卡', use: '存取款、日常支付等借记账户用途', status: '仅提供官方办理指引', nextStep: '通过发卡机构官方渠道核对产品和申请条件。' },
 { id: 'credit', name: '信用卡', use: '授信消费及账单还款', status: '仅提供官方办理指引', nextStep: '通过发卡机构官方渠道了解申请条件、费用和还款责任；审批结果未知。' },
 { id: 'virtual', name: '虚拟卡', use: '线上支付等虚拟卡用途', status: '未接入', nextStep: '当前没有虚拟卡申请或发卡能力。' },
];

export function cardApplicationGuide(params: Params): object {
 const purpose = String(params.purpose || '').trim();
 const matched = new Set<ApplicationPath['id']>();
 if (/借记卡|储蓄卡|借记账户|工资|存取|日常支付|日常消费/.test(purpose)) matched.add('debit');
 if (/信用卡|信用额度|授信|透支/.test(purpose)) matched.add('credit');
 if (/虚拟卡|线上订阅/.test(purpose)) matched.add('virtual');
 const recommendedPaths = matched.size ? [...matched] : applicationPaths.map(path => path.id);
 return {
  purpose: purpose || null,
  recommendedPath: recommendedPaths.length === 1 ? recommendedPaths[0] : null,
  recommendedPaths,
  paths: applicationPaths,
  readOnly: true,
  notice: '本结果仅按明确用途给出只读办理路径，不创建申请、不代表审批；未明确卡种时列出多条路径，不猜测。虚拟卡能力未接入。',
 };
}

export function judicialGuide(card: Row): object {
 if(card.restriction!=='judicial')return {card,canSelfUnlock:card.restriction==='risk'&&card.status!=='lost',guide:card.restriction==='risk'?'保护性风控限制可选择申请解除，按原流程核验；不代表已解锁。':'当前不是司法限制；无需司法处置材料，状态以卡片记录为准。'};
 return {
  card,
  canSelfUnlock: false,
  materials: ['本人身份证明（按官方要求准备，不在对话中上传）', '受限卡片线索（如尾号，向官方渠道核实）', '相关官方文书或案件编号（按要求准备，不在对话中上传）'],
  officialSteps: [
   '联系发卡机构官方客服或网点，核实限制机关、事项及受理渠道。',
   '按官方要求向发卡机构或作出限制的机关提交材料；不要在对话中上传身份证、完整卡号或文书。',
   '取得官方处理结果后，再向发卡机构核实卡片状态。',
  ],
  notice: '司法限制不能通过本沙箱自助解除；处理期限以官方说明为准，本指引不承诺期限。',
 };
}

function recordOf(value: unknown): Record<string, unknown> {
 return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : { value };
}

export function transferView(receipt: unknown): object {
 return {
  ...recordOf(receipt),
  executionState: 'transferred',
  executionNotice: '已在当前会话沙箱扣款并生成回执；仅代表本地演示数据，不代表真实银行系统入账。',
 };
}

export function ruleView(rule: Row): object {
 return {
  ...rule,
  executionState: 'scheduled_not_connected',
  executionNotice: '周期规则仅保存在沙箱；自动调度未接入，不会因保存本规则而自动扣款或转账。',
 };
}

export function orderView(order: Row): Row {
 const action = order.action;
 const status = order.status;
 const businessStage = status === 'cancelled'
  ? 'cancelled'
  : status === 'pending'
   ? 'accepted'
   : status === 'settled' && action === 'subscribe'
    ? 'shares_confirmed'
    : status === 'settled' && action === 'redeem'
     ? 'funds_arrived'
     : 'unknown';
 return { ...order, businessStage };
}

export function subscriptionView(subscription: Row): object {
 if (subscription.channel === 'platform') {
  return { bankAgreementState: 'unknown', merchantSubscriptionState: 'unverified', chargeState: 'unknown' };
 }
 if (subscription.channel === 'bank' && subscription.status === 'cancelled') {
  return { bankAgreementState: 'cancelled', merchantSubscriptionState: 'unknown', chargeState: 'bank_mandate_stopped' };
 }
 return {
  bankAgreementState: subscription.channel === 'bank' && subscription.status === 'active' ? 'active' : 'unknown',
  merchantSubscriptionState: 'unknown',
  chargeState: 'unknown',
 };
}

export function lossView(card: Row): object {
 return {
  ...card,
  responsibilityNotice: '此处只记录本沙箱挂失状态；真实交易责任及是否赔付需按官方规则核实，不承诺赔付。',
  nextActions: [
   '尽快通过发卡机构官方渠道核实挂失状态及争议交易处理方式。',
   '本人核对近期交易并保留回执和相关材料；不要在对话中提交密码、验证码或完整卡号。',
   '补卡和第三方换绑分别按发卡机构及服务商官方流程办理；本沙箱不自动迁移绑定。',
  ],
 };
}
