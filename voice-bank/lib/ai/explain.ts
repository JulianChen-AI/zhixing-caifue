// On-demand “AI 讲解” for read-only cards. The model only explains numbers already on the card; an answer that brings in
// any other number, or tells the user to buy, sell or hold, is dropped. It never starts or changes a business.

/** Cards that get the button, with what to focus on. */
export const EXPLAINABLE: Record<string, string> = {
 IN16: '讲清每项持仓赚亏从哪来、持有多久，最后提一个值得想的问题',
 IN10: '讲清持仓整体情况和各项占比',
 IN06: '用大白话解释产品的风险等级、底层资产、赎回到账这些术语',
 IN07: '讲清这几只产品最主要的差别（风险、费用、到账）',
 BI02: '找出这段时间花钱的规律和最大的几项',
 BI06: '总结这个月花钱的规律和异常，给一句提醒',
 BI04: '讲清哪笔扣款可疑、为什么、可以怎么处理',
 SU08: '讲清接下来哪些扣款要留意、一共多少',
 IN03: '讲清离目标还差多少、按现在节奏大概要多久',
};

export const canExplain = (functionId: string) => functionId in EXPLAINABLE;

const SYSTEM = `你是银行App里的讲解员，面向大学生。根据卡片数据用口语讲解，3句以内、不超过120字。
金额字段单位是分，说的时候换成元。只能使用数据里已有的数字，不要算新数字、不要预测收益。
不给买入、卖出、加仓、赎回或继续持有的建议，不发起任何办理。直接输出讲解文字。`;

const numbers = (text: string) => (text.replace(/(\d),(?=\d{3})/g, '$1').match(/\d+(?:\.\d+)?/g) || []).map(Number);
const BANNED = /建议(?:你)?(?:继续|先|现在)?(?:买|卖|赎回|加仓|减仓|持有|入手)|赶紧(?:买|卖)|保证收益|稳赚|一定(?:会)?(?:涨|赚)|预计(?:收益|能赚)/;

/** Every number the card holds, also as yuan (from cents) and as a percentage (from a rate). */
export function allowedNumbers(value: unknown) {
 const allowed = new Set<number>();
 for (const n of numbers(JSON.stringify(value ?? null))) {
  for (const v of [n, n / 100, n * 100, Math.round(n / 100), Math.abs(n), Math.abs(n) / 100]) allowed.add(Math.round(v * 100) / 100);
 }
 for (let i = 0; i <= 12; i++) allowed.add(i); // counts like “两笔”“3项”
 return allowed;
}

/** Null when the answer is unusable: empty, gives advice, or uses a number that is not on the card. */
export function checkedAnswer(answer: string, value: unknown): string | null {
 const text = answer.trim().replace(/^["“]|["”]$/g, '');
 if (!text || text.length > 260 || BANNED.test(text)) return null;
 const allowed = allowedNumbers(value);
 return numbers(text).every(n => allowed.has(Math.round(n * 100) / 100)) ? text : null;
}

type Provider = { base: string; key?: string; planner: string };
export async function explainCard(functionId: string, value: unknown, provider: Provider, signal: AbortSignal, request: typeof fetch = fetch) {
 const focus = EXPLAINABLE[functionId];
 if (!focus) throw new Error('这张卡片暂不支持讲解。');
 const response = await request(`${provider.base}/compatible-mode/v1/chat/completions`, {
  method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
  headers: { Authorization: `Bearer ${provider.key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: provider.planner, enable_thinking: false, max_tokens: 300, temperature: 0.3,
   messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: `重点：${focus}\n卡片数据：${JSON.stringify(value)}` }] }),
 });
 if (!response.ok) throw new Error(`讲解模型暂时不可用（${response.status}）。`);
 const data = await response.json() as { choices?: { message?: { content?: string } }[] };
 return checkedAnswer(data.choices?.[0]?.message?.content || '', value);
}
