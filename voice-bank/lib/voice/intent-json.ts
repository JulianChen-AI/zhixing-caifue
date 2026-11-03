// Intent and parameters come from one model call returning JSON (QWEN_INTENT=json). The deterministic layer
// only validates (function exists, fields allowed, ids exist, amounts positive) and never re-reads the
// utterance to second-guess them. Authorization stays rule-based: confirmation still needs the user's
// literal acknowledgement, and the engine's review → page authentication → receipt flow is unchanged.
import type { BankAction, BankState } from '../bank/types.ts';
import { contactsOf } from '../bank/recipients.ts';
import { FIELDS } from '../workflows/fields.ts';
import { ACTIONS } from '../workflows/adapters.ts';
import { explicitWorkflowConfirmation } from '../workflows/offline.ts';
import { FRAUD_WORDS } from '../workflows/engine.ts';
import { isMonthlyRequest, savedMonthlyPlans } from '../plans/monthly.ts';
import { businessDay } from '../demo/clock.ts';
import { bankToolResult } from '../bank/realtime-tools.ts';
import catalog from '../workflows/catalog-data.json' with { type: 'json' };

type Provider = { base: string; key?: string; planner: string };
type Step = { functionId: string; params?: Record<string, unknown>; quote?: string };
export type Intent = { intent: 'run' | 'amend' | 'confirm' | 'cancel' | 'plan' | 'open_saved' | 'resume' | 'ask' | 'chat'; functionId?: string; taskId?: string; params?: Record<string, unknown>; steps?: Step[]; say?: string };

// Field formats the bare names do not convey; the engine still enforces them.
const HINTS: Record<string, string> = {
 participants: '全部分摊人的称呼数组，含“我”；人数与用户所说不符或名字不全时不填',
 adjustments: '只由部分人分摊的项目：[{label,amount(元),participants}]',
 total: 'AA总额（元）', schedule: '周期原话，如“每月5日”', period: 'YYYY-MM或YYYY',
 direction: 'deposit（存入）或withdraw（取出）', notifyChannel: '只有in_app；用户没说就不填', channel: 'bank或platform', cycle: 'monthly或yearly',
};
const functions = (Array.isArray(catalog) ? catalog : (catalog as { functions: { id: string; title: string }[] }).functions)
 .map((f: { id: string; title: string }) => ({ id: f.id, title: f.title, fields: FIELDS[f.id] || [], ...(ACTIONS[f.id] ? { actions: ACTIONS[f.id] } : {}),
  ...((FIELDS[f.id] || []).some(k => HINTS[k]) ? { formats: Object.fromEntries((FIELDS[f.id] || []).filter(k => HINTS[k]).map(k => [k, HINTS[k]])) } : {}) }));

