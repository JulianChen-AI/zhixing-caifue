"use client";
import { WealthGoose } from "@/components/wealth-goose";
import { mascotCue } from "@/lib/mascot/scenario";
import { BankRequestError } from '@/lib/bank/request-error';

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, ArrowUpRight, Check, CheckCheck, ChevronDown, ChevronLeft, CircleHelp, CreditCard, Ellipsis, Headphones, Keyboard, List, LoaderCircle, LockKeyhole, MessageCircle, Mic, MicOff, RotateCcw, ShieldCheck, Volume2, VolumeX, Wallet, X } from "lucide-react";
import { type BankAction, type BankState } from "@/lib/bank/types";
import { contactsOf } from '@/lib/bank/recipients';
import { money } from "@/lib/bank/money";
import { MAX_TRANSFER_CENTS } from '@/lib/checklists/limits';
import { LiveVoice } from "@/lib/voice/live";
import { stopOnPageExit } from '@/lib/voice/lifecycle';
import { bankToolResult } from "@/lib/bank/tool-state";
import type { NativeToolArguments,SpeechVerdict,StalledTurn,ObserverVerdict } from '@/lib/voice/qwen-protocol';
import type { ToolContext } from "@/lib/voice/qwen-protocol";
import { businessTitle, cardCaption, replyForState, userMessage } from '@/lib/ui/presentation';
import { WorkflowPanel, WorkflowOutcome } from '@/components/workflow-panel';
import { FlowSelect } from '@/components/flow-select';
import { completedSideQuery } from '@/lib/ui/business';
import { SerialStage, TaskHistory, ConversationHistory } from '@/components/serial-stage';
import {MonthlyPlan} from '@/components/monthly-plan';
import {useWideLayout,ChatFeed,TaskMap,RecordList} from '@/components/desk';
import {CardHead,Row} from '@/components/card-kit';
import {CancelTask,PendingBar} from '@/components/cancel-task';
import {AccountsViz,MoneyFlow,yuan} from '@/components/card-viz';
import {cardHead} from '@/lib/ui/cards';
import { explicitLiveCommand,explicitWorkflowConfirmation,explicitWorkflowCancellation } from '@/lib/workflows/offline';
import {sessionContext,compactVoiceResult} from '@/lib/voice/session-context';
import {SupervisionTracker} from '@/lib/voice/supervision-tracker';
import {explanationReviewFacts,EXPLANATION_REPAIR_INSTRUCTION} from '@/lib/voice/explanation-review';
import {queryReviewFacts,QUERY_REPAIR_INSTRUCTION} from '@/lib/voice/query-review';
import type {ContextRenewal} from '@/lib/voice/qwen-protocol';
import {SCENE_MANIFEST} from '@/lib/demo/scenes';
import {businessDay} from '@/lib/demo/clock';
import {demoControlReplay} from '@/lib/demo/control-receipt';
import {isWrite} from '@/lib/workflows/write-kind';

type Message = { id: string; speaker: "user" | "assistant"; text: string; start?: number; end?: number };
type Mode = "idle" | "demo" | "live";
const TEXT_ENTRY='input:not([type=checkbox]):not([type=radio]),select,textarea';

// The voice model's own malformed or out-of-order tool call: it gets the error back and retries, so the user is not alarmed.
const MODEL_SLIP=/白名单|字符串数组|布尔值|JSON|参数格式|不支持的参数|数值字段格式|当前外层步骤|外层步骤尚未/;

