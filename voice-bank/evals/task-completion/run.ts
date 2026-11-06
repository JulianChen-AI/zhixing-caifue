// Task-completion evaluation over the six competition scenarios plus safety cases.
// rules    : the keyless typed-text path (/api/bank command in demo mode), no network.
// delegate : the real backend model running the bank tool loop (/api/bank/delegate), opt-in with --live.
// voice    : the production voice controller with the real realtime model plus delegate, supervise, review
//            and stall recovery, opt-in with --live (see voice-session.ts).
// All run in memory through the same dispatch and reducer the routes commit through; nothing is persisted.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { initialState, normalizeState, reduceBank } from '../../lib/bank/engine.ts';
import { replyForState } from '../../lib/ui/presentation.ts';
import { currentWorkflow } from '../../lib/workflows/engine.ts';
import type { BankAction, BankState } from '../../lib/bank/types.ts';
import { contactsOf } from '../../lib/bank/recipients.ts';
import { businessDay } from '../../lib/demo/clock.ts';
import { qwenConfig, type QwenEnv } from '../../lib/bank/qwen.ts';
import { toolAction, type ToolCall } from '../../lib/bank/tool-action.ts';
import { operationToolResult } from '../../lib/bank/tool-result.ts';
import { bankToolResult } from '../../lib/bank/realtime-tools.ts';
import { routeRequest } from '../../lib/checklists/routing.ts';
import { dispatchAction, resumeAction } from '../../lib/plans/dispatch.ts';
import { planTextAction } from '../../lib/plans/engine.ts';
import { isComplexRequest } from '../../lib/plans/decompose.ts';
import { offlineWorkflow, workflowTextAction } from '../../lib/workflows/offline.ts';
import { runDelegation, qwenCompletion } from '../../lib/voice/delegation.ts';
import { voiceSettings } from '../../lib/voice/qwen-protocol.ts';
import { openTasks, caseFile, CLAIMS_CHANGE, effectPrint, focus, grade, planView, riskFlagged, SCENARIOS, WAIT_ONLY, type EvalCase } from './grade.ts';
import { runVoiceCase, type Interruption } from './voice-session.ts';
import { jsonAgent } from './json-agent.ts';
import { speechKey, type SpeechCache } from './speech.ts';

const DEFAULT_CLOCK = '2026-10-25T04:00:00.000Z';
const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? 'true']));
const driver = args.driver || 'rules';
if (!['rules', 'delegate', 'voice', 'json'].includes(driver)) throw new Error('--driver 只能是 rules、delegate、voice 或 json');
const here = new URL('.', import.meta.url);
// --cases=holdout runs holdout.json, phrasings never used while tuning, to check cases.json for overfitting.
const caseSet = args.cases || 'cases';
// tricky-dev / tricky-holdout: hard phrasings added 2026-11-02; fixes are tuned on dev only, holdout is run once.
// prompts28: the 28 demo prompts handed to judges.
// lifecycle: multi-turn exits, blocks and follow-up requests (issues #1, #3, #9).
// features: cases for the functions added on 2026-11-06 (portfolio review and onward), written while building them.
if (!['cases', 'holdout', 'tricky-dev', 'tricky-holdout', 'prompts28', 'lifecycle', 'features'].includes(caseSet)) throw new Error('--cases 只能是 cases、holdout、tricky-dev、tricky-holdout、prompts28、lifecycle 或 features');
// --clock=now runs default-scene cases on data anchored at today, as a live session sees it.
const clockNow = args.clock === 'now';
const file = caseFile.parse(JSON.parse(readFileSync(new URL(`${caseSet}.json`, here), 'utf8')));
const only = args.only?.split(',');
const cases = file.cases.filter(c => (!only || only.includes(c.id)) && (!args.scenario || c.scenario === args.scenario));
const repeat = Math.max(1, Number(args.repeat) || 1), concurrency = Math.max(1, Number(args.concurrency) || 1);
// --input=asr replaces each written turn with what Qwen ASR heard from Qwen TTS (see speech.ts).
// --input=audio (voice driver only) streams that TTS recording into the realtime model's own VAD and ASR.
const input = args.input || 'text', voice = args.voice || 'Cherry';
if (!['text', 'asr', 'audio'].includes(input)) throw new Error('--input 只能是 text、asr 或 audio');
if (input === 'audio' && driver !== 'voice') throw new Error('--input=audio 只能配 --driver=voice');
const speech: SpeechCache | null = input === 'asr' ? JSON.parse(readFileSync(new URL('asr.json', here), 'utf8')) : null;
const heard = (text: string) => {
 if (!speech || input === 'audio') return text;
 const item = speech.items[speechKey(voice, text)];
 if (!item) throw new Error(`asr.json 没有 ${voice} 读“${text}”的转写，请先运行 speech.ts`);
 return item.heard;
};

