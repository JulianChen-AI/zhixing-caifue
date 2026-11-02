// Compiles the director script into absolute times using the measured voice-clip durations.
import type { GrowthEvent, MilestoneId } from './sandbox.ts';
import type { MascotAction } from '../mascot/scenario.ts';

export type SceneId = 'intro' | 'transfer' | 'bills' | 'cards' | 'graduation' | 'payday' | 'security' | 'ending';
export type Act =
  | { k: 'scene'; scene: SceneId }
  | { k: 'lower'; text: string; sub?: string }
  | { k: 'user'; line: string; mode: 'voice' | 'text' }
  | { k: 'goose'; line: string }
  | { k: 'cursor'; to: string; dur?: number }
  | { k: 'click'; target: string }
  | { k: 'run'; op: string }
  | { k: 'highlight'; target: string; dur?: number }
  | { k: 'caption'; text: string; dur?: number }
  | { k: 'milestone'; id: MilestoneId; event: GrowthEvent; basis: string }
  | { k: 'gooseAnim'; action: MascotAction }
  | { k: 'overlay'; kind: 'rewind' | 'final' | null };

/** Offsets: a number is seconds from beat start; "L+x" from line start; "E+x"/"E-x" from line end. */
export type Offset = number | `L${'+' | '-'}${number}` | `E${'+' | '-'}${number}`;
export type Beat = { line?: string; lead?: number; hold?: number; min?: number; do?: [Offset, Act][] };
export type Chapter = { id: string; scene: SceneId; title: string; target: [number, number]; beats: Beat[] };

export type TimedAct = Act & { at: number; seq: number };
export type TimedLine = { id: string; speaker: string; text: string; start: number; end: number };
export type Compiled = { acts: TimedAct[]; lines: TimedLine[]; chapters: { id: string; title: string; start: number; end: number; target: [number, number] }[]; duration: number };

export type VoiceLines = { speakers: Record<string, string>; lines: { id: string; speaker: string; text: string }[] };

export function compile(chapters: Chapter[], voice: VoiceLines, seconds: Record<string, number>, total?: number): Compiled {
  const acts: TimedAct[] = [], lines: TimedLine[] = [], out: Compiled['chapters'] = [];
  let t = 0, seq = 0;
  chapters.forEach((chapter, ci) => {
    const chapterStart = t;
    chapter.beats.forEach((beat, bi) => {
      const start = t, lead = beat.lead ?? 0.2;
      const line = beat.line ? voice.lines.find(l => l.id === beat.line) : undefined;
      if (beat.line && (!line || seconds[beat.line] === undefined)) throw new Error(`Missing voice line ${beat.line}`);
      const lineStart = start + lead, lineEnd = lineStart + (line ? seconds[line.id] : 0);
      if (line) lines.push({ id: line.id, speaker: voice.speakers[line.speaker], text: line.text, start: lineStart, end: lineEnd });
      let latest = line ? lineEnd : start;
      for (const [offset, act] of beat.do || []) {
        const at = typeof offset === 'number' ? start + offset
          : (offset[0] === 'L' ? lineStart : lineEnd) + Number(offset.slice(1));
        acts.push({ ...act, at: Number(at.toFixed(4)), seq: seq++ });
        latest = Math.max(latest, at);
      }
      let end = Math.max(line ? lineEnd + (beat.hold ?? 0.4) : latest + (beat.hold ?? 0.2), start + (beat.min ?? 0));
      // The final beat absorbs the remainder so the cut lands exactly on the requested length.
      if (total && ci === chapters.length - 1 && bi === chapter.beats.length - 1) {
        if (total < end) throw new Error(`Timeline overruns ${total}s by ${(end - total).toFixed(2)}s`);
        end = total;
      }
      t = end;
    });
    out.push({ id: chapter.id, title: chapter.title, start: chapterStart, end: t, target: chapter.target });
  });
  acts.sort((a, b) => a.at - b.at || a.seq - b.seq);
  return { acts, lines, chapters: out, duration: t };
}