export default function Home() {
  const turnSnapshots=useRef(new Map<string,number>());
  const turnTargets=useRef(new Map<string,string|undefined>());
  const [verifiedReply,setVerifiedReply]=useState('');
  const [bank, setBank] = useState<BankState | null>(null), bankRef = useRef<BankState | null>(null);
  const [configured, setConfigured] = useState(false);
  const [mode, setMode] = useState<Mode>("idle"), modeRef = useRef<Mode>("idle");
  const [phase, setPhase] = useState("idle"), [connecting, setConnecting] = useState(false), [closing, setClosing] = useState(false);
  const [muted, setMuted] = useState(false), [sound, setSound] = useState(true), soundRef = useRef(true);
  const [messages, setMessages] = useState<Message[]>([]), transcriptRef = useRef<Message[]>([]);
  const [drawer, setDrawer] = useState<"settings" | "transcript" | "connect" | "reset" | "businesses" | "tasks" | "query" | "scenes" | null>(null);
  const [queryResultId,setQueryResultId]=useState<string|null>(null);
  const [composer, setComposer] = useState(false), [input, setInput] = useState("");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [recovering, setRecovering] = useState(false), [micOpening, setMicOpening] = useState(false);
  const [slow, setSlow] = useState(false);
  const [sceneSwitching,setSceneSwitching]=useState(false),sceneSwitchingRef=useRef(false);
  const [sceneNotice,setSceneNotice]=useState('');
  const [selectedScene,setSelectedScene]=useState('S01'),[confirmScene,setConfirmScene]=useState(false);
  const voiceSequence=useRef(0);
  const [formFocused, setFormFocused] = useState(false);
  const wide = useWideLayout();
  const [viewportHeight, setViewportHeight] = useState<number>();
  useEffect(() => {
    const update = () => setViewportHeight(window.visualViewport?.height || window.innerHeight);
    update(); window.visualViewport?.addEventListener("resize", update); window.addEventListener("resize", update);
    return () => { window.visualViewport?.removeEventListener("resize", update); window.removeEventListener("resize", update); };
  }, []);
  const [amount, setAmount] = useState(""), [code, setCode] = useState("");
  const voice = useRef<LiveVoice | null>(null), generation = useRef(0), pending = useRef<AbortController | null>(null), speechId = useRef(0);
  const supervisionTracker=useRef(new SupervisionTracker());
  const reconnectForInput=useRef<(text:string)=>Promise<void>>(async()=>{});
  const preferLive=useRef(false);
  // Whether a voice session should open the microphone; typing works either way.
  const micWanted=useRef(true);
  const queuedInput=useRef<string|null>(null);
  const recoveryRunning=useRef(false);
  const mounted=useRef(true);
  const renewing=useRef(false);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const task = bank?.task;
  const showCard = !!bank && (bank.view === 'workflow' || bank.view === "balance" || (bank.view === "transfer" && !!task));
  const activeTask = task && !["complete", "cancelled"].includes(task.step);
  const confirmationIndex = bank?.checklist?.checks.findIndex(check => check.id.endsWith(".user.confirmed")) ?? -1;
  const canConfirm = confirmationIndex >= 0 && !bank?.routing?.unresolved.length && bank!.checklist!.checks.slice(0,confirmationIndex).every(check=>check.status === "passed");
  const amountCents=/^\d+(?:\.\d{1,2})?$/.test(amount.trim())?Math.round(Number(amount.trim())*100):null;
  const amountValid=amountCents!=null&&Number.isSafeInteger(amountCents)&&amountCents>0&&amountCents<=MAX_TRANSFER_CENTS;
  const amountDirty=amount.trim()!==''&&(!amountValid||amountCents!==task?.amount);

  const showError = useCallback((text: string) => {
    setError(userMessage(text));
  }, []);
  const applyState = useCallback((state: BankState) => {
    if (bankRef.current && state.revision < bankRef.current.revision) return;
    bankRef.current = state; setBank(state);
  }, []);
  const presentState=useCallback((previous:BankState|null,next:BankState)=>{
    const query=completedSideQuery(previous,next);
    setQueryResultId(query?.id||null);setDrawer(query?'query':null);
  },[]);
  const refresh = useCallback(async (signal?:AbortSignal,scope?:{epoch:string|undefined}) => {
    const turn=generation.current;
    const response = await fetch("/api/bank", { cache: "no-store",signal }); const data = await response.json() as { state: BankState; liveConfigured: boolean; error?: string };
    if (!response.ok) throw new Error(data.error);
    signal?.throwIfAborted();
    if(turn!==generation.current || scope && (bankRef.current?.sceneEpoch!==scope.epoch || data.state.sceneEpoch!==scope.epoch))throw new DOMException('场景已改变','AbortError');
    applyState(data.state); setConfigured(data.liveConfigured); return data.state as BankState;
  }, [applyState]);
  useEffect(() => {
    mounted.current=true;
    const controller=new AbortController();
    const exit=()=>{preferLive.current=false;queuedInput.current=null;generation.current++;pending.current?.abort();controller.abort();void voice.current?.stop();speechId.current++;window.speechSynthesis?.cancel();if(errorTimer.current)clearTimeout(errorTimer.current)};
    const detach=stopOnPageExit(exit);
    void refresh(controller.signal).catch(e=>{if(!controller.signal.aborted)showError(e.message)});
    return()=>{mounted.current=false;detach();exit()};
  }, [refresh, showError]);
  useEffect(() => { setAmount(task?.amount != null ? String(task.amount / 100) : ""); setCode(""); }, [task?.amount, task?.step, task?.verificationId]);
  useEffect(() => { setFormFocused(false); }, [bank?.revision, drawer]);
  const addMessage = useCallback((speaker: "user" | "assistant", text: string) => {
    if (!text) return;
    const next = [...transcriptRef.current, { id: crypto.randomUUID(), speaker, text: speaker === "assistant" ? userMessage(text) : text }].slice(-80);
    transcriptRef.current = next; setMessages(next);
  }, []);
  useEffect(() => {
    setSlow(false);
    if (!busy) return;
    const timer = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(timer);
  }, [busy]);
  const stopSpeech = useCallback(() => { speechId.current++; window.speechSynthesis?.cancel(); }, []);
  const speak = useCallback(async (text: string) => {
    // Device speech is exclusive to an explicitly selected demo session.
    if (modeRef.current !== "demo" || voice.current) return;
    stopSpeech(); if (!soundRef.current || !("speechSynthesis" in window)) { setPhase("idle"); return; }
    const id = speechId.current, utterance = new SpeechSynthesisUtterance(text); utterance.lang = "zh-CN"; utterance.rate = 1.03;
    let voices = speechSynthesis.getVoices();
    if (!voices.length) {
      await new Promise<void>(resolve => {
        const finish = () => { clearTimeout(timer); speechSynthesis.removeEventListener("voiceschanged", finish); resolve(); };
        const timer = setTimeout(finish, 1500);
        speechSynthesis.addEventListener("voiceschanged", finish, { once: true });
      });
      voices = speechSynthesis.getVoices();
    }
    if (id !== speechId.current || modeRef.current !== "demo" || voice.current) return;
    // Web Speech exposes no gender field; select known Chinese female voices.
    const preferred = ["Tingting", "Ting-Ting", "婷婷", "Xiaoxiao", "晓晓", "Xiaoyi", "晓伊", "Huihui", "慧慧", "Meijia", "美佳", "Sinji", "善怡", "Flo", "Shelley", "Sandy"];
    const chinese = voices.filter(v => /^zh(?:-|_)/i.test(v.lang));
    const female = preferred.map(name => chinese.find(v => v.name.toLowerCase().includes(name.toLowerCase()))).find(Boolean);
    if (!female) {
      setPhase("idle");
      showError("未找到可用的系统中文女声，已暂停设备播报。可连接 Qwen 实时语音使用 Tina 音色。");
      return;
    }
    utterance.voice = female;
    utterance.lang = female.lang;
    utterance.onstart = () => { if (id === speechId.current) setPhase("speaking"); };
    utterance.onend = utterance.onerror = () => { if (id === speechId.current) setPhase("idle"); };
    speechSynthesis.speak(utterance);
  }, [stopSpeech, showError]);
  const request = useCallback(async (payload: Record<string, unknown>, signal?: AbortSignal, toolRequestId?: string,acceptResult?:(data:{toolResult?:unknown;delegation?:unknown})=>void,scope?:{epoch:string|undefined;revision?:number},url='/api/bank') => {
    const epoch=scope?scope.epoch:bankRef.current?.sceneEpoch, turn=generation.current;
    const requestId = toolRequestId || crypto.randomUUID();
    const isControl=typeof payload.action==='object'&&payload.action!==null&&['load_scene','advance_clock','reset'].includes(String((payload.action as {type?:string}).type));
    const deadline=AbortSignal.timeout(30000),requestSignal=signal?AbortSignal.any([signal,deadline]):deadline;
    try {
    for (let attempt = 0; attempt < 2; attempt++) {
      requestSignal.throwIfAborted();
      const current = bankRef.current || await refresh(requestSignal);
      if(turn!==generation.current || current.sceneEpoch!==epoch)throw new DOMException('场景已改变','AbortError');
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, requestId, revision: scope?.revision??current.revision, ...(epoch?{sceneEpoch:epoch}:{}) }), signal:requestSignal });
      let data:{ state: BankState; error?: string;code?:string;toolResult?:unknown;delegation?:unknown };
      try{data=await response.json() as typeof data;}catch(error){if(response.status>=400&&response.status<500)throw new BankRequestError('操作未完成，请刷新核对。',response.status);throw error;}
      if (response.status === 409 && data.code!=='scene_changed' && !isControl) { await refresh(requestSignal,{epoch}); if (attempt === 0 && (payload.command||payload.delegation&&data.code==='delegation_not_started')) continue; }
      if (!response.ok) throw new BankRequestError(data.error || "操作未完成，请重试。",response.status,data.code);
      requestSignal.throwIfAborted();
      if(turn!==generation.current || bankRef.current?.sceneEpoch!==epoch)throw new DOMException('场景已改变','AbortError');
      if(!isControl&&data.state.sceneEpoch!==epoch)throw new DOMException('场景已改变','AbortError');
      applyState(data.state);acceptResult?.(data); return data.state as BankState;
    }
    throw new Error("信息刚刚发生变化，请重试。");
    } catch(error) {
      if((deadline.aborted||error instanceof TypeError)&&!signal?.aborted){
        // A lost response does not prove a write failed. Reconcile facts once,
        // bounded separately, without replaying the mutation or its confirmation.
        if(!isControl)try{await refresh(signal?AbortSignal.any([signal,AbortSignal.timeout(5000)]):AbortSignal.timeout(5000),{epoch});}catch{}
        throw new Error('办理请求超时，结果尚未确认。请先核对卡片最新进度，不要重复提交；网络恢复后可以继续办理。');
      }
      throw error;
    }
  }, [applyState, refresh]);
  const runCommand = useCallback(async (text: string, origin: "text" | "live" = "text"): Promise<string | null> => {
    if (!text.trim() || sceneSwitchingRef.current) return null;
    if(origin==='text'&&preferLive.current&&recoveryRunning.current){queuedInput.current=[queuedInput.current,text].filter(Boolean).join('\n');return null;}
    if(origin==='text')setDrawer(null);
    if(origin==='text'&&modeRef.current==='idle'&&preferLive.current){await reconnectForInput.current(text);return null;}
    if (origin === "text" && modeRef.current === "live" && voice.current) {if(voice.current.readOnly){await voice.current.stop();await reconnectForInput.current(text);}else voice.current.userText(text); return null; }
    const turn = ++generation.current; pending.current?.abort(); const controller = new AbortController(); pending.current = controller;
    stopSpeech(); setBusy(true); setPhase("thinking"); setError(""); setVerifiedReply('');
    // Earlier turns let "这张卡/那笔" point at what was just discussed; only words already on screen are sent.
    const history:{user:string;reply:string}[]=[];for(const m of transcriptRef.current){if(m.speaker==='user')history.push({user:m.text.slice(0,300),reply:''});else if(history.length&&!history.at(-1)!.reply)history.at(-1)!.reply=m.text.slice(0,200);}
    if (origin === "text") addMessage("user", text);
    if (modeRef.current === "idle") { modeRef.current = "demo"; setMode("demo"); }
    try {
      const previous=bankRef.current;
      const state = await request({ command: text, history: history.slice(-6), mode: modeRef.current === "live" ? "live" : "demo" }, controller.signal);
      if (turn !== generation.current) return null;
      presentState(previous,state);
      if (origin === "text") {
        if (modeRef.current === "live") { addMessage("assistant", replyForState(state)); voice.current?.contextUpdate(JSON.stringify(bankToolResult(state))); }
        else { addMessage("assistant", replyForState(state)); speak(replyForState(state)); }
      }
      return state.lastReply;
    } catch (e) {
      // The reason also goes into the conversation, so a refused request is never answered with silence.
      if (turn === generation.current && !(e instanceof DOMException && e.name === "AbortError")) { showError((e as Error).message); if (origin === "text") addMessage("assistant", userMessage((e as Error).message)); return "这次操作尚未完成，请查看页面提示。"; }
      return null;
    } finally { if (turn === generation.current) { setBusy(false); setPhase("idle"); } }
  }, [addMessage, presentState, request, showError, speak, stopSpeech]);
  const runAction = useCallback(async (action: BankAction) => {
    if (busy || sceneSwitchingRef.current) return;
    const turn = ++generation.current; pending.current?.abort(); stopSpeech(); setBusy(true); setPhase("thinking"); setError(""); setVerifiedReply('');
    const controller=new AbortController();pending.current=controller;
    try {
      const previous=bankRef.current;
      const payload=action.type==='workflow'||action.type==='plan'?{type:action.type,command:Object.fromEntries(Object.entries(action.command).filter(([key])=>!['source','utterance','history','turnId'].includes(key)))}:action;
      const state = await request({ action:payload },controller.signal); if (turn !== generation.current) return;
      presentState(previous,state);
      if (modeRef.current === "live") { addMessage("assistant", replyForState(state)); voice.current?.contextUpdate(JSON.stringify(bankToolResult(state))); }
      else { addMessage("assistant", replyForState(state)); speak(replyForState(state)); }
      if (action.type === "reset") { supervisionTracker.current.clear();setDrawer(null); transcriptRef.current = []; setMessages([]); }
    } catch (e) { if(!controller.signal.aborted&&turn===generation.current)showError((e as Error).message); }
    finally { if (turn === generation.current) { setBusy(false); setPhase("idle"); } }
  }, [addMessage, busy, presentState, request, showError, speak, stopSpeech]);
  const runTool = useCallback(async (name: string, args: NativeToolArguments, context: ToolContext,session:LiveVoice) => {
    if(voice.current!==session||session.signal.aborted||sceneSwitchingRef.current||bankRef.current?.sceneEpoch!==session.sceneEpoch)throw new DOMException('对话已结束','AbortError');
    if (!['bank_request','bank_function','bank_plan','bank_delegate'].includes(name)) return {status:'unsupported',message:'未执行任何业务。工具名支持bank_request、bank_function和bank_plan；确认当前业务请调用bank_function，operation为confirm，传当前taskId和token。'};
    try{
      let toolResult:unknown;
      const previous=bankRef.current;
      const state = name==='bank_delegate'
        ?await request({delegation:{utterance:context.utterance,history:context.history,turnId:context.turnId,...(typeof (args as {request?:unknown}).request==='string'?{request:String((args as {request:string}).request).slice(0,400)}:{})}},context.signal,context.requestId,data=>{toolResult=data.delegation},{epoch:session.sceneEpoch},'/api/bank/delegate')
        :await request({tool:{name,arguments:args,utterance:context.utterance,history:context.history,turnId:context.turnId}},context.signal,context.requestId,data=>{toolResult=data.toolResult},{epoch:session.sceneEpoch});
      if(voice.current!==session||session.signal.aborted||sceneSwitchingRef.current||bankRef.current?.sceneEpoch!==session.sceneEpoch)throw new DOMException('对话已结束','AbortError');
      if(!previous||state.revision>previous.revision)presentState(previous,state);
      setError("");
      return toolResult||bankToolResult(state);
    }catch(error){
      if(context.signal.aborted&&voice.current===session&&!session.signal.aborted){
        const current=await refresh(session.signal,{epoch:session.sceneEpoch});
        if(voice.current===session&&!session.signal.aborted)session.syncFacts(JSON.stringify(bankToolResult(current)));
      }
      throw error;
    }
  },[presentState,request,refresh]);
  const startDemo = () => { if (voice.current || connecting || closing || sceneSwitchingRef.current) return;preferLive.current=false;queuedInput.current=null; setDrawer(null); setMode("demo"); modeRef.current = "demo"; setComposer(true); addMessage("assistant", "你好，今天想办点什么？"); speak("你好，今天想办点什么？"); };
  const connectLive = async (receiptOnly?:BankState,initialInput?:string,automaticRetry=false,receiptFacts?:unknown,handoffContext?:string,hideInitialInput=false,initialState?:BankState,sceneReconnection=false) => {
    if(!mounted.current||document.visibilityState!=='visible'||sceneSwitchingRef.current)return;
    if(initialInput)queuedInput.current=(automaticRetry||handoffContext?[initialInput,queuedInput.current]:[queuedInput.current,initialInput]).filter(Boolean).join('\n');
    if(renewing.current)return;
    // React's connecting/closing values can still describe the session that just
    // stopped. The live instance is assigned synchronously before start(), and
    // cleared by onClose, so use it to guard handoffs between connections.
    if (!configured || voice.current) return;
    preferLive.current=true;
    generation.current++; pending.current?.abort(); setBusy(false);
    stopSpeech(); setConnecting(true); setDrawer(null); setPhase("connecting");
    let replayInputPending=automaticRetry,retryUsedForTurn=automaticRetry,hideTranscript=automaticRetry||hideInitialInput;
    const queryFacts=receiptFacts as {explanation?:unknown;query?:unknown;originalRequest?:string;startRevision?:number}|undefined;
    const scopedRequest=receiptOnly&&(queryFacts?.explanation||queryFacts?.query)?String(queryFacts.originalRequest||''):'';
    const readOnlyPrompt=scopedRequest||'只报告已经核实的当前办理进度，不修改或提交任何业务。';
    let readOnlyInitialPending=!!receiptOnly,sceneReady=false;
    const sessionState=initialState||receiptOnly||bankRef.current;
    if(!sessionState||sessionState.sceneEpoch!==bankRef.current?.sceneEpoch){setConnecting(false);setPhase('idle');return;}
    const seq=++voiceSequence.current;
    const valid=()=>voice.current===v&&!v.signal.aborted&&!sceneSwitchingRef.current&&bankRef.current?.sceneEpoch===v.sceneEpoch&&seq===voiceSequence.current;
    const validStall=()=>!sceneSwitchingRef.current&&seq===voiceSequence.current&&bankRef.current?.sceneEpoch===v.sceneEpoch&&(voice.current===v||voice.current===null);
    const v:LiveVoice = new LiveVoice({
      supervisionTracker:receiptOnly?undefined:supervisionTracker.current,
      readOnly:!!receiptOnly,
      readOnlyInstructions:scopedRequest?(queryFacts?.query?QUERY_REPAIR_INSTRUCTION:EXPLANATION_REPAIR_INSTRUCTION)+'\n'+JSON.stringify(receiptFacts):undefined,
      onUserInput:receiptOnly?text=>{if(!valid())return;if(readOnlyInitialPending&&text===readOnlyPrompt){readOnlyInitialPending=false;return;}void v.stop().then(()=>reconnectForInput.current(text));}:()=>{if(!valid())return;if(replayInputPending)replayInputPending=false;else retryUsedForTurn=false;},
      initialContext:handoffContext||(receiptFacts?JSON.stringify(compactVoiceResult(receiptFacts)):sessionContext(sessionState)),
      initialContacts:contactsOf(sessionState),initialSceneEpoch:sessionState.sceneEpoch,initialRevision:sessionState.revision,
      onDiagnostic:diagnostic=>{if(!valid())return;try{const prior=JSON.parse(sessionStorage.getItem('zx_voice_diagnostics')||'[]');sessionStorage.setItem('zx_voice_diagnostics',JSON.stringify([...(Array.isArray(prior)?prior:[]).slice(-5),diagnostic]));}catch{}},
      onContextRenewal:receiptOnly?undefined:context=>{if(valid())void renewContext(context,{epoch:v.sceneEpoch});},
      onHaltedRecovery:receiptOnly?undefined:facts=>{if(valid())void recoverPending(undefined,facts,{epoch:v.sceneEpoch})},
      onBusy: value => { if(!valid())return;setBusy(value); setPhase(value ? "thinking" : "listening"); },
      onReady: () => { if(!valid())return;sceneReady=true;if(sceneReconnection)setSceneNotice('场景已加载，语音已连接。');setConnecting(false); setMode("live"); modeRef.current = "live"; setPhase("listening");
        const input=queuedInput.current;queuedInput.current=null;
        if(receiptOnly&&input){void v.stop().then(()=>reconnectForInput.current(input));return;}
        if(receiptOnly)v.userText(readOnlyPrompt);else if(input)v.userText(input);
      },
      onClose: finalized => { if(voice.current!==v)return;if(sceneReconnection&&!sceneReady&&!finalized&&!sceneSwitchingRef.current&&bankRef.current?.sceneEpoch===v.sceneEpoch)setSceneNotice('场景已加载，语音未连接。');generation.current++; pending.current?.abort(); setBusy(false); voice.current = null; setConnecting(false); setClosing(false); setMuted(false); setMode("idle"); modeRef.current = "idle"; setPhase("idle"); },
      onError: message=>{if(valid()){if(sceneReconnection&&!sceneReady)setSceneNotice('场景已加载，语音未连接。');showError(message);}}, onToolIssue: message=>{if(valid()&&!MODEL_SLIP.test(message))showError(message);},
      onMicrophoneUnavailable: message => { if(!valid())return; micWanted.current=false; setMuted(true); showError(message); },
      literalCommandFor: receiptOnly?undefined:text => {if(!valid())return undefined;const command=bankRef.current?explicitLiveCommand(bankRef.current,text):undefined;return command?.operation==='run'?undefined:command;},
      onLiteralResult: reply => {if(valid())addMessage('assistant',reply)},
      onStall: context => { if(!validStall())return;if(receiptOnly)showError('后台进度已显示，语音播报未完成。');else void recoverPending(retryUsedForTurn?undefined:context,undefined,{epoch:v.sceneEpoch}); },
      onPlayback: playing=>{if(!valid())return;setPhase(playing?'speaking':'listening');},
      onPlaybackEnded:receiptOnly?()=>{void v.stop().then(()=>{if(validStall()&&preferLive.current)void connectLive();});}:undefined,
      onReplyVerified:(_id,text)=>{if(valid())setVerifiedReply(text)},
      onReplyComplete:(_id,text)=>{if(valid())setVerifiedReply(text)},
      onReplyDiscarded:receiptOnly?()=>{void v.stop().then(()=>{if(validStall()&&preferLive.current)void connectLive();});}:undefined,
      onLevel: () => {},
      onInterrupt: () => { if(!valid())return;generation.current++; pending.current?.abort(); setBusy(false); setPhase("listening"); },
      onTranscript: (speaker, text, itemId) => {
        if(!valid())return;
        if(speaker==='user'&&!turnSnapshots.current.has(itemId)){
          setVerifiedReply('');const state=bankRef.current;
          turnSnapshots.current.set(itemId,state?.revision||0);
          turnTargets.current.set(itemId,state?.view==='workflow'?state.workflows?.currentTaskId??undefined:undefined);
          if(turnSnapshots.current.size>100){const oldest=turnSnapshots.current.keys().next().value!;turnSnapshots.current.delete(oldest);turnTargets.current.delete(oldest);}
        }
        if(receiptOnly&&speaker==='user')return;
        if(hideTranscript&&speaker==='user'&&text===initialInput){hideTranscript=false;return;}
        if (speaker === "assistant") { setVerifiedReply(''); setPhase("speaking"); }
        const displayText = speaker === "assistant" && /^(?:local-|review-)/.test(itemId) ? userMessage(text) : text;
        const all = [...transcriptRef.current], id = `${speaker}:${itemId}`, index = all.findIndex(m => m.id === id);
        if (index >= 0) all[index] = { ...all[index], text: displayText };
        else all.push({ id, speaker, text: displayText });
        transcriptRef.current = all.slice(-80); setMessages(transcriptRef.current);
      },
      onSuperviseReply:receiptOnly?undefined:async context=>{
        const state=bankRef.current;if(!state)return {decision:'continue' as const,unavailable:true};
        const response=await fetch('/api/bank/supervise',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.any([context.signal,AbortSignal.timeout(9000)]),body:JSON.stringify({revision:state.revision,review:{utterance:context.utterance,history:context.history,turnId:context.turnId,targetTaskId:turnTargets.current.get(context.turnId),attempts:context.attempts,reason:context.error?'tool_error':context.toolCalls?'completed':'no_call',...(context.error?{error:context.error.slice(0,500)}:{}),reply:context.reply.slice(0,8000),startRevision:turnSnapshots.current.get(context.turnId)??state.revision,repairAttempt:context.repairAttempt,checkpoint:context.checkpoint,tracking:context.tracking}})});
        if(!response.ok)return {decision:'continue' as const,unavailable:true};
        const result=await response.json() as ObserverVerdict&{revision?:number};
        context.signal.throwIfAborted();
        if(voice.current!==v||v.signal.aborted)return {decision:'continue' as const,stale:true};
        if(result.stale||bankRef.current?.revision!==state.revision){const fresh=await refresh(context.signal);v.observeState(JSON.stringify(bankToolResult(fresh)));return {...result,stale:true};}
        return result;
      },
      onReconcileReply: async context=>{
        try{
        if(!valid())throw new DOMException('对话已结束','AbortError');
        const before=bankRef.current,state=await refresh(context.signal,{epoch:v.sceneEpoch});
        if(before&&state.revision>before.revision)presentState(before,state);
        // Only the user's literal acknowledgement of the current card authorizes this
        // UI-equivalent fallback. Flash never proposes or authorizes confirmation.
        const current=state.workflows?.tasks.find(t=>t.id===state.workflows?.currentTaskId),confirmation=explicitWorkflowConfirmation(state,context.utterance);
        if(!context.contentOnly&&!receiptOnly&&!context.repairAttempt&&current?.functionId==='IN05'&&confirmation){
          const facts=await runTool('bank_function',confirmation,{...context,requestId:'voice-literal-'+crypto.randomUUID()},v);
          return {decision:'repair' as const,facts,toolAttempted:true,message:'已按用户本轮对当前卡片的明确确认提交沙箱测评；按实际回执报告，不重复提交。'};
        }
        const response=await fetch('/api/bank/review',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.any([context.signal,AbortSignal.timeout(35000)]),body:JSON.stringify({requestId:context.requestId,revision:state.revision,...(v.sceneEpoch?{sceneEpoch:v.sceneEpoch}:{}),review:{utterance:scopedRequest||context.utterance,history:context.history,turnId:context.turnId,targetTaskId:receiptOnly?undefined:turnTargets.current.get(context.turnId),attempts:context.attempts,reason:context.error?'tool_error':context.toolCalls?'completed':'no_call',...(context.error?{error:context.error.slice(0,500)}:{}),reply:context.reply.slice(0,8000),alreadySpoken:true,contentOnly:context.contentOnly,concern:context.concern,startRevision:scopedRequest&&queryFacts?.query?queryFacts.startRevision:turnSnapshots.current.get(context.turnId)??state.revision,repairAttempt:receiptOnly?1:context.repairAttempt}})});
        const data=await response.json() as SpeechVerdict&{state:BankState;error?:string;code?:string};context.signal.throwIfAborted();
        if(!valid())throw new DOMException('对话已结束','AbortError');
        if(response.status===409&&data.code==='scene_changed')throw new BankRequestError(data.error||'场景已改变，请刷新。',409,data.code);
        if(response.status===409){const fresh=await refresh(context.signal,{epoch:v.sceneEpoch});if(!valid())throw new DOMException('对话已结束','AbortError');return {decision:'repair' as const,facts:bankToolResult(fresh),toolAttempted:true,message:'后台内容已变化，请按最新事实重新回答。'};}
        if(!response.ok)throw new Error(data.error||'回复复核暂不可用，请查看业务卡片。');
        if(!valid()||data.state.sceneEpoch!==v.sceneEpoch)throw new DOMException('对话已结束','AbortError');
        const previous=bankRef.current;applyState(data.state);
        if(previous&&data.state.revision>previous.revision)presentState(previous,data.state);
        if(bankRef.current!.revision>data.state.revision)return {decision:'repair' as const,facts:bankToolResult(bankRef.current!),toolAttempted:!!data.toolAttempted,message:'后台已更新，旧回复不能播放。'};
        return {decision:data.decision,facts:data.facts,message:data.message,repairScope:data.repairScope,readback:data.readback,toolAttempted:!!data.toolAttempted};
        }catch(error){
          // A lost review response may have saved a draft. Read facts without replaying it.
          if(!context.signal.aborted&&valid())await refresh(AbortSignal.any([context.signal,AbortSignal.timeout(5000)]),{epoch:v.sceneEpoch}).catch(()=>{});
          throw error;
        }
      },
      onTool: receiptOnly?async()=>({status:'read_only',...bankToolResult(await refresh(v.signal,{epoch:v.sceneEpoch})),instruction:'仅报告后台进度，不执行任何操作。'}):(name,args,context)=>runTool(name,args,context,v),
    });
    voice.current = v; setMuted(!micWanted.current);
    try { await v.start(micWanted.current); } catch (e) { if(voiceSequence.current===seq&&!sceneSwitchingRef.current&&bankRef.current?.sceneEpoch===v.sceneEpoch){if(sceneReconnection&&!sceneReady)setSceneNotice('场景已加载，语音未连接。');showError((e as Error).message); setConnecting(false); setPhase("idle");} }
  };
  reconnectForInput.current=text=>preferLive.current?connectLive(undefined,text):Promise.resolve();
  const endSession = async (preserveLive=false) => {setVerifiedReply('');if(!preserveLive){preferLive.current=false;queuedInput.current=null;} generation.current++;pending.current?.abort();stopSpeech();setBusy(false);if (voice.current) { setClosing(true); await voice.current.stop(); } else { setMode("idle"); modeRef.current = "idle"; setPhase("idle"); } };
  const renewContext=async(context:ContextRenewal,scope:{epoch:string|undefined})=>{
    if(renewing.current||recovering||sceneSwitchingRef.current||bankRef.current?.sceneEpoch!==scope.epoch)return;renewing.current=true;setRecovering(true);
    await endSession(true);const turn=++generation.current,controller=new AbortController();pending.current=controller;setBusy(true);setPhase('thinking');
    addMessage('assistant','正在重新连接…');
    try{
      const fresh=await refresh(AbortSignal.any([controller.signal,AbortSignal.timeout(5000)]),scope);let snapshot=sessionContext(fresh),snapshotRevision=fresh.revision;
      try{
        const history=transcriptRef.current.filter(m=>m.speaker==='user'||!/^assistant:(?:local-|review-|waiting-|notice-)/.test(m.id)).slice(-8).map(({speaker,text})=>({speaker,text:text.slice(-500)}));
        const response=await fetch('/api/live/context',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(12000)]),body:JSON.stringify({history,...(scope.epoch?{sceneEpoch:scope.epoch,revision:fresh.revision}:{})})});
        if(response.ok){const data=await response.json() as {revision:number;context:string};snapshot=data.context;snapshotRevision=data.revision;}
      }catch{controller.signal.throwIfAborted();}
      const latest=await refresh(AbortSignal.any([controller.signal,AbortSignal.timeout(5000)]),scope);if(latest.revision!==snapshotRevision)snapshot=sessionContext(latest);
      if(turn===generation.current&&mounted.current&&preferLive.current&&!sceneSwitchingRef.current&&latest.sceneEpoch===scope.epoch){renewing.current=false;await connectLive(undefined,context.utterance,false,undefined,snapshot,context.source==='audio',latest);}
    }catch(error){if(!controller.signal.aborted&&turn===generation.current){queuedInput.current=[context.utterance,queuedInput.current].filter(Boolean).join('\n');showError(error instanceof Error?error.message:'暂时无法恢复对话，请重新连接，办理进度保留。');}}
    finally{renewing.current=false;setRecovering(false);if(turn===generation.current)setBusy(false);}
  };
  const recoverPending = async (stalled?:StalledTurn,receiptFacts?:unknown,scope:{epoch:string|undefined}={epoch:voice.current?voice.current.sceneEpoch:bankRef.current?.sceneEpoch}) => {
    if(recoveryRunning.current||sceneSwitchingRef.current||bankRef.current?.sceneEpoch!==scope.epoch)return;recoveryRunning.current=true;setRecovering(true);await endSession(true);
    const turn=++generation.current,controller=new AbortController();pending.current=controller;setBusy(true);
    try{
      const latest=await refresh(AbortSignal.any([controller.signal,AbortSignal.timeout(5000)]),scope);
      const scoped=receiptFacts as {explanation?:unknown;query?:unknown;originalRequest?:string;startRevision?:number}|undefined;
      const explanation=(scoped?.explanation||scoped?.query)&&typeof scoped?.originalRequest==='string';
      if(turn===generation.current&&!sceneSwitchingRef.current&&latest.sceneEpoch===scope.epoch){addMessage('assistant',explanation?'正在重新回答…':replyForState(latest));
        if(stalled?.beforeAnyTool&&stalled.utterance){void connectLive(undefined,stalled.utterance,true,undefined,undefined,false,latest);}
        else{const facts=explanation?{revision:latest.revision,originalRequest:scoped!.originalRequest,...(scoped?.query?{startRevision:scoped.startRevision,query:queryReviewFacts(latest,scoped.originalRequest!,scoped.startRevision!)}:{explanation:explanationReviewFacts(latest,latest.revision)})}:(receiptFacts as {revision?:number})?.revision===latest.revision?receiptFacts:undefined;void connectLive(latest,undefined,false,facts);}}
    }catch{
      if(!controller.signal.aborted&&turn===generation.current)showError('暂时无法核对最新进度，已解除等待。请恢复网络后重新核对，不要重复提交原操作。');
    }finally{recoveryRunning.current=false;if(turn===generation.current){setBusy(false);setPhase('idle');}setRecovering(false);}
  };
  const sceneControl = async (action:Extract<BankAction,{type:'load_scene'|'advance_clock'|'reset'}>) => {
    const state=bankRef.current;if(!state||sceneSwitchingRef.current)return;
    if(busy||connecting||closing||recovering||renewing.current||micOpening){showError('请先等待当前操作或连接结束。');return;}
    const tasks=state.workflows?.tasks||[];
    if(state.task?.step==='authenticate'||tasks.some(t=>t.status==='authenticate')){showError('请先完成或取消待认证业务。');return;}
    if(action.type==='advance_clock'&&(state.task&&['review','authenticate'].includes(state.task.step)||tasks.some(t=>['review','authenticate'].includes(t.status)&&isWrite(t)))){showError('请先处理待核对或待认证的业务，再调整演示时间。');return;}
    const wasLive=modeRef.current==='live'&&!!voice.current,wanted=micWanted.current;
    const epoch=state.sceneEpoch,revision=state.revision,requestId=crypto.randomUUID();
    sceneSwitchingRef.current=true;setSceneSwitching(true);voiceSequence.current++;
    generation.current++;pending.current?.abort();
    try{
      await endSession();
      queuedInput.current=null;turnSnapshots.current.clear();transcriptRef.current=[];setMessages([]);setVerifiedReply('');setInput('');setQueryResultId(null);renewing.current=false;setRecovering(false);setError('');setSceneNotice('');
      const turn=generation.current;
      const stillCurrent=()=>mounted.current&&sceneSwitchingRef.current&&generation.current===turn&&bankRef.current?.sceneEpoch===epoch;
      let next:BankState;
      try{next=await request({action},undefined,requestId,undefined,{epoch,revision});}
      catch(error){
        if(error instanceof BankRequestError&&error.rejected)throw error;
        if(!stillCurrent())return;
        // Only this control can reconcile a lost response; never replay the write.
        try{
          const response=await fetch('/api/bank',{cache:'no-store',signal:AbortSignal.timeout(5000)});
          if(!response.ok)throw new Error('readback failed');
          const data=await response.json() as {state:BankState};
          if(!stillCurrent())return;
          if(!demoControlReplay(data.state,action,requestId,epoch))throw new Error('no matching receipt');
          next=data.state;applyState(next);
        }catch{
          if(stillCurrent())setSceneNotice('场景切换结果未知，请刷新页面核对，不要重复提交。');
          return;
        }
      }
      if(!mounted.current||generation.current!==turn||bankRef.current?.sceneEpoch!==next.sceneEpoch)return;
      setConfirmScene(false);setDrawer('scenes');setSceneNotice(wasLive?'场景已加载，正在连接语音。':'场景已加载。');
      sceneSwitchingRef.current=false;setSceneSwitching(false);
      if(wasLive){micWanted.current=wanted;await connectLive(undefined,undefined,false,undefined,undefined,false,next,true);}
    }catch(e){if(mounted.current&&!(e instanceof DOMException&&e.name==='AbortError'))showError((e as Error).message);}
    finally{sceneSwitchingRef.current=false;setSceneSwitching(false);}
  };
  const advanceDay=()=>{const clock=bankRef.current?.demoClock;if(clock)void sceneControl({type:'advance_clock',to:new Date(Date.parse(clock)+86400000).toISOString()});};
  const nextScene=()=>{const id=bankRef.current?.sceneId||'default',order=['default','S01','S02-A','S03','S04','S05','S06','S07','S08'];const index=id.startsWith('S02-')?2:order.indexOf(id);const next=order[index+1];if(next){setSelectedScene(next);setConfirmScene(true);}};
  const mute = async () => {
    const v = voice.current; if (!v) return;
    if (!muted) { micWanted.current = false; setMuted(true); v.mute(true); return; }
    if (micOpening) return; setMicOpening(true);
    try { await v.enableMicrophone(); if (voice.current !== v) return; micWanted.current = true; setMuted(false); }
    catch (e) { showError((e as Error).message); }
    finally { setMicOpening(false); }
  };
  const chooseText = async () => {
    // preferLive is still set while a failed session is being restored; ending here cancels that reconnect.
    if (voice.current || modeRef.current === "live" || preferLive.current) await endSession();
    // startDemo refuses while connecting; text mode must also cancel a pending connection.
    preferLive.current = false; queuedInput.current = null; soundRef.current = false; setSound(false); stopSpeech();
    if (modeRef.current !== "demo") { setDrawer(null); setMode("demo"); modeRef.current = "demo"; setComposer(true); }
  };
  const chooseVoice = () => { if (modeRef.current === "live" || voice.current) return; micWanted.current = false; void connectLive(); };
  const toggleSound = () => { const value = !sound; soundRef.current = value; setSound(value); if (!value) stopSpeech(); };
  const submit = (e: React.FormEvent) => { e.preventDefault(); if(sceneSwitchingRef.current)return; (e.currentTarget as HTMLFormElement).querySelector('input')?.blur(); const text = input.trim(); if (!text) return; setInput(""); void runCommand(text); };
  const contacts = contactsOf(bank||undefined);
  const contact = contacts.find(c => c.id === task?.recipientId), account = bank?.accounts.find(a => a.id === task?.accountId);
  const receipt = bank?.receipts.find(r => r.taskId === task?.id);
  const status = connecting ? "正在连接" : closing ? "正在结束" : busy ? "正在办理" : mode === "live" ? muted ? "麦克风已关闭，可以打字" : phase === "speaking" ? "正在回应" : "正在听你说" : "";
  const latest = messages[messages.length - 1];
  const caption = !busy && mode !== "idle" ? verifiedReply || (latest?.speaker === "assistant" ? latest.text : "") : "";
  const businessCaption = showCard ? cardCaption(bank, caption) : caption;

  const legacyCard = (showCard && bank && bank.view!=='workflow' && <section className="business-card" aria-label="当前办理卡片" key={bank.view === "transfer" && task?.step === "authenticate" ? task.verificationId : bank.view}>
      <CardHead head={bank.view === "balance" ? {title:"你的账户",icon:"wallet"} : task?.step === "complete" ? {title:"转账回执",icon:"receipt",badge:{label:"模拟回执",tone:"sim"}} : task?.step === "cancelled" ? {title:"转账已取消",icon:"file",badge:{label:"已取消",tone:"muted"}} : task?.step === "authenticate" ? {title:"演示认证 · 转账",icon:"lock",badge:{label:"模拟认证",tone:"info"}} : task?.step === "recipient" ? {title:"你想转给哪一位？",icon:"search",badge:{label:"无默认选中 · 请你选择",tone:"wait"}} : {title:"转账确认页",icon:"shield",badge:{label:"待你手动确认",tone:"wait"}}}>{task&&!["complete","cancelled"].includes(task.step)&&bank.view==="transfer"&&<CancelTask busy={busy} ask={["review","authenticate"].includes(task.step)} summary={`“转账${contact?` · ${contact.label}${contact.name}`:""}${task.amount!=null?` ¥${money(task.amount)}`:""}”`} choices={[{label:"放弃办理",primary:true,run:()=>void runAction({type:"cancel"})}]}/>}<button className="icon-button" onClick={() => void runAction({ type: "home" })} aria-label="收起卡片" disabled={busy}><ChevronDown size={20}/></button></CardHead>
      {bank.view === "balance" ? <><AccountsViz accounts={bank.accounts}/>{bank.receipts.length > 0 && <div className="recent-transfer"><CheckCheck size={17}/><span>最近一笔转出 ¥{money(bank.receipts[0].amount)}</span></div>}{activeTask ? <button className="primary-button" onClick={() => void runCommand("继续这笔")} disabled={busy}>继续这笔转账<ArrowUpRight size={17}/></button> : <button className="primary-button" onClick={() => void runCommand("我要转账")} disabled={busy}>发起转账<ArrowUpRight size={17}/></button>}</>
      : task?.step === "recipient" ? <>{task?.amountNeedsConfirmation&&<p className="card-description">{userMessage(bank.lastReply)}</p>}<div className="choice-list">{contacts.map(c => <button key={c.id} className="cand" onClick={() => void runAction({ type: "select_recipient", recipientId: c.id })} disabled={busy}><span className="cand-radio"/><b>{c.name}</b><span>{c.label}</span><small>{c.bank} · 尾号 {c.tail}</small></button>)}</div><p className="note-line">联系人备注只用于辨认，不代替账户核验</p></>
      : task?.step === "review" || task?.step === "details" ? <>
        {contact&&account&&<MoneyFlow from={{icon:<CreditCard size={16}/>,title:account.name,sub:`尾号 ${account.tail}`}} to={{title:contact.name,sub:`${contact.label} · ${contact.bank} 尾号 ${contact.tail}`}} amount={yuan(amountCents??task.amount??0)}/>}
        <label className="amount-label" htmlFor="transfer-amount">转账金额</label><div className="amount-input"><span>¥</span><input id="transfer-amount" aria-label="转账金额" inputMode="decimal" value={amount} placeholder="0.00" onChange={e => { setAmount(e.target.value); stopSpeech(); }} disabled={busy}/></div>
        <div className="details-list"><div className="details-field"><span>付款账户</span><FlowSelect label="付款账户" placeholder="请选择付款账户" disabled={busy} value={task.accountId || ""} onChange={accountId => void runAction({ type: "edit", accountId })} options={bank.accounts.map(a => ({ value: a.id, label: `${a.name}（${a.tail}）` }))} /></div><div><span>可用余额</span><strong>¥{money(account?.balance || 0)}</strong></div><div><span>手续费</span><strong>¥0.00</strong></div></div>
        <div className="card-actions"><button className="text-button" onClick={() => void runAction({ type: "cancel" })} disabled={busy}>取消转账</button><button className="primary-button" disabled={busy || !amountValid || (!amountDirty&&(!canConfirm||!task.amount))} onClick={() => void runAction(amountDirty?{type:'edit',amount:amountCents!}:{type:'confirm'})}>{busy ? <LoaderCircle className="spin" size={17}/> : <LockKeyhole size={16}/>} {amountDirty?'保存金额':'手动确认并认证'}</button></div>
      </> : task?.step === "authenticate" ? <>{contact&&account&&<MoneyFlow from={{icon:<CreditCard size={16}/>,title:account.name,sub:`尾号 ${account.tail}`}} to={{title:contact.name,sub:contact.label}} amount={yuan(task.amount!)}/>}<form onSubmit={e => { e.preventDefault(); void runAction({ type: "authenticate", code, verificationId: task.verificationId! }); }}><label className="code-label" htmlFor="demo-code">演示验证码</label><input id="demo-code" className="code-input" aria-label="演示验证码" inputMode="numeric" autoComplete="off" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} placeholder="······" autoFocus disabled={busy}/><p className="auth-note">本次填写 <button type="button" onClick={() => setCode("123456")}>123456</button>。演示环境不采集真实密码或验证码；对话中也不会索要认证凭证。</p><div className="card-actions"><button className="primary-button" type="submit" disabled={busy || code.length !== 6}>{busy ? <LoaderCircle className="spin" size={17}/> : <ShieldCheck size={17}/>}验证并转账</button></div></form><button className="text-button" disabled={busy} onClick={() => void runAction({ type: "edit", amount: task.amount! })}><ChevronLeft size={14}/>返回修改</button></>
      : task?.step === "complete" ? <><div className="receipt-status tone-ok"><Check size={22}/>转账已完成<small>沙箱</small></div>{contact&&account&&<MoneyFlow from={{icon:<CreditCard size={16}/>,title:account.name,sub:`尾号 ${account.tail}`}} to={{title:contact.name,sub:contact.label}} amount={yuan(receipt?.amount||0)}/>}<div className="card-rows"><Row label="账户余额" value={yuan(account?.balance||0)}/><Row label="完成时间" value={receipt ? new Date(receipt.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "—"}/><Row label="回执编号" value={<code>{receipt?.id}</code>}/></div><div className="card-actions"><button className="primary-button" disabled={busy} onClick={() => void runAction({ type: "home" })}>完成<Check size={17}/></button></div></>
      : <><p className="card-description">办理已取消，账户余额没有变化。</p><div className="card-actions"><button className="primary-button" disabled={busy} onClick={() => void runAction({ type: "home" })}>回到对话</button></div></>}
    </section>);
  const responseCard = !showCard && caption.length > 80;
  const stageActive = showCard || !!drawer || responseCard;
  const pendingTasks = bank?.workflows?.tasks.filter(item=>['collecting','review','authenticate','blocked'].includes(item.status))||[];
  const queryResult=bank?.workflows?.tasks.find(task=>task.id===queryResultId);
  const steps = bank?.plan?.steps.filter(step=>step.kind==='workflow')||[];
  const done = steps.filter(step=>step.status==='complete').length;
  const settings = [
    <button className="secondary-button" key="voice" disabled={!configured||connecting||closing||mode==='live'} onClick={()=>void connectLive()}>{configured?'开始语音对话':'语音暂不可用'}</button>,
    <button className="secondary-button" key="text" onClick={startDemo}>使用文字对话</button>,
    <button className="secondary-button" key="sound" onClick={toggleSound}>{sound?'关闭文字播报':'开启文字播报'}</button>,
    <button className="secondary-button" key="history" onClick={()=>setDrawer('transcript')}>对话记录</button>,
    <button className="secondary-button" key="tasks" onClick={()=>setDrawer('tasks')}>办理记录</button>,
    ...(bank?.workflows?.records.orders.some(order=>order.status==='pending')?[<button className="secondary-button" key="settle" disabled={busy} onClick={()=>void runAction({type:'workflow',command:{operation:'settle',source:'card'}})}>结算演示订单</button>]:[]),
    <button className="secondary-button" key="scenes" disabled={sceneSwitching} onClick={()=>{setConfirmScene(false);setDrawer('scenes')}}>路演场景</button>,
    <button className="secondary-button" key="reset" onClick={()=>setDrawer('reset')}>重置演示数据</button>,
  ];
  const gooseView = <WealthGoose cue={mascotCue({bank,phase,mode,muted,busy,connecting,closing,recovering,error})} small={!wide&&stageActive}/>;
  const statusLine = status?<div className="status-line"><span className={`status-dot ${mode==='live'?'online':''}`}/>{status}</div>:null;
  const footerView = <footer className="bottom-area"><div className="mode-switch" role="group" aria-label="对话方式"><button aria-pressed={mode!=='live'&&!connecting} disabled={closing||sceneSwitching} onClick={()=>void chooseText()}>文字</button><button aria-pressed={mode==='live'||connecting} disabled={!configured||connecting||closing||sceneSwitching} onClick={chooseVoice}>语音</button></div><div className="input-dock"><button className={`control-button ${muted?'is-muted':''}`} aria-label={mode==='live'?muted?'开启麦克风':'关闭麦克风':'开始语音对话'} onClick={()=>{if(mode==='live')void mute();else if(configured){micWanted.current=true;void connectLive();}else setDrawer('connect');}} disabled={connecting||closing||micOpening||sceneSwitching}>{muted?<MicOff size={21}/>:<Mic size={21}/>}</button><form className="composer" onSubmit={submit}><input aria-label="输入你的要求" placeholder="输入你的要求" value={input} disabled={sceneSwitching} onChange={event=>{setInput(event.target.value);stopSpeech();}}/><button aria-label="发送" disabled={!input.trim()||!bank||sceneSwitching}><ArrowUp size={19}/></button></form></div>{mode==='live'&&<button className="text-button end-voice" disabled={closing} onClick={()=>void endSession()}>结束语音</button>}{busy&&slow&&<button className="text-button" disabled={recovering} onClick={()=>void recoverPending()}>{recovering?'正在连接':'重新连接'}</button>}</footer>;
  const centerView = <>
    <div aria-label="演示场景状态" role="status">{bank?.sceneId&&bank.sceneId!=='default'?`${bank.sceneId} · ${SCENE_MANIFEST.find(item=>item.id===bank.sceneId)?.label||''} · 模拟数据 · 模拟时间 ${businessDay(bank)}（北京时间）`:'默认演示 · 模拟数据 · 系统时间'}</div>
    {sceneNotice&&<p role="status">{sceneNotice}</p>}
    <section className="conversation" aria-label="语音银行">{!wide&&gooseView}<div className="hero-copy">{!wide&&statusLine}{!stageActive&&<h1>今天想办点什么？</h1>}</div>{!stageActive&&<div className="welcome-actions"><div className="suggestions">{['给张三转五百元','看看我的余额'].map(sample=><button key={sample} disabled={!bank} onClick={()=>void runCommand(sample)}>{sample}</button>)}</div><div className="welcome-navigation"><button className="text-button" onClick={()=>setDrawer('businesses')}>更多业务</button>{pendingTasks.length>0&&bank&&<PendingBar bank={bank} tasks={pendingTasks} busy={busy} onAction={runAction} onAll={()=>setDrawer('tasks')}/>}</div></div>}</section>
    {!wide&&!stageActive&&caption&&<p className="latest-caption" aria-live="polite">{caption}</p>}
    {showCard&&!drawer&&businessCaption&&(businessCaption.length>160?<details className="reply-details"><summary>查看回复</summary><p>{businessCaption}</p></details>:<p className="business-caption" aria-live="polite">{businessCaption}</p>)}
    {wide&&stageActive&&<div className="desk-title card-column-title">业务卡片<small>金额、分摊、授权与状态由确定性规则计算</small></div>}
    <div className={`card-stage ${busy?'is-busy':''}`} hidden={!stageActive}>
      {wide&&bank&&!drawer&&<TaskMap bank={bank}/>}
      <div className={bank?.plan?.monthly?"current-stage monthly-stage":"current-stage"} hidden={!!drawer}>{bank?.plan?.monthly&&bank.view==='workflow'&&<MonthlyPlan bank={bank} busy={busy} onAction={runAction}/>} {responseCard?<section className="business-card serial-card" aria-label="回复"><div className="card-head"><MessageCircle aria-hidden size={20}/><h2>知行</h2></div><p className="serial-reply">{caption}</p></section>:bank&&<SerialStage bank={bank} busy={busy} onAction={runAction} legacy={legacyCard}/>}</div>
      {drawer==='businesses'&&bank&&<WorkflowPanel bank={bank} busy={busy} onAction={runAction} serial catalog onClose={()=>setDrawer(null)}/>}
      {drawer==='tasks'&&bank&&<TaskHistory bank={bank} busy={busy} onAction={runAction} onClose={()=>setDrawer(null)}/>}
      {drawer==='query'&&bank&&queryResult&&<section className="business-card serial-card" aria-label="查询结果"><CardHead head={cardHead(bank,queryResult)}/><WorkflowOutcome bank={bank} task={queryResult}/><button className="primary-button" onClick={()=>setDrawer(null)}>返回当前业务</button></section>}
      {drawer==='transcript'&&<ConversationHistory messages={messages} onClose={()=>setDrawer(null)}/>}
      {(drawer==='settings'||drawer==='connect')&&<section className="business-card serial-card settings-card" aria-label="设置"><div className="card-top card-head"><Headphones aria-hidden size={20}/><h2>{drawer==='connect'?'开始对话':'设置'}</h2><span className="card-head-end"><button className="text-button" onClick={()=>setDrawer(null)}>返回</button></span></div><div className="settings-list">{settings}</div></section>}
      {drawer==='scenes'&&bank&&<section className="business-card serial-card settings-card" aria-label="路演场景"><div className="card-top card-head"><List aria-hidden size={20}/><h2>路演场景</h2><span className="card-head-end"><button className="text-button" onClick={()=>setDrawer('settings')} disabled={sceneSwitching}>返回</button></span></div>
        <p className="card-description">模拟数据；场景加载会替换当前演示业务。{bank.demoClock?`模拟时间 ${businessDay(bank)}（北京时间）`:'当前使用系统时间'}</p>
        <FlowSelect label="选择路演场景" inline={0} value={selectedScene} disabled={sceneSwitching} onChange={value=>{setSelectedScene(value);setConfirmScene(false);}} options={SCENE_MANIFEST.map(item=>({value:item.id,label:`${item.id} · ${item.label}`}))}/>
        {!confirmScene?<button className="primary-button" disabled={sceneSwitching} onClick={()=>setConfirmScene(true)}>加载所选场景</button>:<><p>加载 {selectedScene} 将替换当前演示数据，是否继续？</p><button className="primary-button" disabled={sceneSwitching} onClick={()=>void sceneControl({type:'load_scene',sceneId:selectedScene})}>确认加载场景</button><button className="text-button" disabled={sceneSwitching} onClick={()=>setConfirmScene(false)}>取消</button></>}
        <button className="secondary-button" disabled={sceneSwitching||!bank.demoClock} onClick={advanceDay}>推进到次日</button><button className="secondary-button" disabled={sceneSwitching||bank.sceneId==='S08'} onClick={nextScene}>下一阶段</button>
        <p>当前账户：{bank.accounts.map(a=>`${a.name} ¥${money(a.balance)}`).join('、')||'无'}</p><p>当前联系人：{contacts.map(c=>`${c.name} · ${c.label} · 尾号${c.tail}`).join('、')||'无'}</p>
        <details><summary>场景数据假设</summary><ul>{(SCENE_MANIFEST.find(item=>item.id===(bank.sceneId||'default'))?.assumptions||[]).map(item=><li key={item}>{item}</li>)}</ul></details>
      </section>}
      {drawer==='reset'&&<section className="business-card serial-card" aria-label="重置演示"><div className="card-head"><RotateCcw aria-hidden size={20}/><h2>重新开始演示？</h2></div><p className="card-description">清除当前演示交易，并恢复初始余额。</p><button className="primary-button" disabled={busy} onClick={()=>void (bank?.sceneEpoch?sceneControl({type:'reset'}):runAction({type:'reset'}))}>重置演示</button><button className="text-button" onClick={()=>setDrawer('settings')}>返回</button></section>}
    </div>