let provider: ReturnType<typeof qwenConfig> | undefined;
if (driver !== 'rules') {
 // Real calls cost money and reach an external service, so they never start by default.
 if (args.live !== 'true') throw new Error(`${driver} 会调用真实 Qwen，请显式加 --live`);
 process.loadEnvFile(new URL('../../.dev.vars', here));
 provider = qwenConfig(process.env as QwenEnv);
 if (!provider.ready) throw new Error('.dev.vars 中的 Qwen 配置不完整');
}

function start(c: EvalCase): BankState {
 if ((!c.scene || c.scene === 'default') && clockNow) { const now = new Date().toISOString(); return { ...initialState(businessDay({ demoClock: now } as BankState)), demoClock: now }; }
 const fresh = initialState();
 if (!c.scene || c.scene === 'default') return { ...fresh, demoClock: DEFAULT_CLOCK };
 return reduceBank(fresh, { type: 'load_scene', sceneId: c.scene }, crypto.randomUUID());
}

type Turn = { text: string; heard?: string; firstAudioMs?: number; playback?: unknown[]; ms: number; error?: string; toolCalls?: number; modelRounds?: number; delegation?: string; summary?: string; asked?: boolean; interruptions?: Interruption[]; falseClaim?: boolean; supervisions?: number; reviews?: number };

/** What the user would experience as the task breaking off, read from one finished turn. */
function breaks(turn: Turn): Interruption[] {
 const found = [...(turn.interruptions || [])];
 if (turn.error && driver !== 'voice') found.push({ kind: 'banner', message: turn.error });
 if (turn.delegation === 'paused') found.push({ kind: 'halt', message: '后台调用次数到上限，本轮自动办理暂停' });
 if (turn.delegation === 'unknown') found.push({ kind: 'halt', message: '办理结果未知，需要核对卡片' });
 if (turn.summary && WAIT_ONLY.test(turn.summary.trim())) found.push({ kind: 'stall', message: `只回了“${turn.summary.trim()}”就没有下文` });
 return found;
}

/** Mirrors the command branch of app/api/bank/route.ts with mode "demo". */
function rulesTurn(s: BankState, text: string): BankState {
 const continued = resumeAction(s, text) || planTextAction(s, text);
 const complex = isComplexRequest(text, s);
 const workflow = !continued && !complex ? workflowTextAction(s, text) : null;
 const offline = offlineWorkflow(text, s);
 const action: BankAction = continued || (complex ? { type: 'plan', command: { operation: 'create', source: 'voice', utterance: text } }
  : workflow ? { type: 'workflow', command: workflow } : offline ? { type: 'workflow', command: offline } : { type: 'route', decision: routeRequest(text, s) });
 return reduceBank(s, dispatchAction(s, action, text), crypto.randomUUID());
}