const SYSTEM = `你是知行银行的意图理解模块。读用户本轮原话和对话上下文，只输出一个JSON对象，不执行任何业务。
{"intent":"run|amend|confirm|cancel|plan|open_saved|resume|ask|chat","functionId":"功能编号","taskId":"要修改/确认/取消的任务id","params":{},"steps":[{"functionId":"","params":{},"quote":"对应原话片段"}],"say":"给用户的一句话"}
- run：新办一项业务或做一次查询（查询、统计、解释产品也用run）。amend：补充或修改当前任务的字段（回答追问、改口）。confirm：用户明确确认当前核对卡。cancel：用户明确说不办了，如“结束这个业务”“不弄了”“退出”“先这样吧”“放弃”；“停”“等一下”“别取消”“不要取消”“不是要结束”都不是cancel。同一句里放弃后又提了别的要求（“算了不转了，帮我查下余额”“不弄了，看看订阅”）用run办新要求，系统会先取消当前任务。当前任务被拦下（status=blocked）后用户问别的事，按新的问题处理，不要复述拦截说明。
- plan：一句话里有两项及以上业务（“到时候提醒我”“顺便列出…”也各算一项），按顺序放进steps（每项functionId+params+quote），不要只办第一项；各quote逐字摘自原话，按顺序首尾相接覆盖整句，不删不改。例如“冻结尾号8021的卡，退掉的会员费转进储蓄目标”是两项：CA06与IN02。
- 钱转进/存进自己的储蓄目标（如“转1000进旅游储蓄”）是IN02（单次）或IN04（已有目标的自动储蓄安排：action=update，goalId，amount=每期转入金额而不是target，schedule），不是TR03/TR04；TR03/TR04只用于转给联系人。“每月存400到目标账户，连续三个月”是IN04 action=update，goalId取records里唯一的目标，amount=400，schedule写原话“每月，连续三个月”，不要把期数填进deadline。问“给某人转过钱吗/转账记录”是TR06。单独的“到时候提醒我”是提醒（IN14），不是IN04或TR04。open_saved：用户要看已保存的工资/月度安排及依据（savedPlans）。resume：用户说继续刚才暂停的安排或任务。
- ask：缺信息又无法建任务时追问。chat：纯闲聊，以及与银行账户无关、functions里也没有的事（买电影票、订餐、购物等），say说明暂不支持；functions里有的功能（含导入外部账单）仍用run。理财知识、风险、怎么亏这类问题用run+IN15或相关查询功能，不用chat。
- 问“你能办什么/能做什么/有哪些功能”是chat，不是ask，也不是run：say直接列出能办的六类业务（转账与AA、账单分析、理财与目标储蓄、卡片管理、订阅与代扣、一句话办多件事），再问想办哪项，不要反问用户想办什么。
- functionId从functions里选最贴切的一项；该功能有actions时必须在params.action里填其中一个（新建填create，查看填list）；params只用该功能fields里的字段名，只填用户说过或上下文能唯一确定的值，不猜。
- 金额一律是以元为单位的数字：1万2=12000，一千二=1200，五百=500，两百五=250。周期写进schedule原话，如“每月5日”。期间写YYYY-MM或YYYY，按today和weekday（星期几）换算“这个月/上个月/今年/下周五”。
- 卡、产品、持仓、目标、订阅、交易等字段填records里对应的id（cardId、productId、holdingId、goalId、subscriptionId、transactionId），不要编造id；用户用名称或尾号指代时换成id。
- “这张卡/那笔/这笔/刚才那个”指history里上一轮用户提到的那个对象（如上一轮说了尾号8021，“这张卡”就是8021那张；上一轮问的咖啡，“那笔”就是咖啡那笔），用户顺口说的旧分类或描述与它不符时，以指代为准。
- 账单：某商户或订阅“一共花了/扣了多少”是BI02（按merchant统计）；某个订阅下次什么时候扣是SU01；BI05只用于找出有哪些周期扣费或闲置订阅。records.transactions里suspectedDuplicate=true是疑似重复扣款，originalId指向原交易；问“扣了两次/重复扣款/退款回来没”用BI04并填对应transactionId。
- recipientId/accountId必须是contacts/accounts里的id；同名多人且无法区分时不填recipientId。
- AA（TR05）：total为总额；participants为全部分摊人（含“我”），同名的人带上用户说的称呼以示区分（如“室友张三”“房东张三”），只说了人数或名字不全时不填，不用“其他1”之类占位名；某项只由部分人分摊时必须写adjustments。例：“昨晚300元饭钱，五个人AA，其中50元酒只有张三、李四喝了”→{"intent":"run","functionId":"TR05","params":{"action":"create","total":300,"adjustments":[{"label":"酒","amount":50,"participants":["张三","李四"]}]}}
- 卡片：卡丢了/可能丢了/不认识的消费/保护这张卡/先冻结 → CA06 action=freeze（先止损，可解冻）；只有用户明确说“挂失”才用CA07。卡为什么不能刷/被限制 → CA05 action=query；要求解开限制 → CA05 action=unlock。用户没说是哪张卡（尾号或卡名）时不填cardId，由卡片追问，不要猜。
- 用户换成另一种业务时用run新建，不要amend当前任务。
- 只说了一半也先run建任务并填上已说出的字段（如“给室友张三转”先填recipientId），缺的由卡片追问；之后补充用amend。
- 对已有任务的补充或改口用amend并给taskId；不要为同一件事重复run。没有currentTask时不能amend。同一句话里的改口（“两百五，不对，三百”）是一项新业务：用run，填齐这句里说过的全部字段，金额取改口后的值。
- say用中文，不超过40字。`;

