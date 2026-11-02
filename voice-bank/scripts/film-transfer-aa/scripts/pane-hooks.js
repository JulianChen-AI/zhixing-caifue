// Injected into the in-app browser before the voice session starts. Records the assistant's
// remote audio, realtime events and every /api/bank state with one page clock.
(() => {
  const film = window.__filmRec = { run: 'pane-' + new Date().toISOString().replace(/[:.]/g, '-'), events: [], states: [], activity: [], chunks: [], marks: [], recStart: null, audioContext: null, destination: null };
  const now = () => performance.now();
  const observe = channel => channel.addEventListener('message', event => {
    let e; try { e = JSON.parse(event.data); } catch { return; }
    const row = { t: now(), type: e.type, response: e.response_id || e.response?.id || null, item: e.item_id || e.item?.id || null };
    if (e.type === 'response.audio_transcript.delta') row.delta = e.delta;
    if (e.type === 'response.audio_transcript.done' || e.type === 'conversation.item.input_audio_transcription.completed') row.transcript = e.transcript;
    if (e.type === 'response.function_call_arguments.done') { row.name = e.name; row.arguments = e.arguments; }
    if (e.type === 'response.done') row.status = e.response?.status;
    if (e.type === 'error') row.error = e.error?.message || e.error?.code || 'error';
    film.events.push(row);
  });
  const record = track => {
    if (film.recStart !== null) return;
    const ctx = new AudioContext(), stream = new MediaStream([track]);
    // Chrome only routes remote WebRTC audio into Web Audio while a media element consumes it.
    const sink = new Audio(); sink.muted = true; sink.srcObject = stream; void sink.play();
    const src = ctx.createMediaStreamSource(stream), dest = ctx.createMediaStreamDestination(), analyser = ctx.createAnalyser();
    analyser.fftSize = 1024; src.connect(dest); src.connect(analyser);
    const recorder = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 128000 });
    recorder.ondataavailable = e => { if (e.data.size) film.chunks.push(e.data); };
    recorder.start(250); film.recStart = now(); film.recorder = recorder; film.sink = sink; film.recCtx = ctx;
    const buf = new Float32Array(analyser.fftSize);
    film.meter = setInterval(() => { analyser.getFloatTimeDomainData(buf); let s = 0; for (const v of buf) s += v * v; film.activity.push([Math.round(now()), Math.round(Math.sqrt(s / buf.length) * 10000)]); }, 40);
  };
  const NativePeer = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends NativePeer {
    constructor(...args) { super(...args); this.addEventListener('datachannel', e => observe(e.channel)); this.addEventListener('track', e => record(e.track)); this.addEventListener('connectionstatechange', () => film.events.push({ t: now(), type: 'pc:' + this.connectionState })); }
    createDataChannel(...args) { const c = super.createDataChannel(...args); observe(c); return c; }
  };
  navigator.mediaDevices.getUserMedia = async () => { const ctx = film.audioContext = new AudioContext(); await ctx.resume(); film.destination = ctx.createMediaStreamDestination(); return film.destination.stream; };
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url, started = now();
    const response = await nativeFetch(input, init);
    if (new URL(url, location.href).pathname === '/api/bank') {
      let request = null; try { request = init?.body ? JSON.parse(init.body) : null; } catch {}
      response.clone().json().then(data => { if (data?.state) film.states.push({ t: now(), started, request: request ? { tool: request.tool?.name, args: request.tool?.arguments, action: request.action, command: request.command } : null, state: data.state }); }).catch(() => {});
    }
    return response;
  };
  film.quiet = ms => { const t = now(); const a = film.activity.filter(([at]) => at > t - ms); return a.length > 0 && a.every(([, rms]) => rms < 60); };
  // A turn ends once the model has spoken, every response is done, nothing is busy and playback is silent.
  film.settle = async (start, needSpeech = true, limit = 30000) => {
    const begin = now();
    while (now() - begin < limit) {
      const ev = film.events.filter(e => e.t > start), created = ev.filter(e => e.type === 'response.created').length, done = ev.filter(e => e.type === 'response.done').length, spoke = ev.some(e => e.type === 'response.audio_transcript.done');
      const busy = !!document.querySelector('.spin') || /正在办理|正在连接/.test(document.querySelector('.status-line')?.textContent || '');
      if ((!needSpeech || spoke) && created === done && !busy && film.quiet(2200)) return { created, done, waited: Math.round(now() - begin) };
      await new Promise(r => setTimeout(r, 300));
    }
    return { pending: true, waited: Math.round(now() - begin) };
  };
  film.play = async id => {
    const bytes = await (await nativeFetch('http://localhost:5203/audio/' + id + '.wav')).arrayBuffer();
    const buffer = await film.audioContext.decodeAudioData(bytes), source = film.audioContext.createBufferSource();
    source.buffer = buffer; source.connect(film.destination);
    const clipStart = now(); source.start(); await new Promise(r => { source.onended = r; });
    film.marks.push({ kind: 'user', id, start: clipStart, end: now() }); return clipStart;
  };
  film.mark = (kind, extra = {}) => { const row = { kind, t: now(), ...extra }; film.marks.push(row); return row.t; };
  film.summary = since => {
    const ev = film.events.filter(e => e.t > since), last = film.states.at(-1)?.state, t = last?.workflows?.tasks?.find(x => x.id === last.workflows.currentTaskId);
    return { user: ev.filter(e => e.type === 'conversation.item.input_audio_transcription.completed').map(e => e.transcript), assistant: ev.filter(e => e.type === 'response.audio_transcript.done').map(e => e.transcript), calls: ev.filter(e => e.type === 'response.function_call_arguments.done').map(e => (e.name + ' ' + e.arguments).slice(0, 240)), errors: ev.filter(e => e.type === 'error').map(e => e.error), view: last?.view, task: t && { fn: t.functionId, status: t.status, params: t.params, message: t.message }, legacy: last?.task && { step: last.task.step, recipientId: last.task.recipientId, amount: last.task.amount, note: last.task.note } };
  };
  film.finish = async () => {
    film.recorder.stop(); await new Promise(r => setTimeout(r, 800)); clearInterval(film.meter);
    const save = (name, body) => nativeFetch(`http://localhost:5203/save?run=${film.run}&name=${name}`, { method: 'POST', body }).then(r => r.status);
    const audio = await save('assistant-remote.webm', new Blob(film.chunks, { type: 'audio/webm' }));
    const log = await save('log.json', JSON.stringify({ run: film.run, recStart: film.recStart, events: film.events, marks: film.marks, activity: film.activity }));
    const states = await save('states.json', JSON.stringify(film.states));
    return { audio, log, states, run: film.run };
  };
  film.ready = true;
})();
