// Runs a case through the production voice controller (QwenConversation) talking to the real Qwen
// realtime model over WebSocket, with the handlers the page calls — delegate, supervise, review,
// stall recovery — running in memory on the real models, as their routes do. With audio, each turn is
// synthesized speech streamed at real pace into the model's own VAD and recognizer (as the microphone
// does), and every reply the user would hear is recorded, re-transcribed and checked for cuts, silence
// and noise. Without audio, turns arrive as text the way typed input does. Every pause, halt, stall,
// reconnect, error banner and broken playback is recorded as an interruption.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import WebSocket from 'ws';
import type { BankAction, BankState } from '../../lib/bank/types.ts';
import { BankError, reduceBank } from '../../lib/bank/engine.ts';
import type { qwenConfig } from '../../lib/bank/qwen.ts';
import { contactsOf } from '../../lib/bank/recipients.ts';
import { toolAction, toolCall } from '../../lib/bank/tool-action.ts';
import { operationToolResult } from '../../lib/bank/tool-result.ts';
import { bankToolResult, realtimeToolArgumentsFor } from '../../lib/bank/realtime-tools.ts';
import { BankRequestError } from '../../lib/bank/request-error.ts';
import { dispatchAction } from '../../lib/plans/dispatch.ts';
import { QwenConversation, voiceSettings, isExpectedRealtimeCancellation, type ConversationCallbacks } from '../../lib/voice/qwen-protocol.ts';
import { SPEAKER_INSTRUCTIONS, DELEGATE_TOOL, runDelegation, qwenCompletion, delegationInput } from '../../lib/voice/delegation.ts';
import { SupervisionTracker } from '../../lib/voice/supervision-tracker.ts';
import { superviseReply, supervisionInput } from '../../lib/voice/supervision.ts';
import { reviewReply, replyReviewInput } from '../../lib/voice/reply-review.ts';
import { explanationReviewFacts } from '../../lib/voice/explanation-review.ts';
import { queryReviewFacts } from '../../lib/voice/query-review.ts';
import { sessionContext } from '../../lib/voice/session-context.ts';
import { explicitLiveCommand, explicitWorkflowConfirmation } from '../../lib/workflows/offline.ts';
import { WorkflowError } from '../../lib/workflows/types.ts';
import { speechKey, transcribeFile } from './speech.ts';
import { comparable } from './spoken.ts';

type Provider = ReturnType<typeof qwenConfig>;
export type Interruption = { kind: 'banner' | 'halt' | 'stall' | 'recovery' | 'reconnect' | 'session_failed' | 'audio'; message: string; detail?: string };
export type Playback = { file: string; seconds: number; transcript: string; heard: string; similarity: number; leadSilence: number; longestGap: number; cut: boolean };
export type VoiceTurn = { text: string; ms: number; reply: string; heard?: string; firstAudioMs?: number; playback: Playback[]; interruptions: Interruption[]; delegations: number; toolCalls: number; supervisions: number; reviews: number; error?: string };
type Reply = { turn: number; audible: Buffer[]; firstAudible?: number; transcript: string; cut: boolean };

const QUIET_MS = 2500, TURN_CAP_MS = 120000, READY_CAP_MS = 55000;
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));
const IN_RATE = 16000, OUT_RATE = 24000;

