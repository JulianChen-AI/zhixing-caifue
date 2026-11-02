import { QwenConversation, voiceSettings, isExpectedRealtimeCancellation, type ConversationCallbacks } from "./qwen-protocol";
import {VerifiedAudio} from './verified-audio';
import {SPEAKER_INSTRUCTIONS} from './delegation';
import {microphoneMessage} from './microphone';
import {CorrectionCue} from './correction-cue';
import type {Contact} from '../bank/types';

export type LiveCallbacks = ConversationCallbacks & {
  onReady: () => void; onClose: (finalized: boolean) => void; onError: (message: string) => void;
  onLevel: (level: number, source: "input" | "output") => void; initialContext?: string; initialContacts?: readonly Contact[]; initialSceneEpoch?:string; initialRevision?:number;
  onPlayback?:(playing:boolean)=>void;
  onPlaybackEnded?:()=>void;
  readOnly?:boolean;
  readOnlyInstructions?:string;
  onMicrophoneUnavailable?:(message:string)=>void;
};

/** Qwen WebRTC transport. Credentials stay behind the SDP proxy. */
export class LiveVoice {
  get signal(){return this.controller.signal;}
  get sceneEpoch(){return this.cb.initialSceneEpoch;}
  get readOnly(){return !!this.cb.readOnly;}
  syncFacts(content:string){this.conversation.syncFacts(content);}
  observeState(content:string){this.conversation.observeState(content);}
  private peer: RTCPeerConnection | null = null;
  private stream: MediaStream | null = null;
  private channels = new Set<RTCDataChannel>();
  private channel: RTCDataChannel | null = null;
  private audio: HTMLAudioElement | null = null;
  private context: AudioContext | null = null;
  private frame = 0;
  private ready = false;
  private stopped = false;
  private created = false;
  private updateSent = false;
  private modelVoice = "Tina";
  private delegation = false;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private controller = new AbortController();
  private sender: RTCRtpSender | null = null;
  private conversation: QwenConversation;
  private verifiedAudio:VerifiedAudio;
  private correctionCue=new CorrectionCue();
  private nativePlaying=false;
  private nativeDoneAt=0;
  private nativeLastSound=0;
  private transportFailed=false;
  private meter:((media:MediaStream,source:"input"|"output")=>void)|null=null;
  get hasMicrophone(){return !!this.stream;}
  constructor(private cb: LiveCallbacks) {
    this.verifiedAudio=new VerifiedAudio(message=>{cb.onError(message);if(cb.readOnly)this.cleanup(true)},playing=>cb.onPlayback?.(playing),()=>cb.onPlaybackEnded?.());
    this.conversation = new QwenConversation((type, extra) => this.send(type, extra), {
      ...cb,
      onDiagnostic:data=>cb.onDiagnostic?.({...data,transport:{connection:this.peer?.connectionState,ice:this.peer?.iceConnectionState,channel:this.channel?.readyState,bufferedBytes:this.channel?.bufferedAmount,maxMessageSize:this.peer?.sctp?.maxMessageSize,sendFailed:this.transportFailed}}),
      onReplyVerified:(id,text)=>{void this.verifiedAudio.play(id);cb.onReplyVerified?.(id,text)},
      onWaitNotice:(id,text)=>{void this.verifiedAudio.play(id);cb.onWaitNotice?.(id,text)},
      onReplyDiscarded:id=>{this.verifiedAudio.discard(id);cb.onReplyDiscarded?.(id)},
      onSupervisionPause:async text=>{await this.correctionCue.play();await cb.onSupervisionPause?.(text);},
      onStall:context=>{this.cleanup(false);this.cb.onStall?.(context)},
      onOutputAllowed:allowed=>{if(this.audio)this.audio.muted=!!cb.onReviewReply||!allowed;if(!allowed){this.nativeDoneAt=0;this.nativePlaying=false;}cb.onOutputAllowed?.(allowed)},
      onInterrupt:()=>{this.correctionCue.stop();this.verifiedAudio.interrupt();this.nativeDoneAt=0;this.nativePlaying=false;if(this.audio)this.audio.muted=true;cb.onInterrupt()},
    });
  }
  private send(type: string, extra: Record<string, unknown> = {}) {
    if (this.stopped||this.transportFailed||this.channel?.readyState!=="open")return;
    const raw=JSON.stringify({type,event_id:crypto.randomUUID(),...extra}),bytes=new TextEncoder().encode(raw).length,negotiated=this.peer?.sctp?.maxMessageSize,limit=negotiated&&Number.isFinite(negotiated)?negotiated:65536;
    try{if(bytes>limit)throw new RangeError('message_too_large');this.channel.send(raw);}catch(error){
      this.transportFailed=true;this.conversation.transportFailure(error instanceof RangeError?'transport_message_too_large':'transport_send_failed',bytes);
      queueMicrotask(()=>this.fail('语音事件未能发送，正在核对后台进度。'));
    }
  }
  private fail(message:string){
    if(this.stopped)return;
    const pending=this.conversation.pendingRecovery();
    this.conversation.diagnostic('transport_or_provider_failure');
    this.cb.onError(message);this.cleanup(false);
    if(pending)this.cb.onStall?.(pending);
  }
  private initialize() {
    if (!this.stopped && !this.updateSent && this.created && this.channel?.readyState === "open") {
      const session=voiceSettings(this.modelVoice, this.cb.initialContext, this.cb.initialContacts, this.delegation?{instructions:SPEAKER_INSTRUCTIONS,tools:[]}:undefined);
      if(this.cb.readOnly){session.tools=[];session.instructions=this.cb.readOnlyInstructions||'你只负责播报已经核实的后台结果。没有任何业务执行工具，不能办理、修改、确认或提交。用简短中文说明实际进度，未完成和待认证必须如实说明。如有operationResult，先报告本次操作的结果摘要，再说明当前任务进度。\n后台事实：'+(this.cb.initialContext||'');}
      this.updateSent = true; this.send("session.update", { session });
    }
  }
  private attach(channel: RTCDataChannel) {
    if(this.stopped){channel.close();return;}
    this.channels.add(channel);
    channel.onopen = () => this.initialize();
    channel.onmessage = event => {
      if(this.stopped)return;
      try {
        const value = JSON.parse(event.data);
        if (value.type === "session.created") { this.created = true; this.channel = channel; this.initialize(); }
        void this.handle(value).catch(() => this.fail("语音事件处理失败，正在核对办理进度。"));
      } catch { this.cb.onError("收到无法识别的语音事件。"); }
    };
    channel.onclose = () => { if (this.channel === channel && !this.stopped) this.fail('语音连接已关闭，办理进度保留。'); };
    if (channel.readyState === "open") this.initialize();
  }
  private async openMicrophone() {
    if (!navigator.mediaDevices?.getUserMedia) throw new DOMException("", "NotSupportedError");
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  }
  /** Without a microphone the session still answers typed input with audio. */
  async start(microphone = true) {
    if(this.stopped)return;
    try {
      this.timeout = setTimeout(() => { this.cb.onError("语音启动超时，请检查网络后重试。"); this.cleanup(false); }, 55000);
      if (microphone) {
        try {
          const stream = await this.openMicrophone();
          if (this.stopped) { stream.getTracks().forEach(t => t.stop()); return; }
          this.stream = stream;
        } catch (error) { if (this.stopped) return; this.cb.onMicrophoneUnavailable?.(microphoneMessage(error)); }
      }
      const pc = this.peer = new RTCPeerConnection();
      this.audio = new Audio(); this.audio.autoplay = true; this.audio.muted = true; this.audio.setAttribute("playsinline", "");
      this.context = new AudioContext(); await this.context.resume();
      if (this.stopped) return;
      const meters: { analyser: AnalyserNode; data: Uint8Array<ArrayBuffer>; source: "input" | "output" }[] = [];
      const meter = this.meter = (media: MediaStream, source: "input" | "output") => {
        if (!this.context) return;
        const analyser = this.context.createAnalyser(); analyser.fftSize = 256;
        this.context.createMediaStreamSource(media).connect(analyser);
        meters.push({ analyser, data: new Uint8Array(analyser.fftSize), source });
      };
      if (this.stream) meter(this.stream, "input");
      const tick = () => {
        if (this.stopped) return;
        for (const m of meters) {
          m.analyser.getByteTimeDomainData(m.data);
          const rms = Math.sqrt(m.data.reduce((sum, x) => sum + ((x - 128) / 128) ** 2, 0) / m.data.length);
          this.cb.onLevel(m.source === "output" && this.audio?.muted ? 0 : Math.min(1, rms * 7), m.source);
          if(m.source==='output'&&!this.cb.onReviewReply&&!this.audio?.muted){
            const now=performance.now();
            if(rms>0.008){this.nativeLastSound=now;if(!this.nativePlaying){this.nativePlaying=true;this.cb.onPlayback?.(true);}}
            if(this.nativeDoneAt&&now-Math.max(this.nativeDoneAt,this.nativeLastSound)>(this.nativePlaying?700:1600)){
              this.nativeDoneAt=0;this.nativePlaying=false;this.cb.onPlayback?.(false);this.cb.onPlaybackEnded?.();
            }
          }
        }
        this.frame = requestAnimationFrame(tick);
      }; tick();
      pc.ontrack = e => {
        if(this.stopped){e.track.stop();e.streams.forEach(s=>s.getTracks().forEach(t=>t.stop()));return;}
        const remote = e.streams[0] || new MediaStream([e.track]);
        this.verifiedAudio.setStream(remote);
        if (this.audio) { this.audio.srcObject = remote; this.audio.play().catch(() => this.cb.onError("浏览器暂停了声音，请点一下页面后重连。")); }
        meter(remote, "output");
      };
      pc.ondatachannel = e => this.attach(e.channel);
      pc.onconnectionstatechange = () => {
        if (this.stopped) return;
        if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
        if (pc.connectionState === "failed") this.fail("语音连接已中断，正在核对办理进度。");
        else if (pc.connectionState === "disconnected") this.disconnectTimer = setTimeout(() => this.fail("语音连接已断开，正在核对办理进度。"), 8000);
        else this.initialize();
      };
      // Negotiate first, then attach microphone after session.updated.
      this.sender = pc.addTransceiver("audio", { direction: "sendrecv" }).sender;
      this.attach(pc.createDataChannel("oai-events"));
      await pc.setLocalDescription(await pc.createOffer());
      if (pc.iceGatheringState !== "complete") await new Promise<void>(resolve => {
        const finish = () => { clearTimeout(timer); pc.removeEventListener("icegatheringstatechange", check); this.controller.signal.removeEventListener("abort", finish); resolve(); };
        const check = () => { if (pc.iceGatheringState === "complete") finish(); };
        const timer = setTimeout(finish, 2500);
        pc.addEventListener("icegatheringstatechange", check); this.controller.signal.addEventListener("abort", finish, { once: true });
      });
      if (this.stopped) return;
      const response = await fetch("/api/live/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sdp: pc.localDescription?.sdp,...(this.cb.initialSceneEpoch?{sceneEpoch:this.cb.initialSceneEpoch,revision:this.cb.initialRevision}:{}) }), signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(30000)]) });
      const result = await response.json() as { sdp: string; voice: string; delegation?: boolean; error?: string };
      if (!response.ok) throw new Error(result.error || "无法连接 Qwen 语音服务。");
      if (this.stopped) return;
      this.modelVoice = result.voice || "Tina";
      // Read-only receipts keep their own narrow prompt; only full sessions delegate.
      this.delegation = !!result.delegation && !this.cb.readOnly;
      if (this.delegation) {this.conversation.instructions = SPEAKER_INSTRUCTIONS;this.conversation.backendSpeaker=true;}
      await pc.setRemoteDescription({ type: "answer", sdp: result.sdp });
    } catch (error) { const stopped = this.stopped; this.cleanup(false); if (!stopped) throw error; }
  }
  private async handle(e: Record<string, any>) {
    if (this.stopped) return;
    if(this.cb.onReviewReply&&e.type==='response.created')this.verifiedAudio.start(String(e.response?.id||''));
    if(this.cb.onReviewReply&&e.type==='response.done'){
      const id=String(e.response?.id||e.response_id||'');
      if(e.response?.status==='cancelled'||!e.response?.output?.some((item:any)=>item.type==='message'))this.verifiedAudio.discard(id);else this.verifiedAudio.finish(id);
    }
    if(!this.cb.onReviewReply&&e.type==='response.created'){this.nativeDoneAt=0;this.nativeLastSound=0;}
    if(!this.cb.onReviewReply&&e.type==='response.done'&&e.response?.status!=='cancelled'&&e.response?.output?.some((item:any)=>item.type==='message'))this.nativeDoneAt=performance.now();
    if (e.type === "session.updated" && this.updateSent && !this.ready) {
      this.ready = true;
      if (this.timeout) clearTimeout(this.timeout);
      if (this.stream) await this.sender?.replaceTrack(this.stream.getAudioTracks()[0]);
      if (this.stopped) return;
      // Qwen requires an input turn before response.create, even after configuration.
      this.cb.onReady();
    } else await this.conversation.handle(e);
    if (e.type === "response.created" && this.audio) this.audio.muted = !!this.cb.onReviewReply||!this.conversation.outputAllowed;
    if (e.type === "error") {
      if (isExpectedRealtimeCancellation(e)) return;
      this.fail("Qwen语音服务返回错误，正在核对办理进度。");
    }
  }
  contextUpdate(content: string) { if (this.ready) this.conversation.contextUpdate(content); }
  userText(text: string) { if (this.ready) this.conversation.userText(text); }
  mute(muted: boolean) { this.stream?.getAudioTracks().forEach(track => { track.enabled = !muted; }); }
  private micOpening: Promise<void> | null = null;
  /** Opens the microphone mid-session; throws a user-facing message when it cannot. Repeated calls share one request. */
  enableMicrophone() { return this.micOpening ??= this.openLateMicrophone().finally(() => { this.micOpening = null; }); }
  private async openLateMicrophone() {
    if (this.stream) { this.mute(false); return; }
    let stream: MediaStream;
    try { stream = await this.openMicrophone(); } catch (error) { throw new Error(microphoneMessage(error)); }
    // A stream that is not kept must be released here, or the device stays in use after the session ends.
    if (this.stopped || this.stream) { stream.getTracks().forEach(t => t.stop()); if (!this.stopped) this.mute(false); return; }
    this.stream = stream; this.meter?.(stream, "input");
    // Before session.updated the track is attached by the ready handler instead.
    if (this.ready) await this.sender?.replaceTrack(stream.getAudioTracks()[0]);
  }
  async stop() { this.cleanup(true); }
  private cleanup(finalized: boolean) {
    if (this.stopped) return;
    // The cancel event must be sent before send() and the channel are disabled.
    this.conversation.stop();this.stopped = true; this.ready = false; this.controller.abort();
    this.verifiedAudio.stop();
    this.correctionCue.stop();
    if (this.timeout) clearTimeout(this.timeout);
    if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
    cancelAnimationFrame(this.frame);
    this.stream?.getTracks().forEach(t => t.stop());
    for (const channel of this.channels) {channel.onopen=null;channel.onmessage=null;channel.onclose=null;channel.close();} this.channels.clear();
    if(this.peer){this.peer.ontrack=null;this.peer.ondatachannel=null;this.peer.onconnectionstatechange=null;this.peer.close();}
    if (this.audio) { this.audio.pause(); (this.audio.srcObject as MediaStream | null)?.getTracks().forEach(t => t.stop()); this.audio.srcObject = null; }
    void this.context?.close().catch(() => {});
    this.stream = null; this.peer = null; this.channel = null; this.context = null;
    this.cb.onClose(finalized);
  }
}