export type IntentResult = { intent: Intent | null; before?: BankAction; action?: BankAction; fallback?: BankAction; dropped: string[]; say: string };
const CANCEL = /取消|不办|不转|不要了|算了|不用了|不买|不冻|结束(?!日期|时间)|停止|退出|不弄了|不做了|先这样|放弃|换一个|换个业务/, NOT_CANCEL = /(?:别|不要|不用|不)(?:取消|结束|退出|放弃)|不是要(?:取消|结束|退出|放弃)/;
/** Commits a validated intent in order: drop the abandoned card, then the new business (or its fallback). Every caller uses this. */
export async function applyIntent(r: IntentResult, commit: (action: BankAction) => unknown) {
 if (r.before) await commit(r.before);
 if (!r.action) return;
 try { await commit(r.action); } catch (error) { if (!r.fallback) throw error; await commit(r.fallback); }
}
/** One model call → validated action. Committing it is the caller's job, through the usual reducer. */
// The mic or the realtime model can hand our own announcement back as a user turn; replaying it would open business nobody asked for.
const bare = (text: string) => text.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
// Only lines that are unmistakably ours count, so a user restating the review summary still goes through.
/** Words that report a change; a chat or question turn has made none. */
const CLAIMED = /已(?:经)?(?:取消|修改|改为|改成|设置|设好|提交|冻结|解冻|挂失|保存|创建|开通|转账|转出|发起|完成|办好|恢复|暂停)|办好了|改好了|取消好了/;
const OWN = /现在办理|继续办理|已完成|已取消|已放下|已填信息保留|请补充|请核对|进度已保留|没办完/;
export function echoesAssistant(s: BankState, utterance: string, history: { reply: string }[] = []) {
 const said = bare(utterance);
 if (said.length < 8 || !OWN.test(utterance)) return false;
 const own = [s.lastReply, s.plan?.message, ...(s.plan?.announcements || []), ...s.workflows?.tasks.map(t => t.message) || [], ...history.map(h => h.reply)];
 return own.some(text => typeof text === 'string' && bare(text).includes(said));
}