/** PCM bytes of a 16-bit WAV file. */
function pcmOf(wav: Buffer) {
 for (let offset = 12; offset < wav.length - 8;) {
  const id = wav.toString('ascii', offset, offset + 4), size = wav.readUInt32LE(offset + 4);
  if (id === 'data') return wav.subarray(offset + 8, offset + 8 + size);
  offset += 8 + size + (size % 2);
 }
 throw new Error('WAV 没有 data 段');
}
function wavOf(pcm: Buffer, rate: number) {
 const head = Buffer.alloc(44);
 head.write('RIFF', 0); head.writeUInt32LE(36 + pcm.length, 4); head.write('WAVEfmt ', 8); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
 head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(pcm.length, 40);
 return Buffer.concat([head, pcm]);
}
/** Seconds of silence before the first voiced 20 ms frame, and the longest silent run inside the speech. */
function silences(pcm: Buffer, rate: number) {
 const frame = rate / 50 * 2, voiced: boolean[] = [];
 for (let i = 0; i + frame <= pcm.length; i += frame) { let sum = 0; for (let j = i; j < i + frame; j += 2) { const v = pcm.readInt16LE(j); sum += v * v; } voiced.push(Math.sqrt(sum / (frame / 2)) > 400); }
 const first = voiced.indexOf(true), lastVoiced = voiced.lastIndexOf(true);
 let gap = 0, run = 0;
 for (let i = first; i >= 0 && i <= lastVoiced; i++) { run = voiced[i] ? 0 : run + 1; gap = Math.max(gap, run); }
 return { lead: first < 0 ? voiced.length / 50 : first / 50, gap: gap / 50 };
}
/** Compare what was said with what was written, ignoring punctuation and how numbers are written. */
function similarity(a: string, b: string) {
 const x = comparable(a), y = comparable(b);
 if (!x.length && !y.length) return 1;
 const row = Array.from({ length: y.length + 1 }, (_, j) => j);
 for (let i = 1; i <= x.length; i++) { let prev = row[0]; row[0] = i; for (let j = 1; j <= y.length; j++) { const keep = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (x[i - 1] === y[j - 1] ? 0 : 1)); prev = keep; } }
 return 1 - row[y.length] / Math.max(x.length, y.length);
}

/** The status codes the routes' errorResponse would put on the wire. */
function asHttp(error: unknown): BankRequestError {
 const field = (error as { field?: string })?.field;
 if (error instanceof BankError || error instanceof WorkflowError) return new BankRequestError(error.message, error.status, field === 'sceneEpoch' ? 'scene_changed' : field === 'functionId' ? 'business_mismatch' : field === 'recipientChoice' ? 'needs_user_choice' : undefined);
 return new BankRequestError('暂时无法完成这次操作，请重试。', 500);
}

