// Deterministic mascot frame for any demo time: the same cue list and t always give the same pose,
// so frame-by-frame capture and live preview match. Uses the production sequence manifest.
import type { MascotAction } from '../mascot/scenario.ts';

export type GooseClip = { fps: number; cyclic: boolean; safeExitFrames: number[]; enter: number[]; loop: number[]; exit: number[] };
export type GooseManifest = { size: number; columns: number; framesPerSheet: number; sheets: string[]; actions: Record<MascotAction, GooseClip> };
export type GooseCue = { action: MascotAction; at: number };

type State = { action: MascotAction; phase: 'enter' | 'reverse' | 'loop' | 'exit'; idx: number; cue: number };

const frameOf = (s: State, clips: GooseManifest['actions']) => {
  const clip = clips[s.action];
  const list = s.phase === 'enter' || s.phase === 'reverse' ? clip.enter : s.phase === 'loop' ? clip.loop : clip.exit;
  return list[Math.min(s.idx, list.length - 1)];
};

/** Frame id at time t. Cues interrupt cyclic loops through their exit; one-shot gestures play through. */
export function gooseFrameAt(cues: GooseCue[], t: number, manifest: GooseManifest): number {
  const clips = manifest.actions, fps = 12;
  const sorted = cues.filter(c => c.at <= t).sort((a, b) => a.at - b.at);
  if (!sorted.length) return clips.idle.loop[0];
  let s: State = { action: sorted[0].action, phase: 'enter', idx: 0, cue: 0 };
  let next = 1;
  const ticks = Math.floor((t - sorted[0].at) * fps);
  for (let k = 0; k < ticks; k++) {
    const now = sorted[0].at + (k + 1) / fps;
    while (next < sorted.length && sorted[next].at <= now) {
      // Repeating the playing cyclic action is not a change.
      if (sorted[next].action === s.action && clips[s.action].cyclic && s.cue === next - 1) s.cue = next;
      next++;
    }
    const desired = next - 1 > s.cue ? next - 1 : -1;
    const clip = clips[s.action];
    const start = (cue: number) => { s = { action: sorted[cue].action, phase: 'enter', idx: 0, cue }; };
    if (s.phase === 'enter') {
      // An interrupted cyclic entrance retraces its played frames instead of jumping.
      if (desired >= 0 && clip.cyclic) s = { ...s, phase: 'reverse', idx: Math.max(0, s.idx - 1) };
      else if (s.idx + 1 < clip.enter.length) s.idx++;
      else s = { ...s, phase: 'loop', idx: 0 };
    } else if (s.phase === 'reverse') {
      if (s.idx > 0) s.idx--;
      else if (desired >= 0) start(desired);
      else s = { ...s, phase: 'enter', idx: 0 };
    } else if (s.phase === 'loop') {
      const safe = !clip.safeExitFrames.length || clip.safeExitFrames.includes(s.idx);
      if (desired >= 0 && clip.cyclic && safe) s = { ...s, phase: 'exit', idx: 0 };
      else if (s.idx + 1 < clip.loop.length) s.idx++;
      else if (clip.cyclic) s.idx = 0;
      else s = { ...s, phase: 'exit', idx: 0 };
    } else if (s.idx + 1 < clip.exit.length) s.idx++;
    else if (desired >= 0) start(desired);
    else if (!clip.cyclic) s = { action: 'idle', phase: 'enter', idx: 0, cue: s.cue };
    else s = { ...s, phase: 'loop', idx: 0 };
  }
  return frameOf(s, clips);
}