export async function understandIntent(s: BankState, utterance: string, history: { user: string; reply: string }[], provider: Provider, signal: AbortSignal, request: typeof fetch = fetch): Promise<IntentResult> {
 if (echoesAssistant(s, utterance, history)) return { intent: null, dropped: ['echo'], say: '刚才这句是系统自己的播报，没有当作新的办理请求。' };
 const wf = s.workflows, current = wf?.tasks.find(t => t.id === wf.currentTaskId);
 const context = {
  accounts: s.accounts.map(a => ({ id: a.id, name: a.name, tail: a.tail })),
  contacts: contactsOf(s).map(c => ({ id: c.id, name: c.name, label: c.label, tail: c.tail })),
  currentTask: current && { id: current.id, functionId: current.functionId, status: current.status, params: current.params, missing: current.missing },
  today: businessDay(s), weekday: '日一二三四五六'[new Date(businessDay(s) + 'T12:00:00Z').getUTCDay()], records: records(s, [utterance, ...history.slice(-2).map(h => h.user)].join(' ')), savedPlans: (bankToolResult(s) as { savedPlans?: unknown }).savedPlans,
  plan: s.plan && { status: s.plan.status, steps: s.plan.steps.map(step => ({ functionId: step.functionId, status: step.status })) },
  history: history.slice(-6), functions,
 };
 const response = await request(`${provider.base}/compatible-mode/v1/chat/completions`, { method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
  headers: { Authorization: `Bearer ${provider.key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: provider.planner, enable_thinking: false, max_tokens: 600, response_format: { type: 'json_object' },
   messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: JSON.stringify(context) }, { role: 'user', content: utterance }] }) });
 if (!response.ok) throw new Error(`意图模型暂时不可用（${response.status}）。`);
 const data = await response.json() as { choices?: { message?: { content?: string } }[] };
 let intent: Intent | null = null;
 try { intent = JSON.parse(data.choices?.[0]?.message?.content || 'null'); } catch { intent = null; }
 // Names already on the current card were heard in an earlier turn, even when the route keeps no history.
 let result: { before?: BankAction; action?: BankAction; dropped: string[]; say: string } = validate(s, intent, utterance, [...history.map(h => h.user), JSON.stringify(current?.params || {}), utterance].join('\n'));
 // “算了不转了，帮我查下余额”: the user dropped the open card before asking for something else, so it must not come back afterwards.
 if (result.action && current && !['complete', 'cancelled'].includes(current.status) && CANCEL.test(utterance) && !NOT_CANCEL.test(utterance) && intent?.intent !== 'cancel' && intent?.functionId !== current.functionId)
  result = { ...result, before: { type: 'workflow', command: { operation: 'cancel', taskId: current.id, source: 'card', utterance } } };
 // The plan engine insists its quotes tile the sentence exactly; if the model's split is off, let it decompose.
 const fallback: BankAction | undefined = result.action?.type === 'plan' && result.action.command.tasks ? { type: 'plan', command: { operation: 'create', source: 'card', utterance } } : undefined;
 return { intent, ...result, fallback };
}

export const TEXT_FIELDS = new Set(['archive', 'note', 'name', 'merchant', 'category', 'period', 'baseline', 'schedule', 'deadline', 'topic', 'narrative', 'file', 'label', 'query', 'reason']);
const MONEY = ['amount', 'target', 'balance', 'value', 'cost', 'limit'];
const KEEP = ['id', 'name', 'tail', 'status', 'merchant', 'category', 'date', 'kind', 'accountId', 'productId', 'risk', 'type', 'channel', 'cycle', 'nextChargeAt', 'deadline', 'restriction', 'suspectedDuplicate', 'originalId', 'recipientId', 'note', 'createdAt', ...MONEY];
/** Business objects the model may refer to, by id, with amounts shown in yuan like its own output. */
function records(s: BankState, heard: string) {
 const out: Record<string, unknown[]> = {};
 for (const [kind, all] of Object.entries(s.workflows?.records || {})) {
  // Past transfers are answered by TR06 itself; listing them only crowds out names the user is saying now.
  if (!Array.isArray(all) || !all.length || kind === 'transferHistory') continue;
  // Months of ledger do not fit: send the rows whose merchant or category was mentioned, then the latest ones.
  // Anomalies (suspected duplicates and refunds) are what users ask about without naming them, so they always go along.
  const named = kind === 'transactions' ? all.filter(row => row.suspectedDuplicate || row.kind === 'refund' || [row.merchant, row.category].some(v => typeof v === 'string' && v && heard.includes(v))) : [];
  const rows = named.length ? [...new Set([...named.slice(-12), ...all.slice(-30)])].slice(0, 30).sort((a, b) => String(a.date).localeCompare(String(b.date))) : all.slice(-30);
  out[kind] = rows.map(row => Object.fromEntries(Object.entries(row as Record<string, unknown>).filter(([k]) => KEEP.includes(k)).map(([k, v]) => [k, MONEY.includes(k) && typeof v === 'number' ? v / 100 : v])));
 }
 return out;
}

/** Validate only: reject what cannot be right, never substitute a reading of the utterance. */
function distinguished(s: BankState, id: string, heard: string) {
 const contacts = contactsOf(s), chosen = contacts.find(c => c.id === id)!;
 if (contacts.filter(c => c.name === chosen.name).length < 2) return true;
 const marks = [chosen.label, chosen.tail, ...((chosen as { aliases?: { labels?: string[] } }).aliases?.labels || [])].filter(Boolean) as string[];
 return marks.some(mark => heard.includes(mark));
}
function cardNamed(s: BankState, id: string, heard: string) {
 const cards = (s.workflows?.records.cards || []) as { id: string; name: string; tail: string }[], card = cards.find(c => c.id === id);
 if (!card || cards.length < 2 || heard.includes(id)) return true;
 return heard.includes(card.tail) || heard.includes(card.name.replace(/(?:演示)?(?:借记)?卡$/, ''));
}
function validate(s: BankState, intent: Intent | null, utterance: string, heard = utterance): { before?: BankAction; action?: BankAction; dropped: string[]; say: string } {
 const dropped: string[] = [], say = intent?.say || '请再说一下想办理什么。';
 if (!intent || typeof intent !== 'object') return { dropped: ['unparsable'], say };
 const wf = s.workflows, current = wf?.tasks.find(t => t.id === wf.currentTaskId);
 // A transfer request in a scam script still opens its card, so the engine's fraud stop blocks and records it whatever the model chose to say.
 if ((intent.intent === 'ask' || intent.intent === 'chat') && /转/.test(utterance) && new RegExp(FRAUD_WORDS.source).test(utterance))
  intent = { ...intent, intent: 'run', functionId: 'TR03', params: intent.params || {} };
 // A reply that changes nothing must not sound as if it did (“已取消暂停操作”); the card keeps the real state.
 if (intent.intent === 'ask' || intent.intent === 'chat') return CLAIMED.test(say) ? { dropped: [...dropped, 'say:claimed_change'], say: '好的，当前进度保留，没有做任何改动。' } : { dropped, say };
 // Asking for this month's arrangement opens the saved plan read-only, whatever the model made of the rest of the sentence.
 if (!['confirm', 'cancel'].includes(intent.intent) && isMonthlyRequest(utterance) && savedMonthlyPlans(s).length)
  return { action: { type: 'plan', command: { operation: 'open_saved', source: 'card', utterance } }, dropped, say: '先看数据范围和计划，现在还没有执行任何付款或申购。' };
 // Authorization is never the model's call: only the literal acknowledgement of the current card counts.
 if (intent.intent === 'confirm') {
  const command = explicitWorkflowConfirmation(s, utterance);
  return command ? { action: { type: 'workflow', command: { ...command, source: 'voice', utterance } } as BankAction, dropped, say } : { dropped: ['confirm_without_literal_ack'], say: '请核对卡片后明确说“确认”。' };
 }
 if (intent.intent === 'open_saved') return { action: { type: 'plan', command: { operation: 'open_saved', source: 'card', utterance } }, dropped, say };
 if (intent.intent === 'resume') return s.plan ? { action: { type: 'plan', command: { operation: 'resume', source: 'card', utterance } }, dropped, say } : { dropped: ['no_plan'], say };
 if (intent.intent === 'plan') {
  const steps = (intent.steps || []).filter(step => FIELDS[step.functionId]).slice(0, 6), quotes = tile(utterance, steps.map(step => step.quote || ''));
  const tasks = steps.map((step, i) => ({ quote: quotes[i], functionId: step.functionId, params: clean(s, step.functionId, step.params, heard, dropped) }));
  if (tasks.length > 1) return { action: { type: 'plan', command: { operation: 'create', tasks, source: 'card', utterance } }, dropped, say };
  if (tasks.length === 1) return { action: { type: 'workflow', command: { operation: 'run', functionId: tasks[0].functionId, params: tasks[0].params, source: 'card', utterance } }, dropped, say };
  return { dropped: ['empty_plan'], say };
 }
 const wanted = intent.taskId, taskId = wanted && wf?.tasks.some(t => t.id === wanted) ? wanted : current?.id;
 // Like confirmation, cancelling is the user's decision: it needs their own cancel words, not a model reading of “停”.
 if (intent.intent === 'cancel' && (!CANCEL.test(utterance) || NOT_CANCEL.test(utterance))) return { dropped: ['cancel_without_literal'], say: '好的，先停在这里，进度保留。' };
 if (intent.intent === 'cancel') return taskId ? { action: { type: 'workflow', command: { operation: 'cancel', taskId, source: 'card', utterance } }, dropped, say } : { dropped: ['no_task'], say };
 // “amend” toward another function is a new business, not an edit of the current card.
 if (intent.intent === 'amend' && intent.functionId && intent.functionId !== wf?.tasks.find(t => t.id === taskId)?.functionId) intent = { ...intent, intent: 'run' };
 const functionId = intent.intent === 'amend' ? wf?.tasks.find(t => t.id === taskId)?.functionId : intent.functionId;
 if (!functionId || !FIELDS[functionId]) return { dropped: ['unknown_function'], say };
 const params = clean(s, functionId, intent.params, heard, dropped);
 // Schema default: a new task on a function that can be created starts as create.
 if (intent.intent === 'run' && params.action == null && ACTIONS[functionId]?.includes('create')) params.action = 'create';
 // Asking again for a card that is still open returns to it; only different values make it a new business.
 if (intent.intent === 'run') {
  const same = wf?.tasks.find(t => t.functionId === functionId && ['queued', 'collecting', 'review'].includes(t.status) && (t.params.action ?? null) === (params.action ?? null)
   && Object.entries(params).every(([k, v]) => t.params[k] == null || JSON.stringify(t.params[k]) === JSON.stringify(v)));
  if (same) {
   const added = Object.fromEntries(Object.entries(params).filter(([k]) => same.params[k] == null));
   const back: BankAction = s.plan?.steps.some(step => step.taskId === same.id) ? { type: 'plan', command: { operation: 'resume', taskId: same.id, source: 'card', utterance } } : { type: 'workflow', command: { operation: 'status', taskId: same.id, source: 'card', utterance } };
   if (!Object.keys(added).length) return { action: back, dropped, say };
   return { before: back, action: { type: 'workflow', command: { operation: 'amend', taskId: same.id, params: added, source: 'card', utterance } }, dropped, say };
  }
 }
 // Validated structured fields enter like card input; the engine still applies its own type and state checks.
 const command = intent.intent === 'amend' && taskId
  ? { operation: 'amend' as const, taskId, params, source: 'card' as const, utterance }
  : { operation: 'run' as const, functionId, params, source: 'card' as const, utterance };
 return { action: { type: 'workflow', command }, dropped, say };
}

/** Cut the user's own sentence where each step starts, so quotes tile it exactly whatever the model copied. */
function tile(utterance: string, quotes: string[]) {
 const anchor = (q: string) => q.replace(/^[\s，,。；;：:、]*(?:我要|我想|先|然后|接着|再|顺便)?/, '').slice(0, 4);
 const starts: number[] = [0];
 for (const q of quotes.slice(1)) {
  const at = utterance.indexOf(anchor(q), starts.at(-1)! + 1);
  if (at <= starts.at(-1)!) return quotes; // cannot place it; let the engine judge the model's own split
  starts.push(at);
 }
 return starts.map((start, i) => utterance.slice(start, starts[i + 1] ?? utterance.length));
}
function headcount(text: string) {
 const word = text.match(/([两二三四五六七八九十]|\d{1,2})\s*个人/)?.[1];
 if (!word) return undefined;
 return /\d/.test(word) ? Number(word) : '一二三四五六七八九十'.indexOf(word) + 1 || 2;
}
function clean(s: BankState, functionId: string, input: Record<string, unknown> | undefined, heard: string, dropped: string[]) {
 const params: Record<string, unknown> = {};
 for (const [key, value] of Object.entries(input || {})) {
  if (value == null || value === '') continue;
  if (!FIELDS[functionId].includes(key)) { dropped.push(key); continue; }
  if (key === 'recipientId' && !contactsOf(s).some(c => c.id === value)) { dropped.push(key); continue; }
  // Same-name payees: the user must have said what tells them apart (label, alias or tail), else ask.
  if (key === 'recipientId' && !distinguished(s, String(value), heard)) { dropped.push('recipientId:same_name'); continue; }
  if (key === 'accountId' && !s.accounts.some(a => a.id === value)) { dropped.push(key); continue; }
  // With several cards, “my card is lost” names none of them; a card the user never named is a guess, so ask.
  if (key === 'cardId' && !cardNamed(s, String(value), heard)) { dropped.push('cardId:unnamed'); continue; }
  if (key === 'deadline' && !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) { dropped.push(key); continue; }
  // Free-text fields take text only; a model's `false` or `{}` must not end up typed into a card field.
  if (TEXT_FIELDS.has(key) && typeof value !== 'string') { dropped.push(key + ':type'); continue; }
  if (['amount', 'total'].includes(key) && !(typeof value === 'number' && value > 0)) { dropped.push(key); continue; }
  if (key === 'action' && ACTIONS[functionId] && !ACTIONS[functionId].includes(String(value))) { dropped.push(key); continue; }
  // Every participant must be the user, a known contact or a name the user said; a made-up placeholder voids the list.
  // A stated headcount that the list does not match is a doubt to ask about, never a split to draft.
  // With headcount also proposed, a shorter list is the names said so far, and the card asks for the rest.
  if (key === 'participants' && Array.isArray(value) && headcount(heard) != null && headcount(heard) !== value.length && !(input?.headcount === headcount(heard) && value.length < headcount(heard)!)) { dropped.push('participants:count'); continue; }
  if (key === 'participants' && !(Array.isArray(value) && value.every(name => typeof name === 'string' && (name === '我' || heard.includes(name) || contactsOf(s).some(c => c.name === name))))) { dropped.push('participants:unheard'); continue; }
  params[key] = value;
 }
 // Standing debits only when the user asked for them; a plain “存够3000” goal stays manual.
 if (params.autoSave === true && !/自动|每月|每周|每天|定期|定投/.test(heard)) { delete params.autoSave; dropped.push('autoSave'); }
 return params;
}