export async function runVoiceCase(start: BankState, turnsText: string[], provider: Provider, opts: { audioVoice?: string; tag?: string } = {}): Promise<{ state: BankState; turns: VoiceTurn[] }> {
 let state = start, last = Date.now(), inflight = 0, turnIndex = -1, speakerMuted = false, speechStoppedAt = 0;
 const replies = new Map<string, Reply>(), userItems = new Map<string, { turn: number; text: string }>();
 const audioDir = new URL('../../outputs/eval-voice-audio/', import.meta.url);
 if (opts.audioVoice) mkdirSync(audioDir, { recursive: true });
 const touch = () => { last = Date.now(); };
 const tracked = async <T,>(work: () => Promise<T>) => { inflight++; touch(); try { return await work(); } finally { inflight--; touch(); } };
 const commit = (action: BankAction, utterance?: string, turnId?: string) => { state = reduceBank(state, dispatchAction(state, action, utterance, turnId), crypto.randomUUID()); };
 const tracker = new SupervisionTracker();
 const snapshots = new Map<string, number>(), targets = new Map<string, string | undefined>();
 let turn: VoiceTurn | null = null, retryUsed = false, session: Session | null = null;
 const note = (kind: Interruption['kind'], message: string) => { turn?.interruptions.push({ kind, message: message.slice(0, 200) }); touch(); };

 class Session {
  ws: InstanceType<typeof WebSocket>; conversation: QwenConversation; ready: Promise<void>; dead = false; private markReady!: () => void; private updateSent = false;
  constructor(public queued?: string) {
   this.ready = new Promise(done => { this.markReady = done; });
   const url = provider.base.replace(/^https:/, 'wss:') + `/api-ws/v1/realtime?model=${encodeURIComponent(provider.realtime)}`;
   this.ws = new WebSocket(url, { headers: { Authorization: `Bearer ${provider.key}` } });
   this.conversation = new QwenConversation((type, extra = {}) => { if (!this.dead && this.ws.readyState === WebSocket.OPEN) { touch(); this.ws.send(JSON.stringify({ type, event_id: crypto.randomUUID(), ...extra })); } }, callbacks(this));
   if (provider.delegation) this.conversation.instructions = SPEAKER_INSTRUCTIONS;
   this.ws.on('message', (raw: Buffer) => { if (this.dead) return; touch(); void this.handle(JSON.parse(String(raw))).catch(error => this.fail('语音事件处理失败，正在核对办理进度。', String(error))); });
   this.ws.on('close', () => { if (!this.dead) this.fail('语音连接已关闭，办理进度保留。'); });
   this.ws.on('error', () => { if (!this.dead) this.fail('语音连接失败。'); });
  }
  private async handle(e: Record<string, any>) {
   if (e.type === 'session.created' && !this.updateSent) {
    const settings = voiceSettings(provider.voice, sessionContext(state), contactsOf(state), provider.delegation ? { instructions: SPEAKER_INSTRUCTIONS, tools: [DELEGATE_TOOL] } : undefined);
    this.updateSent = true; this.ws.send(JSON.stringify({ type: 'session.update', event_id: crypto.randomUUID(), session: settings })); return;
   }
   if (e.type === 'session.updated' && this.updateSent && !this.isReady) { this.isReady = true; this.markReady(); if (this.queued) this.conversation.userText(this.queued); return; }
   if (e.type === 'input_audio_buffer.speech_stopped') speechStoppedAt = Date.now();
   // What the page's audio element plays: deltas while unmuted. A reply muted part-way was cut off.
   if (e.type === 'response.audio.delta') { const r = replies.get(String(e.response_id)); if (r) { if (!speakerMuted) { r.audible.push(Buffer.from(String(e.delta), 'base64')); r.firstAudible ??= Date.now(); } else if (r.audible.length) r.cut = true; } }
   if (e.type === 'response.audio_transcript.done') { const r = replies.get(String(e.response_id)); if (r) r.transcript = String(e.transcript || ''); }
   await this.conversation.handle(e);
   if (e.type === 'response.created') { speakerMuted = !this.conversation.outputAllowed; replies.set(String(e.response?.id || ''), { turn: turnIndex, audible: [], transcript: '', cut: false }); }
   if (e.type === 'error' && !isExpectedRealtimeCancellation(e)) this.fail('Qwen语音服务返回错误，正在核对办理进度。', JSON.stringify(e.error || {}).slice(0, 300));
  }
  /** Streams a recording at real pace, then a second and a half of silence for the server VAD. */
  async speak(file: string) {
   const pcm = pcmOf(readFileSync(file)), chunk = IN_RATE / 10 * 2;
   const send = (bytes: Buffer) => { if (!this.dead && this.ws.readyState === WebSocket.OPEN) { this.ws.send(JSON.stringify({ type: 'input_audio_buffer.append', event_id: crypto.randomUUID(), audio: bytes.toString('base64') })); touch(); } };
   for (let i = 0; i < pcm.length && !this.dead; i += chunk) { send(pcm.subarray(i, i + chunk)); await sleep(100); }
   for (let k = 0; k < 15 && !this.dead; k++) { send(Buffer.alloc(chunk)); await sleep(100); }
  }
  isReady = false;
  /** LiveVoice.fail: an open turn becomes a stall the page recovers from. */
  fail(message: string, detail?: string) {
   if (this.dead) return;
   const pending = this.conversation.pendingRecovery();
   turn?.interruptions.push({ kind: 'session_failed', message, detail }); touch(); this.close();
   if (pending) stall(pending);
  }
  close() { if (this.dead) return; this.conversation.stop(); this.dead = true; this.ws.close(); if (session === this) session = null; touch(); }
  idle() {
   const c = this.conversation as unknown as { active: boolean; requested: boolean; awaitingContext: boolean; continuePending: boolean; calls: Map<string, unknown> };
   return this.dead || this.isReady && !c.active && !c.requested && !c.awaitingContext && !c.continuePending && c.calls.size === 0;
  }
 }

 /** page.recoverPending: end the session; replay a turn that stalled before any tool once, else reconnect later. */
 function stall(context: { utterance: string; beforeAnyTool: boolean }) {
  note('stall', context.beforeAnyTool ? '本轮语音未形成完整回复（未调用工具）' : '本轮语音未形成完整回复，转为核对后台进度');
  session?.close();
  if (context.beforeAnyTool && context.utterance && !retryUsed) { retryUsed = true; session = new Session(context.utterance); }
 }

 function callbacks(owner: Session): ConversationCallbacks {
  const alive = () => !owner.dead;
  return {
   supervisionTracker: tracker,
   onTranscript: (speaker, text, itemId) => {
    touch();
    if (speaker === 'user') { const seen = userItems.get(itemId); userItems.set(itemId, { turn: seen?.turn ?? turnIndex, text }); if (!snapshots.has(itemId)) { snapshots.set(itemId, state.revision); targets.set(itemId, state.view === 'workflow' ? state.workflows?.currentTaskId ?? undefined : undefined); } return; }
    if (!turn) return;
    if (/^(?:local-|review-)/.test(itemId)) note('halt', text); else turn.reply = text;
   },
   onInterrupt: () => { speakerMuted = true; touch(); },
   onOutputAllowed: allowed => { speakerMuted = !allowed; touch(); },
   onBusy: () => touch(),
   onToolIssue: message => { if (alive()) note('banner', message); },
   onDiagnostic: () => touch(),
   onReplyVerified: (_id, text) => { if (turn) turn.reply = text; },
   onReplyComplete: (_id, text) => { if (turn) turn.reply = text; },
   literalCommandFor: text => { const command = explicitLiveCommand(state, text); return command?.operation === 'run' ? undefined : command; },
   onLiteralResult: reply => { if (turn) turn.reply = reply; },
   onStall: context => { if (alive()) { owner.close(); stall(context); } },
   onHaltedRecovery: () => { if (alive()) { note('recovery', '本轮暂停，转为只读核对后台进度'); owner.close(); } },
   onContextRenewal: context => { if (alive()) { note('reconnect', '正在重新连接…'); owner.close(); session = new Session(context.utterance); } },
   onTool: (name, args, context) => tracked(async () => {
    if (turn) turn.toolCalls++;
    try {
     if (name === 'bank_delegate') {
      if (turn) turn.delegations++;
      const input = delegationInput.parse({ utterance: context.utterance, history: context.history, turnId: context.turnId, ...(typeof (args as { request?: unknown }).request === 'string' ? { request: String((args as { request: string }).request).slice(0, 400) } : {}) });
      let steps = 0;
      const signal = AbortSignal.any([context.signal, AbortSignal.timeout(25000)]);
      return await runDelegation(input, {
       state: () => state,
       complete: qwenCompletion(provider, fetch, voiceSettings(provider.voice, '', contactsOf(state)).tools),
       execute: async tool => { const action = toolAction(state, tool); if (!action) return bankToolResult(state); const previous = state; commit(action, tool.utterance, tool.turnId); steps++; return operationToolResult(previous, state, tool); },
      }, signal).catch(error => {
       if (!steps || context.signal.aborted) throw error;
       return { status: 'unknown' as const, summary: '这次办理结果尚未确认，需要先核对业务卡片的最新进度，不要重复提交。', toolCalls: steps, facts: bankToolResult(state), instruction: '只说明需要核对卡片，不再调用工具。' };
      });
     }
     const tool = toolCall.parse({ name, arguments: args, utterance: context.utterance, history: context.history, turnId: context.turnId });
     if (tool.name === 'bank_request') realtimeToolArgumentsFor(contactsOf(state)).parse(tool.arguments);
     const action = toolAction(state, tool);
     if (!action) return bankToolResult(state);
     const previous = state; commit(action, tool.utterance, tool.turnId);
     return operationToolResult(previous, state, tool);
    } catch (error) { if (context.signal.aborted) throw error; throw asHttp(error); }
   }),
   onSuperviseReply: context => tracked(async () => {
    if (turn) turn.supervisions++;
    const revision = state.revision;
    const input = supervisionInput.parse({ utterance: context.utterance, history: context.history, turnId: context.turnId, targetTaskId: targets.get(context.turnId), attempts: context.attempts,
     reason: context.error ? 'tool_error' : context.toolCalls ? 'completed' : 'no_call', ...(context.error ? { error: context.error.slice(0, 500) } : {}), reply: context.reply.slice(0, 8000),
     startRevision: snapshots.get(context.turnId) ?? revision, repairAttempt: context.repairAttempt, checkpoint: context.checkpoint, tracking: context.tracking });
    const result = await superviseReply(state, input, provider, AbortSignal.any([context.signal, AbortSignal.timeout(9000)]));
    if (state.revision !== revision) { owner.conversation.observeState(JSON.stringify(bankToolResult(state))); return { ...result, stale: true }; }
    return result;
   }),
   onReconcileReply: context => tracked(async () => {
    if (turn) turn.reviews++;
    const current = state.workflows?.tasks.find(t => t.id === state.workflows?.currentTaskId), confirmation = explicitWorkflowConfirmation(state, context.utterance);
    if (!context.repairAttempt && current?.functionId === 'IN05' && confirmation) {
     const before = state; commit({ type: 'workflow', command: { ...confirmation, source: 'voice', utterance: context.utterance, turnId: context.turnId } } as BankAction, context.utterance, context.turnId);
     return { decision: 'repair' as const, facts: operationToolResult(before, state, { name: 'bank_function', arguments: confirmation }), toolAttempted: true, message: '已按用户本轮对当前卡片的明确确认提交沙箱测评；按实际回执报告，不重复提交。' };
    }
    const review = replyReviewInput.parse({ utterance: context.utterance, history: context.history, turnId: context.turnId, targetTaskId: targets.get(context.turnId), attempts: context.attempts,
     reason: context.error ? 'tool_error' : context.toolCalls ? 'completed' : 'no_call', ...(context.error ? { error: context.error.slice(0, 500) } : {}), reply: context.reply.slice(0, 8000), alreadySpoken: true, concern: context.concern,
     startRevision: snapshots.get(context.turnId) ?? state.revision, repairAttempt: context.repairAttempt });
    const before = state, result = await reviewReply(state, review, provider, AbortSignal.any([context.signal, AbortSignal.timeout(35000)]));
    if (result.action) commit(result.action, review.utterance, review.turnId);
    const recent = state.workflows?.log.filter(log => (log.revision ?? -1) > review.startRevision).at(-1);
    const query = result.decision !== 'accept' ? queryReviewFacts(state, review.utterance, review.startRevision) : undefined;
    const repairScope = query ? 'query' as const : result.repairScope;
    const facts = query ? { revision: state.revision, originalRequest: review.utterance, startRevision: review.startRevision, query }
     : repairScope === 'explanation' ? { revision: state.revision, originalRequest: review.utterance, explanation: explanationReviewFacts(state, review.startRevision) }
     : result.action?.type === 'workflow' ? operationToolResult(before, state, { name: 'bank_function', arguments: result.action.command } as never)
     : recent ? operationToolResult(state, state, { name: 'bank_function', arguments: { operation: recent.operation, taskId: recent.taskId } } as never) : bankToolResult(state);
    return { decision: result.decision, facts, message: result.message, repairScope, toolAttempted: !!result.action };
   }),
  };
 }

 /** What the user heard this turn: every audible reply, re-transcribed and checked. */
 async function playback(t: VoiceTurn, index: number, t0: number) {
  const mine = [...replies.entries()].filter(([, r]) => r.turn === index && r.audible.length);
  if (!mine.length) { if (!t.interruptions.some(i => i.kind === 'session_failed')) t.interruptions.push({ kind: 'audio', message: '这一轮没有任何语音播报' }); return; }
  t.firstAudioMs = mine[0][1].firstAudible! - (opts.audioVoice && speechStoppedAt > t0 ? speechStoppedAt : t0);
  for (const [id, r] of mine) {
   const pcm = Buffer.concat(r.audible), seconds = pcm.length / 2 / OUT_RATE, file = decodeURIComponent(new URL(`${opts.tag || 'case'}-t${index + 1}-${id.slice(-8)}.wav`, audioDir).pathname);
   writeFileSync(file, wavOf(pcm, OUT_RATE));
   const quiet = silences(pcm, OUT_RATE);
   const heard = seconds > 0.3 ? await transcribeFile(file).catch(error => `（复听失败：${String(error).slice(0, 60)}）`) : '';
   const score = similarity(r.transcript, heard);
   t.playback.push({ file, seconds: Math.round(seconds * 10) / 10, transcript: r.transcript, heard, similarity: Math.round(score * 100) / 100, leadSilence: quiet.lead, longestGap: quiet.gap, cut: r.cut });
   if (r.cut) t.interruptions.push({ kind: 'audio', message: `播报到一半被掐断（“${r.transcript.slice(0, 24)}”）` });
   if (r.transcript && seconds < 0.3) t.interruptions.push({ kind: 'audio', message: `有文字没有声音（“${r.transcript.slice(0, 24)}”）` });
   if (seconds > 0.3 && score < 0.7) t.interruptions.push({ kind: 'audio', message: `播报和文字记录不一致（相似度 ${score.toFixed(2)}）`, detail: `文字：${r.transcript} ｜ 听到：${heard}` });
   if (quiet.lead > 1.5) t.interruptions.push({ kind: 'audio', message: `开口前静音 ${quiet.lead.toFixed(1)} 秒` });
   if (quiet.gap > 1.5) t.interruptions.push({ kind: 'audio', message: `播报中途停顿 ${quiet.gap.toFixed(1)} 秒` });
   if (/嗯|呃|唉|哎/.test(heard) && !/嗯|呃|唉|哎/.test(r.transcript)) t.interruptions.push({ kind: 'audio', message: `播报里有文字记录之外的语气声（“${heard.slice(0, 24)}”）` });
  }
 }

 const turns: VoiceTurn[] = [];
 for (const text of turnsText) {
  turnIndex++;
  turn = { text, ms: 0, reply: '', playback: [], interruptions: [], delegations: 0, toolCalls: 0, supervisions: 0, reviews: 0 }; retryUsed = false;
  const t0 = Date.now();
  if (opts.audioVoice) {
   const file = decodeURIComponent(new URL(`../../outputs/eval-speech-audio/${speechKey(opts.audioVoice, text)}.wav`, import.meta.url).pathname);
   if (!existsSync(file)) throw new Error(`没有 ${opts.audioVoice} 读“${text}”的录音，请先运行 speech.ts`);
   session ??= new Session();
   await Promise.race([session.ready, sleep(READY_CAP_MS)]);
   if (!session.isReady) { turn.error = '语音启动超时'; session.close(); } else await session.speak(file);
  } else {
   // Like page.connectLive: input typed before the session is ready is queued and sent on ready.
   if (!session) session = new Session(text); else if (!session.isReady) session.queued = [session.queued, text].filter(Boolean).join('\n'); else session.conversation.userText(text);
   await Promise.race([session.ready, sleep(READY_CAP_MS)]);
   if (session && !session.isReady) { turn.error = '语音启动超时'; session.close(); }
  }
  touch();
  // A turn ends when the controller is idle, no backend call is open and nothing happened for a moment.
  while (Date.now() - t0 < TURN_CAP_MS) {
   await new Promise(done => setTimeout(done, 250));
   if (inflight === 0 && (!session || session.idle()) && Date.now() - last > QUIET_MS) break;
  }
  if (Date.now() - t0 >= TURN_CAP_MS) { turn.error = '本轮超过两分钟仍未结束'; note('stall', '本轮超过两分钟仍未结束'); }
  turn.ms = Date.now() - t0;
  turn.heard = [...userItems.values()].filter(u => u.turn === turnIndex).map(u => u.text).join(' / ') || undefined;
  if (opts.audioVoice) await playback(turn, turnIndex, t0);
  turns.push(turn);
 }
 session?.close();
 await new Promise(done => setTimeout(done, 200));
 return { state, turns };
}
