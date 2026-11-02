// Film player: one deterministic seek(t) drives the product iframe, side subtitles, notes and
// tap rings, so preview playback and frame export show the same picture.
(() => {
  const T = window.FILM_TIMELINE, $ = id => document.getElementById(id), clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const ease = x => { x = clamp(x); return x * x * (3 - 2 * x); };
  const PHONE = { x: 723, y: 50, scale: 1.095 };
  const frame = document.createElement('iframe'); frame.title = '知行移动端页面'; frame.setAttribute('scrolling', 'no'); frame.srcdoc = window.PRODUCT_SURFACE; $('phone').append(frame);
  const product = () => frame.contentWindow && frame.contentWindow.ProductReplay;
  let time = 0, playing = false, last = 0, ready = false;
  const audios = T.audio.map(a => { const el = new Audio('../out/' + a.file); el.preload = 'auto'; return { ...a, el }; });
  $('seek').max = T.duration;

  const fade = (el, t, from, to, dx = 0, dy = 0) => {
    const k = Math.min(ease((t - from) / 0.25), ease((to + 0.35 - t) / 0.3));
    el.style.opacity = String(k); el.style.transform = `translate(${(1 - k) * dx}px,${(1 - k) * dy}px)`;
    return k;
  };
  function overlays(t) {
    const sub = T.subtitles.find(s => t >= s.from - 0.05 && t < s.to + 0.35);
    if (sub) { $('who').textContent = sub.speaker; $('line').textContent = sub.text; $('sub').className = 'sub ' + (sub.speaker === '我' ? 'user' : 'assistant'); fade($('sub'), t, sub.from - 0.05, sub.to, 0, 12); }
    else $('sub').style.opacity = '0';
    const note = T.notes.find(n => t >= n.from && t < n.to + 0.35);
    if (note) { $('noteTitle').textContent = note.title; $('noteBody').textContent = note.body; fade($('note'), t, note.from, note.to, 16, 0); }
    else $('note').style.opacity = '0';
    const tap = T.taps.find(e => t >= e.at && t < e.at + 0.7), ring = $('touch');
    if (!tap || !ready) { ring.style.opacity = '0'; return; }
    const r = tap.rect;
    if (!r) { ring.style.opacity = '0'; return; }
    ring.style.opacity = '1';
    ring.style.left = PHONE.x + (r.x + r.width * 0.5) * PHONE.scale + 'px'; ring.style.top = PHONE.y + (r.y + r.height * 0.5) * PHONE.scale + 'px';
    const p = (t - tap.at) / 0.7;
    [...ring.children].forEach((c, i) => { const q = clamp((p - i * 0.14) / (1 - i * 0.14)); c.style.transform = `scale(${0.25 + q * (i ? 1.1 : 0.5)})`; c.style.opacity = q > 0 ? String((1 - q) * (i ? 0.85 : 0.6)) : '0'; });
  }
  async function seek(t, exact = true) {
    time = clamp(Number(t) || 0, 0, T.duration);
    if (ready) { if (exact) await product().renderAt(time); else product().render(time); }
    overlays(time);
    $('seek').value = time; $('time').textContent = time.toFixed(1) + 's / ' + T.duration.toFixed(1) + 's';
  }
  function syncAudio() {
    for (const a of audios) {
      const local = time - a.at, inside = local >= 0 && local < a.duration;
      if (playing && inside) { if (a.el.paused || Math.abs(a.el.currentTime - local) > 0.2) { a.el.currentTime = local; void a.el.play().catch(() => {}); } }
      else if (!a.el.paused) a.el.pause();
    }
  }
  function tick(now) {
    if (playing) { if (last) time = Math.min(T.duration, time + (now - last) / 1000); last = now; void seek(time, false); syncAudio(); if (time >= T.duration) pause(); }
    requestAnimationFrame(tick);
  }
  function play() { if (!ready) return; if (time >= T.duration) time = 0; playing = true; last = 0; $('play').textContent = '暂停'; }
  function pause() { playing = false; last = 0; $('play').textContent = '播放'; syncAudio(); }
  function fit() { const v = $('viewport'), s = Math.min(v.clientWidth / 1920, v.clientHeight / 1080); $('stage').style.transform = `translate(${(v.clientWidth - 1920 * s) / 2}px,${(v.clientHeight - 1080 * s) / 2}px) scale(${s})`; }
  $('play').onclick = () => playing ? pause() : play();
  $('restart').onclick = () => { pause(); void seek(0).then(play); };
  $('seek').oninput = e => { pause(); void seek(e.target.value); };
  $('clean').onclick = () => { document.body.classList.toggle('clean'); fit(); };
  document.addEventListener('keydown', e => { if (e.key === 'h' || e.key === 'H') $('clean').onclick(); if (e.code === 'Space') { e.preventDefault(); $('play').onclick(); } });
  addEventListener('resize', fit); fit();
  frame.addEventListener('load', async () => {
    for (let i = 0; i < 300 && !product(); i++) await new Promise(r => setTimeout(r, 20));
    try {
      await product().ready();
      // A tap stays where the button was when it was pressed, even after the card changes.
      for (const tap of T.taps) { await product().renderAt(tap.at); tap.rect = product().geometry(tap.selector); }
      ready = true; await seek(0); $('status').textContent = '';
    } catch (error) { $('status').textContent = String(error.message || error); }
  });
  window.FilmPreview = { seek, play, pause, get ready() { return ready; }, duration: T.duration, setClean(v) { document.body.classList.toggle('clean', v); fit(); } };
  requestAnimationFrame(tick);
})();
