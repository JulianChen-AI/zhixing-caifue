// Turns the recorded run into the film timeline: recorded states, real reply texts and the
// measured duration of every voice clip. Gaps between clips are the only timing decision.
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
import { reduceBank } from '../../../lib/bank/engine.ts';
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '..');
const run = path.join(root, 'work', process.argv[2] || 'pane-2026-10-31T14-38-47-415Z');
const snaps: { label: string; t: number; state: any }[] = JSON.parse(fs.readFileSync(path.join(run, 'snaps.json'), 'utf8'));
const clipsMeta: { id: string; text: string }[] = JSON.parse(fs.readFileSync(path.join(root, 'work/ai-clips.json'), 'utf8'));
const pick = (label: string) => structuredClone(snaps.filter(s => s.label === label).at(-1)!.state);
const duration = (file: string) => { let text = ''; try { execFileSync('ffmpeg', ['-hide_banner', '-i', file], { stdio: 'pipe' }); } catch (e: any) { text = String(e.stderr); } const m = text.match(/Duration: (\d+):(\d+):([\d.]+)/)!; return +m[1] * 3600 + +m[2] * 60 + +m[3]; };
const voice = (id: string) => ({ id, file: `voice/${id}.wav`, duration: +duration(path.join(root, 'out/voice', id + '.wav')).toFixed(3) });
const text = (id: string) => clipsMeta.find(c => c.id === id)!.text;

// The authentication card is the recorded review state after the same card confirmation the
// user tapped, computed by the product reducer rather than drawn by hand.
const review = pick('review'), reviewTask = review.workflows.tasks.find((t: any) => t.id === review.workflows.currentTaskId);
const auth = reduceBank(review, { type: 'workflow', command: { operation: 'confirm', taskId: reviewTask.id, token: reviewTask.reviewToken, source: 'card' } } as any, 'film-confirm');
if (auth.workflows!.tasks.find((t: any) => t.id === reviewTask.id)!.status !== 'authenticate') throw new Error('confirm did not open authentication');
const created = pick('aa-created');
if (created.workflows.records.aa.at(-1).status !== 'awaiting_participants') throw new Error('unexpected AA state');
const states: Record<string, any> = { initial: pick('initial'), choose: pick('after-u1'), review, auth, transferred: pick('after-transfer'), equal: pick('aa-equal'), itemized: pick('aa-itemized'), created };

const segments: any[] = [], audio: any[] = [], taps: any[] = [], subtitles: any[] = [], notes: any[] = [];
let t = 0;
const seg = (to: number, state: string, phase: string, extra: any = {}) => { segments.push({ from: +t.toFixed(3), to: +to.toFixed(3), state, phase, ...extra }); t = to; };
const user = (id: string, state: string, line: string, extra: any = {}) => { const v = voice(id); audio.push({ ...v, at: +t.toFixed(3), speaker: 'user' }); subtitles.push({ from: +t.toFixed(3), to: +(t + v.duration).toFixed(3), speaker: '我', text: line }); seg(t + v.duration, state, 'listening', extra); };
const think = (secs: number, state: string, beat: string) => { seg(t + secs, state, 'thinking', { busy: true, beat }); };
const reply = (id: string, state: string, extra: any = {}) => { const v = voice(id), body = text(id); audio.push({ ...v, at: +t.toFixed(3), speaker: 'assistant' }); subtitles.push({ from: +t.toFixed(3), to: +(t + v.duration).toFixed(3), speaker: '鹅豆', text: body }); seg(t + v.duration, state, 'speaking', { reply: { text: body, from: +t.toFixed(3), to: +(t + v.duration).toFixed(3) }, ...extra }); return body; };
const hold = (secs: number, state: string, keep: string, extra: any = {}) => seg(t + secs, state, 'listening', { hold: keep, ...extra });
const note = (title: string, body: string, secs: number) => notes.push({ from: +t.toFixed(3), to: +(t + secs).toFixed(3), title, body });

