/** Conservative phrase combinations, not a verdict of fraud or a safety score.
 * Non-matches never mean safe. No rule may clear an earlier risk signal.
 */
export function fraudSignals(text: string): string[] {
  const raw = text.normalize('NFKC').replace(/\s+/g, ''), signals = new Set(raw.match(/刷单|解冻费|安全账户|保证金|跑分|兼职返利|洗钱|涉嫌|配合调查|公检法|网恋|网上认识|才能见面/g) || []);
  const has = (pattern: RegExp) => pattern.test(raw);
  if (has(/公安|警察|公检法|检察院|法院|涉嫌洗钱|配合调查/) && has(/转账|转到|转钱|指定账户|资金核查|资金审查/)) signals.add('疑似冒充公检法转账话术');
  if (has(/冻结|解冻|解除|解封/) && has(/先交|先付|缴费|费用|手续费|转钱|转账/)) signals.add('疑似先付费解冻话术');
  if (has(/垫付|垫资|做任务|刷销量|刷信誉/) && has(/返佣|返利|佣金|回款/)) signals.add('疑似垫资返佣话术');
  if (has(/保本|稳赚|无风险|高收益|内幕/) && has(/转钱|转账|平台|群|老师|投资/)) signals.add('疑似保本高收益诱导');
  if (has(/退款|退费|理赔|客服/) && has(/先转|先付|验证资金|验证金|认证金/)) signals.add('疑似退款前置转款话术');
  if (has(/屏幕共享|共享屏幕|远程控制/) && has(/转钱|转账|验证|账户/)) signals.add('疑似共享屏幕资金核验');
  if (has(/监管账户|监管帐户|资金核验|资金核查/) && has(/转|汇|打款|充值|原路退回/)) signals.add('疑似监管账户核验话术');
  if (has(/原路退回|原路退还/) && has(/先转|先付|打款|充值|核验|验证/)) signals.add('疑似先转款再返还话术');
  return [...signals];
}
export const mergeFraudSignals = (previous: readonly string[], ...texts: string[]) => [...new Set([...previous, ...texts.flatMap(fraudSignals)])];