/** Mirrors app/api/bank/delegate/route.ts minus the database. */
async function delegateTurn(state: BankState, text: string, history: string[], turn: Turn): Promise<BankState> {
 let s = state, rounds = 0;
 const counted: typeof fetch = async (url, init) => { rounds++; return fetch(url, init); };
 const execute = async (tool: ToolCall) => {
  const action = toolAction(s, tool);
  if (!action) return bankToolResult(s);
  const previous = s;
  s = reduceBank(previous, dispatchAction(previous, action, tool.utterance, tool.turnId), crypto.randomUUID());
  return operationToolResult(previous, s, tool);
 };
 let committed = 0;
 const counting = async (tool: ToolCall) => { const before = s; const out = await execute(tool); if (s !== before) committed++; return out; };
 try {
  const result = await runDelegation({ utterance: text, history: history.slice(-8).map(t => t.slice(-400)), turnId: crypto.randomUUID() },
   { state: () => s, execute: counting, complete: qwenCompletion(provider!, counted, voiceSettings(provider!.voice, '', contactsOf(s)).tools) }, AbortSignal.timeout(25000));
  Object.assign(turn, { toolCalls: result.toolCalls, modelRounds: rounds, delegation: result.status, summary: result.summary, asked: result.status === 'needs_user' || /[？?]\s*$/.test(result.summary) });
 } catch (error) {
  // As in the route: once a step committed, a failure is an unknown outcome and the state stays as committed.
  Object.assign(turn, { error: error instanceof Error ? error.message : String(error), modelRounds: rounds, delegation: committed ? 'unknown' : 'error' });
 }
 return s;
}

/** QWEN_INTENT=json path: one JSON intent call, validate-only checks, then the same engine. */
let intentTurn: ReturnType<typeof jsonAgent> | undefined;
async function jsonTurn(state: BankState, text: string, thread: string, turn: Turn): Promise<BankState> {
 let s = state;
 intentTurn ??= jsonAgent(provider!);
 const turnId = crypto.randomUUID();
 try {
  const result = await intentTurn(thread, text, { state: () => s, commit: action => { s = reduceBank(s, dispatchAction(s, action, text, turnId), crypto.randomUUID()); } }, AbortSignal.timeout(25000));
  Object.assign(turn, { toolCalls: result.intent ? 1 : 0, delegation: result.intent?.intent, summary: result.summary, asked: result.asked, dropped: result.dropped });
 } catch (error) { Object.assign(turn, { error: error instanceof Error ? error.message : String(error), delegation: 'error' }); }
 return s;
}

/**
 * A turn the user takes on the card rather than in words: 【卡片】确认 / 认证 / 取消, or 【刷新】 for a page reload
 * (the stored state is serialised and normalised again). These go straight to the engine, as the page's buttons do.
 */
export const CARD_TURN = /^【(?:卡片|刷新)】/;
function cardTurn(s: BankState, text: string, turn: Turn): BankState {
 if (text === '【刷新】') { turn.delegation = 'reload'; s = normalizeState(JSON.parse(JSON.stringify(s)) as BankState); }
 else {
  const t = currentWorkflow(s), what = text.replace('【卡片】', '');
  if (!t) throw new Error('卡片轮没有可操作的当前任务');
  const command = what === '确认' ? { operation: 'confirm' as const, taskId: t.id, token: t.reviewToken || undefined }
   : what === '认证' ? { operation: 'authenticate' as const, taskId: t.id, token: t.verificationId || undefined, code: '123456' }
   : what === '取消' ? { operation: 'cancel' as const, taskId: t.id } : null;
  if (!command) throw new Error('未知的卡片操作：' + what);
  turn.delegation = 'card';
  s = reduceBank(s, { type: 'workflow', command: { ...command, source: 'card' } } as BankAction, crypto.randomUUID());
 }
 turn.summary = replyForState(s);
 return s;
}

function clarified(s: BankState, asked: boolean) {
 const f = focus(s), plan = s.plan;
 return asked || f?.status === 'collecting' || (f?.choices || 0) > 1 || s.routing?.outcome === 'clarify'
  || plan?.status === 'collecting' || !!plan?.steps.some(step => step.kind === 'clarify' && step.status !== 'complete');
}

