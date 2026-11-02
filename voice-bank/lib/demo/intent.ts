// Local stand-in for the model's intent/draft layer in the demo. It only turns an utterance
// into a structured draft; it has no authority over money and never confirms anything.

const DIGITS: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000 };

/** Parses Arabic or simple Chinese numerals ("120", "一百二十", "六"). */
export function parseNumber(text: string): number | null {
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
  let total = 0, section = 0, digit = 0, seen = false;
  for (const ch of text) {
    if (ch in DIGITS) { digit = DIGITS[ch]; seen = true; continue; }
    const unit = UNITS[ch];
    if (!unit) return null;
    seen = true;
    if (unit === 10000) { total += (section + digit) * unit; section = 0; }
    else section += (digit || 1) * unit;
    digit = 0;
  }
  return seen ? total + section + digit : null;
}

const NUM = '(\\d+(?:\\.\\d+)?|[零〇一二两三四五六七八九十百千万]+)';
const toFen = (text: string) => { const n = parseNumber(text); return n === null ? null : Math.round(n * 100); };

export type TransferDraft = { intent: 'transfer'; payee_name: string; amount_fen: number; purpose: string };
export function parseTransfer(utterance: string): TransferDraft | null {
  const m = utterance.match(new RegExp(`给(.{1,4}?)转(?:账)?${NUM}(?:元|块)?[，,。 ]*(?:昨天|今天)?(.*?)[。.]?$`));
  if (!m) return null;
  const amount_fen = toFen(m[2]);
  if (!amount_fen) return null;
  return { intent: 'transfer', payee_name: m[1], amount_fen, purpose: m[3].trim() };
}

export type AaDraft = { intent: 'aa'; version: number; total_fen: number; people: number; items: { name: string; amount_fen: number; participants: string[] | 'ALL' }[] };
/** Returns every draft version the utterance implies; a correction ("等等") supersedes the earlier one. */
export function parseAa(utterance: string): AaDraft[] {
  const head = utterance.match(new RegExp(`${NUM}元?(?:的)?(饭钱|餐费|聚餐).*?${NUM}个人\\s*AA`));
  if (!head) return [];
  const total_fen = toFen(head[1])!, people = parseNumber(head[3])!;
  const drafts: AaDraft[] = [{ intent: 'aa', version: 1, total_fen, people, items: [{ name: '餐费', amount_fen: total_fen, participants: 'ALL' }] }];
  const fix = utterance.match(new RegExp(`(?:等等|不对)[，, ]*${NUM}元?(饮料|酒水|甜品)只有(.+?)(?:喝了|吃了|点了)`));
  if (fix) {
    const part = toFen(fix[1])!;
    const names = fix[3].split(/[、,，和]/).map(s => s.trim()).filter(Boolean);
    drafts.push({ intent: 'aa', version: 2, total_fen, people, items: [
      { name: '餐费', amount_fen: total_fen - part, participants: 'ALL' },
      { name: fix[2], amount_fen: part, participants: names },
    ] });
  }
  return drafts;
}

export type PaydayDraft = { intent: 'payday_plan'; extra_budget: { name: string; amount_fen: number } | null };
export function parsePayday(utterance: string): PaydayDraft | null {
  if (!/工资到了/.test(utterance) || !/安排/.test(utterance)) return null;
  const m = utterance.match(new RegExp(`留${NUM}(?:元)?(?:请)?(.+?)(?:吃饭|聚餐)`));
  return { intent: 'payday_plan', extra_budget: m ? { name: '家庭聚餐', amount_fen: toFen(m[1])! } : null };
}

export type GoalRuleDraft = { intent: 'goal_rule'; amount_fen: number; times: number; to: 'SELF_SAME_NAME' };
export function parseGoalRule(utterance: string): GoalRuleDraft | null {
  const m = utterance.match(new RegExp(`每月.*?存${NUM}(?:元)?到本人同名.*?连续${NUM}个月`));
  if (!m) return null;
  return { intent: 'goal_rule', amount_fen: toFen(m[1])!, times: parseNumber(m[2])!, to: 'SELF_SAME_NAME' };
}

export type InvestLearnDraft = { intent: 'invest_learn'; amount_fen: number; wants_risk_first: boolean };
export function parseInvestLearn(utterance: string): InvestLearnDraft | null {
  const m = utterance.match(new RegExp(`拿${NUM}(?:元)?了解理财`));
  if (!m) return null;
  return { intent: 'invest_learn', amount_fen: toFen(m[1])!, wants_risk_first: /怎么亏|风险/.test(utterance) };
}

/** Speech that only expresses agreement. It is logged as intent and never authorizes a write. */
export const isVerbalConfirm = (utterance: string) => /^(对|好|嗯|是)?[，, ]*(确认|可以|行|好的?)(转账)?[。！!]?$/.test(utterance.trim()) || /^对，确认。?$/.test(utterance.trim());