seg(0.5, 'initial', 'listening', { beat: '开场' });
user('user-01', 'initial', '给张三转120元，备注球场费。', { beat: '提出转账' });
think(1.3, 'initial', '理解要求');
note('同名收款人', '通讯录里有三位张三，不猜测，请你选择', 6);
const a1 = reply('ai-01', 'choose', { beat: '同名消歧' });
hold(0.45, 'choose', a1);
user('user-02', 'choose', '打羽毛球那个。', { beat: '选择收款人' });
think(1.2, 'choose', '整理转账');
note('用途备注', '“球场费”随这笔转账一起保存', 5);
const a2 = reply('ai-02', 'review', { beat: '转账核对' });
hold(0.55, 'review', a2);
taps.push({ at: +t.toFixed(3), selector: '.workflow-card .primary-button, .business-card .primary-button' });
note('语音不等于授权', '转账要你亲手点确认，并在页面完成验证', 5.4);
hold(0.4, 'review', a2, { beat: '手动确认' });
seg(t + 0.6, 'auth', 'listening', { beat: '页面验证', code: { from: 1e6, to: 1e6 + 1 } });
seg(t + 1.1, 'auth', 'listening', { code: { from: +t.toFixed(3), to: +(t + 1.0).toFixed(3) } });
taps.push({ at: +t.toFixed(3), selector: 'form .primary-button' });
seg(t + 0.35, 'auth', 'listening', { code: { from: 0, to: 0.001 } });
think(0.9, 'auth', '办理中');
seg(t + 1.8, 'transferred', 'listening', { beat: '转账完成' });
user('user-03', 'transferred', '昨天聚餐360是我付的，我和张三、小林、小陈、小周、小王六个人分摊。', { beat: '发起分摊' });
think(1.3, 'transferred', '整理分摊');
const a3 = reply('ai-03', 'equal', { beat: '均分草稿' });
hold(0.45, 'equal', a3);
user('user-04', 'equal', '等一下，里面60块是饮料，只有张三、小林、小陈喝了，我没喝。', { beat: '改口' });
think(1.6, 'equal', '按新条件重算');
note('改口后重新计算', '饮料 60 ÷ 3 = 20 元\n其余 300 ÷ 6 = 50 元\n50×3 + 70×3 = 360 元 ✓', 9);
const a4 = reply('ai-04', 'itemized', { beat: '分项方案' });
hold(0.55, 'itemized', a4);
taps.push({ at: +t.toFixed(3), selector: '.workflow-card .primary-button, .business-card .primary-button' });
hold(0.4, 'itemized', a4, { beat: '确认发起' });
think(0.6, 'itemized', '发起中');
note('收款状态', '已收 0 元 · 待收 310 元\n发起 AA 不会再扣款', 6.5);
seg(t + 1.5, 'created', 'listening', { beat: '收款状态' });
seg(t + 5.0, 'created', 'listening', { scroll: { from: +t.toFixed(3), to: +(t + 3.6).toFixed(3), y0: 0, y1: 560 } });
const total = +t.toFixed(3);

const data = { duration: total, run: path.basename(run), states, segments, audio, taps, subtitles, notes };
fs.mkdirSync(path.join(here, 'data'), { recursive: true });
fs.writeFileSync(path.join(here, 'data/timeline.js'), 'window.FILM_TIMELINE = ' + JSON.stringify(data) + ';\n');
fs.writeFileSync(path.join(root, 'out/timeline.json'), JSON.stringify({ duration: total, audio: audio.map(({ id, file, at, duration, speaker }) => ({ id, file, start: at, duration, speaker, text: subtitles.find(s => s.from === at)?.text })), beats: segments.filter(s => s.beat).map(s => ({ at: s.from, label: s.beat })) }, null, 1));
console.log('duration', total, 'segments', segments.length);
for (const a of audio) console.log(a.at.toFixed(2).padStart(6), a.speaker.padEnd(9), a.id, a.duration);