async function runCase(c: EvalCase, attempt: number) {
 let s = start(c);
 const before = effectPrint(s), turns: Turn[] = [], spoken = c.turns.map(t => CARD_TURN.test(t) ? t : heard(t));
 if (driver === 'voice' && c.turns.some(t => CARD_TURN.test(t))) turns.push({ text: c.turns[0], ms: 0, error: '语音驱动不支持卡片轮', interruptions: [] });
 else if (driver === 'voice') {
  try {
   const run = await runVoiceCase(s, spoken, provider!, { audioVoice: input === 'audio' ? voice : undefined, tag: `${c.id}-a${attempt}` });
   s = run.state;
   for (const t of run.turns) turns.push({ text: t.text, heard: t.heard, firstAudioMs: t.firstAudioMs, playback: t.playback, ms: t.ms, error: t.error, toolCalls: t.toolCalls, delegation: t.delegations ? 'delegated' : undefined, summary: t.reply, asked: /[？?]\s*$/.test(t.reply), interruptions: t.interruptions, supervisions: t.supervisions, reviews: t.reviews });
  } catch (error) { turns.push({ text: spoken[0], ms: 0, error: error instanceof Error ? error.message : String(error), interruptions: [{ kind: 'session_failed', message: String(error) }] }); }
 } else for (const [i, text] of spoken.entries()) {
  const turn: Turn = { text, ms: 0 }, t0 = performance.now(), focusBefore = JSON.stringify(focus(s));
  // Like the live client, history is the latest user transcripts including this one.
  try { s = CARD_TURN.test(text) ? cardTurn(s, text, turn) : driver === 'rules' ? rulesTurn(s, text) : driver === 'json' ? await jsonTurn(s, text, `${c.id}-a${attempt}`, turn) : await delegateTurn(s, text, spoken.slice(0, i + 1), turn); }
  catch (error) { turn.error = error instanceof Error ? error.message : String(error); }
  turn.ms = Math.round(performance.now() - t0);
  // Saying a change happened while the card did not move is a false claim, whatever the words.
  turn.falseClaim = !!turn.summary && CLAIMS_CHANGE.test(turn.summary) && JSON.stringify(focus(s)) === focusBefore;
  turns.push(turn);
 }
 for (const t of turns) t.interruptions = breaks(t);
 const asked = !!turns.at(-1)?.asked;
 const outcome = { focus: focus(s), plan: planView(s), clarified: clarified(s, asked), effectsChanged: effectPrint(s) !== before, riskFlagged: riskFlagged(s), open: openTasks(s), reply: turns.at(-1)?.summary || (driver === 'rules' ? s.lastReply : '') };
 const graded = grade(c, outcome);
 return { id: c.id, attempt, scenario: c.scenario, brief: c.brief, source: c.source, scene: c.scene || 'default', ...graded,
  final: { functionId: outcome.focus?.functionId ?? null, status: outcome.focus?.status ?? null, params: outcome.focus?.params ?? null, plan: outcome.plan, message: (outcome.focus?.message || s.lastReply || '').slice(0, 160) },
  interrupted: turns.some(t => t.interruptions!.length), falseClaim: turns.some(t => t.falseClaim),
  turns, totalMs: turns.reduce((n, t) => n + t.ms, 0) };
}

const jobs = Array.from({ length: repeat }, (_, i) => cases.map(c => ({ c, attempt: i + 1 }))).flat();
const results: Awaited<ReturnType<typeof runCase>>[] = new Array(jobs.length);
let next = 0;
await Promise.all(Array.from({ length: concurrency }, async () => {
 for (let i; (i = next++) < jobs.length;) {
  const r = await runCase(jobs[i].c, jobs[i].attempt);
  results[i] = r;
  const broke = r.turns.flatMap(t => t.interruptions || []);
  console.log(`${r.passed ? 'PASS' : 'FAIL'}${broke.length ? '·中断' : ''} ${r.id}${repeat > 1 ? '#' + r.attempt : ''} ${r.brief}${r.passed ? '' : ' — ' + r.reasons[0]}${broke.length ? ' ｜ ' + broke.map(b => b.message).join(' / ').slice(0, 120) : ''}`);
 }
}));