</>;
  return <main className={`app serial-app ${wide?'desk-app':''} ${stageActive?'has-card':''} ${viewportHeight&&viewportHeight<500?'compact-height':''} ${formFocused?'form-focused':''}`} style={viewportHeight?{minHeight:viewportHeight}:undefined}
    onFocusCapture={event=>{const target=event.target as HTMLElement;
      // Only typing raises a keyboard. Tapping a choice must not move the card under the finger.
      setFormFocused(previous=>!!target.closest('.business-card')&&(target.matches(TEXT_ENTRY)||previous&&target.matches('form button[type=submit],form button:not([type])')));}}
    onBlurCapture={event=>{const next=event.relatedTarget as HTMLElement|null;setFormFocused(previous=>!!next?.closest?.('.business-card')&&(next.matches(TEXT_ENTRY)||previous&&next.matches('form button[type=submit],form button:not([type])')));}}>
    <header className="topbar"><a className="wordmark" href="/" aria-label="知行 财富鹅 首页">知行 <span className="wordmark-dot"/><span className="wordmark-live">财富鹅</span></a><div className="topbar-right">{steps.length>1&&<button className="progress-button" aria-label="办理进度" onClick={()=>setDrawer('tasks')}>进度 {done} / {steps.length}</button>}<span className="environment"><span/>模拟银行</span><button className="icon-button more-button" aria-label="设置与连接" onClick={()=>setDrawer(drawer==='settings'?null:'settings')}><Ellipsis size={23}/></button></div></header>
    {wide?<div className="desk">
      <aside className="desk-chat" aria-label="对话区"><div className="desk-title">对话<small>{mode==='live'?'语音进行中':'文字或语音都可以'}</small></div><ChatFeed messages={messages} busy={busy} slow={slow} live={mode==='live'}/>{footerView}</aside>
      <div className="desk-center">{centerView}</div>
      <aside className="desk-goose" aria-label="鹅豆">{gooseView}<div className="desk-status">{statusLine||(mode==='live'&&<span className="status-idle">在听</span>)}</div>{bank&&<RecordList bank={bank} onOpen={()=>setDrawer('tasks')}/>}</aside>
    </div>:<>{centerView}{footerView}</>}
    {error&&<div className="toast" role="alert"><span>{error}</span><button aria-label="关闭提示" onClick={()=>setError('')}><X size={15}/></button></div>}
  </main>;
}

