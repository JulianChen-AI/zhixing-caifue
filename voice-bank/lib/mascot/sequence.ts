import type { MascotAction, MascotCue } from './scenario.ts';

export type Clip = { name: string; loop: boolean; fps: number; safeExitFrames: number[]; enter: number[]; loopFrames: number[]; exit: number[] };
export type Clips = Record<MascotAction, Clip>;
export type Playback = { action: MascotAction; key: string; phase: 'enter' | 'loop' | 'exit' | 'reverse'; frame: number; desired: MascotCue; consumed: string | null; seen: string[] };
export function createPlayback(cue: MascotCue): Playback {
  return { action: cue.action, key: cue.key, phase: 'enter', frame: 0, desired: cue, consumed: null, seen: [] };
}
export function requestPlayback(state: Playback, desired: MascotCue): Playback { return { ...state, desired }; }
export function frameId(state: Playback, clips: Clips): number {
  const clip = clips[state.action];
  return (state.phase === 'loop' ? clip.loopFrames : state.phase === 'exit' ? clip.exit : clip.enter)[state.frame];
}
export function advancePlayback(state: Playback, clips: Clips): Playback {
  const s = { ...state }, clip = clips[s.action];
  const requested = s.seen.includes(s.desired.key) ? s.desired.fallback || 'idle' : s.desired.action;
  const changing = requested !== s.action || !clip.loop && s.key !== s.desired.key && !s.seen.includes(s.desired.key);
  if (s.phase === 'enter') {
    // Interrupt an unfinished entrance by retracing only its played frames.
    if (changing && s.action !== 'savings') { s.phase = 'reverse'; s.frame = Math.max(0,s.frame-1); }
    else if (s.frame + 1 < clip.enter.length) s.frame++;
    else { s.phase = 'loop'; s.frame = 0; }
  } else if (s.phase === 'reverse') {
    if (s.frame > 0) s.frame--;
    else return startNext(s, requested);
  } else if (s.phase === 'loop') {
    if (clip.loop && changing && clip.safeExitFrames.includes(s.frame)) { s.phase = 'exit'; s.frame = 0; }
    else if (s.frame + 1 < clip.loopFrames.length) s.frame++;
    else if (clip.loop && !changing) s.frame = 0;
    else { s.phase = 'exit'; s.frame = 0; }
  } else if (s.frame + 1 < clip.exit.length) s.frame++;
  else {
    if (!clip.loop) { s.consumed = s.key; s.seen = [...s.seen.filter(key => key !== s.key), s.key].slice(-32); }
    return startNext(s, s.seen.includes(s.desired.key) ? s.desired.fallback || 'idle' : s.desired.action);
  }
  return s;
}
function startNext(s: Playback, action: MascotAction): Playback { return { ...s, action, key: s.desired.key, phase: 'enter', frame: 0 }; }