const pct = (n: number, d: number) => d ? `${(100 * n / d).toFixed(1)}%` : '—';
const quantile = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)] : 0; };
/** pass^k counts a case only when every attempt passed; the gap to pass@1 is the instability. */
function stats(rs: typeof results) {
 const ids = [...new Set(rs.map(r => r.id))], attempts = (id: string) => rs.filter(r => r.id === id);
 const turns = rs.flatMap(r => r.turns);
 return { cases: ids.length, runs: rs.length, passed: rs.filter(r => r.passed).length,
  passAll: ids.filter(id => attempts(id).every(r => r.passed)).length, flaky: ids.filter(id => { const a = attempts(id); return a.some(r => r.passed) && a.some(r => !r.passed); }),
  wrongExecution: rs.filter(r => r.wrongExecution).length, wrongDraft: rs.filter(r => r.wrongDraft).length,
  // The user's question: did the task get done in one go, without the conversation breaking off?
  oneGo: rs.filter(r => r.passed && !r.interrupted).length, interrupted: rs.filter(r => r.interrupted).length, falseClaim: rs.filter(r => r.falseClaim).length,
  kinds: Object.fromEntries(['banner', 'halt', 'stall', 'recovery', 'reconnect', 'session_failed', 'audio'].map(k => [k, rs.filter(r => r.turns.some(t => t.interruptions?.some(i => i.kind === k))).length])),
  turns: turns.length, errors: turns.filter(t => t.error).length, timeouts: turns.filter(t => /abort|timeout|超时/i.test(t.error || '')).length,
  unknown: turns.filter(t => t.delegation === 'unknown').length, paused: turns.filter(t => t.delegation === 'paused').length,
  p50: quantile(turns.map(t => t.ms), 0.5), p95: quantile(turns.map(t => t.ms), 0.95), max: quantile(turns.map(t => t.ms), 1),
  firstAudio: turns.filter(t => t.firstAudioMs != null).map(t => t.firstAudioMs!) };
}
const rows = Object.entries(SCENARIOS).map(([key, label]) => ({ key, label, ...stats(results.filter(r => r.scenario === key)) })).filter(r => r.cases);
const total = stats(results);
const meta = { driver, model: driver !== 'rules' ? provider!.planner : null, realModel: ['delegate', 'json'].includes(driver), input, voice: input === 'asr' ? voice : null,
 speechModels: speech ? { tts: speech.tts, asr: speech.asr } : null, realtimeVoice: false, humanSpeech: false,
 caseVersion: file.version, cases: cases.length, repeat, clock: DEFAULT_CLOCK, ranAt: new Date().toISOString() };

const tag = `${driver}${caseSet !== 'cases' ? '-' + caseSet : ''}${input !== 'text' ? `-${input}-${voice}` : ''}${repeat > 1 ? '-x' + repeat : ''}${clockNow ? '-now' : ''}`;
const out = new URL(`../../outputs/eval-task-completion-${tag}-${meta.ranAt.replace(/[:.]/g, '-')}/`, here);
mkdirSync(out, { recursive: true });
writeFileSync(new URL('report.json', out), JSON.stringify({ meta, total, scenarios: rows, results }, null, 1));
const md = [
 `# 任务完成率评测 · ${tag}`, '',
 `- 运行：${meta.ranAt}；用例版本 ${meta.caseVersion}；${cases.length} 条 × ${repeat} 次`,
 `- 链路：${driver === 'rules' ? '无模型文字路径（演示模式），不调用任何模型' : `真实后台模型 ${meta.model} 跑工具循环（委托模式）`}${driver === 'voice' ? `；实时语音模型 ${provider!.realtime}` : ''}`,
 `- 输入：${input === 'audio' ? `qwen3-tts-flash 用 ${voice} 音色朗读的录音，按真实语速推给实时模型，由它自己断句和识别（合成语音，非真人）` : input === 'asr' ? `${speech!.tts} 用 ${voice} 音色朗读、${speech!.asr} 识别后的转写（合成语音，非真人）` : '书面原句'}`,
 `- ${driver === 'voice' ? `实时语音模型 ${provider!.realtime}${provider!.delegation ? '（委托模式）' : ''} + 线上对话控制器 + 后台办理/监督/复核/恢复，均为真实模型` : '未覆盖实时语音模型、监督与复核'}`, '',
 `| 场景 | 用例 | 一次办完（完成且未中断） | 完成率 pass@1 | ${repeat > 1 ? `${repeat}次全过 pass^${repeat} | 时过时不过 | ` : ''}发生中断 | 虚假完成声明 | 误执行 | 错误草稿 | 每轮耗时 p50 / p95 / 最大 |`,
 `|---|---|---|---|${repeat > 1 ? '---|---|' : ''}---|---|---|---|---|`,
 ...[...rows.map(r => ({ ...r, name: r.label })), { ...total, name: '**合计**' }].map(r => `| ${r.name} | ${r.cases} | ${pct(r.oneGo, r.runs)} | ${pct(r.passed, r.runs)} | ${repeat > 1 ? `${pct(r.passAll, r.cases)} | ${r.flaky.length} | ` : ''}${pct(r.interrupted, r.runs)} | ${r.falseClaim} | ${r.wrongExecution} | ${r.wrongDraft} | ${r.p50} / ${r.p95} / ${r.max} ms |`), '',
 `中断类型（按用例次数）：错误提示 ${total.kinds.banner}，暂停/叫停 ${total.kinds.halt}，卡住 ${total.kinds.stall}，转只读核对 ${total.kinds.recovery}，重新连接 ${total.kinds.reconnect}，语音会话失败 ${total.kinds.session_failed}，播报异常 ${total.kinds.audio}。`,
 ...(total.firstAudio.length ? [`说完到听见回复：p50 ${quantile(total.firstAudio, 0.5)} ms，p95 ${quantile(total.firstAudio, 0.95)} ms，最大 ${quantile(total.firstAudio, 1)} ms（${total.firstAudio.length} 轮）。`] : []), '',
 `运行稳定性：共 ${total.turns} 轮，报错 ${total.errors}（其中超时 ${total.timeouts}），结果未知 ${total.unknown}，因调用次数上限暂停 ${total.paused}。`, '',
 ...(repeat > 1 && total.flaky.length ? ['## 时过时不过', '', ...total.flaky.map(id => `- ${id} ${results.find(r => r.id === id)!.brief}：${results.filter(r => r.id === id).map(r => r.passed ? '过' : '败').join(' ')}`), ''] : []),
 ...(results.some(r => r.interrupted) ? ['## 发生中断的用例', '', '| 用例 | 赛题项 | 第几轮 | 用户看到的 |', '|---|---|---|---|',
  ...results.filter(r => r.interrupted).flatMap(r => r.turns.map((t, i) => [t, i] as const).filter(([t]) => t.interruptions?.length).map(([t, i]) => `| ${r.id}${repeat > 1 ? '#' + r.attempt : ''} | ${r.brief} | ${i + 1}/${r.turns.length}${t.heard && t.heard !== t.text ? `（识别成“${t.heard.slice(0, 30)}”）` : ''} | ${t.interruptions!.map(b => b.message).join('；').replace(/\|/g, '/').slice(0, 200)} |`)), ''] : []),
 '## 未通过', '', '| 用例 | 赛题项 | 原因 | 实际停在 |', '|---|---|---|---|',
 ...results.filter(r => !r.passed).map(r => `| ${r.id}${repeat > 1 ? '#' + r.attempt : ''} | ${r.brief} | ${r.reasons.join('；').replace(/\|/g, '/')} | ${r.final.functionId || '—'} ${r.final.status || ''}${r.turns.some(t => t.error) ? '（报错：' + r.turns.find(t => t.error)!.error!.slice(0, 40).replace(/\|/g, '/') + '）' : ''} |`),
].join('\n');
writeFileSync(new URL('summary.md', out), md + '\n');
console.log(`\n一次办完 ${total.oneGo}/${total.runs}，发生中断 ${total.interrupted}，虚假完成声明 ${total.falseClaim}；${total.passed}/${total.runs} 次通过（${pct(total.passed, total.runs)}）${repeat > 1 ? `，${total.passAll}/${total.cases} 条每次都过，${total.flaky.length} 条时过时不过` : ''}，误执行 ${total.wrongExecution}，错误草稿 ${total.wrongDraft}，报错 ${total.errors}，p95 ${total.p95} ms`);
console.log(`报告：${decodeURIComponent(out.pathname)}`);
