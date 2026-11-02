// Turns every case utterance into what a speech recognizer actually hears: Qwen TTS speaks it,
// Qwen ASR transcribes it, and the transcript is cached in asr.json for repeatable runs.
// Synthetic voices, not people: it brings real recognition errors in, not accents or noise.
// Usage: node --experimental-transform-types evals/task-completion/speech.ts [--voices=Cherry,Ethan] [--force]
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { caseFile } from './grade.ts';
import { speakable } from './spoken.ts';
export { speakable };

const TTS = 'qwen3-tts-flash', ASR = 'qwen3-asr-flash';
const here = new URL('.', import.meta.url);
const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? 'true']));
const voices = (args.voices || 'Cherry,Ethan').split(',');
const cacheUrl = new URL('asr.json', here), audioDir = new URL('../../outputs/eval-speech-audio/', here);
mkdirSync(audioDir, { recursive: true });

export type SpeechCache = { tts: string; asr: string; note: string; items: Record<string, { voice: string; text: string; spoken: string; heard: string; at: string }> };
export const speechKey = (voice: string, text: string) => createHash('sha256').update(`${voice}\n${text}`).digest('hex').slice(0, 16);

/** Qwen ASR on a WAV file, resampled to 16 kHz mono first; waits out the account's shared rate limit. */
export async function transcribeFile(path: string): Promise<string> {
 const host = process.env.DASHSCOPE_REGION === 'singapore' ? 'dashscope-intl.aliyuncs.com' : 'dashscope.aliyuncs.com';
 const mono = path.replace(/\.wav$/, '.16k.wav');
 execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', path, '-ar', '16000', '-ac', '1', mono]);
 const body = JSON.stringify({ model: ASR, input: { messages: [{ role: 'user', content: [{ audio: `data:audio/wav;base64,${readFileSync(mono).toString('base64')}` }] }] }, parameters: { asr_options: { language: 'zh' } } });
 for (let attempt = 0; ; attempt++) {
  const reply = await (await fetch(`https://${host}/api/v1/services/aigc/multimodal-generation/generation`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}`, 'Content-Type': 'application/json' }, body })).json() as { output?: { choices?: { message?: { content?: { text?: string }[] } }[] }; code?: string; message?: string };
  if (String(reply.code || '').startsWith('Throttling') && attempt < 6) { await new Promise(done => setTimeout(done, 1500 * 2 ** attempt)); continue; }
  const text = reply.output?.choices?.[0]?.message?.content?.[0]?.text;
  if (typeof text !== 'string') throw new Error(`ASR：${reply.code || ''} ${reply.message || ''}`);
  return text;
 }
}

if (import.meta.main) {
 process.loadEnvFile(new URL('../../.dev.vars', here));
 const key = process.env.DASHSCOPE_API_KEY;
 if (!key) throw new Error('.dev.vars 缺少 DASHSCOPE_API_KEY');
 const host = process.env.DASHSCOPE_REGION === 'singapore' ? 'dashscope-intl.aliyuncs.com' : 'dashscope.aliyuncs.com';
 const endpoint = `https://${host}/api/v1/services/aigc/multimodal-generation/generation`;
 const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
 const cache: SpeechCache = existsSync(cacheUrl) ? JSON.parse(readFileSync(cacheUrl, 'utf8')) : { tts: TTS, asr: ASR, note: '', items: {} };
 cache.note = `${TTS} 合成、${ASR} 识别的转写，用于模拟语音输入；不是真人录音，生产链路的实时模型转写可能不同。`;
 const file = caseFile.parse(JSON.parse(readFileSync(new URL('cases.json', here), 'utf8')));
 const todo = voices.flatMap(voice => [...new Set(file.cases.flatMap(c => c.turns))].map(text => ({ voice, text, spoken: speakable(text), id: speechKey(voice, text) })))
  .filter(job => args.force === 'true' || cache.items[job.id]?.spoken !== job.spoken);

 /** The account's per-second quota is shared; back off instead of recording a throttle as a transcript. */
 async function call<T extends { code?: string }>(body: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
   const reply = await (await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) })).json() as T;
   if (!String(reply.code || '').startsWith('Throttling') || attempt >= 6) return reply;
   await new Promise(done => setTimeout(done, 1500 * 2 ** attempt));
  }
 }

 async function one(job: (typeof todo)[number]) {
  const spoken = await call<{ output?: { audio?: { url?: string } }; code?: string; message?: string }>({ model: TTS, input: { text: job.spoken, voice: job.voice, language_type: 'Chinese' } });
  const url = spoken.output?.audio?.url;
  if (!url) throw new Error(`TTS ${job.voice} “${job.text}”：${spoken.code || ''} ${spoken.message || ''}`);
  const raw = new URL(`${job.id}.raw.wav`, audioDir), wav = new URL(`${job.id}.wav`, audioDir);
  writeFileSync(raw, Buffer.from(await (await fetch(url)).arrayBuffer()));
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', decodeURIComponent(raw.pathname), '-ar', '16000', '-ac', '1', decodeURIComponent(wav.pathname)]);
  const audio = readFileSync(wav).toString('base64');
  const heard = await call<{ output?: { choices?: { message?: { content?: { text?: string }[] } }[] }; code?: string; message?: string }>({ model: ASR, input: { messages: [{ role: 'user', content: [{ audio: `data:audio/wav;base64,${audio}` }] }] }, parameters: { asr_options: { language: 'zh' } } });
  const text = heard.output?.choices?.[0]?.message?.content?.[0]?.text;
  if (typeof text !== 'string') throw new Error(`ASR ${job.voice} “${job.text}”：${heard.code || ''} ${heard.message || ''}`);
  cache.items[job.id] = { voice: job.voice, text: job.text, spoken: job.spoken, heard: text, at: new Date().toISOString() };
  console.log(`${job.voice}  ${job.spoken}\n        → ${text}`);
 }

 const queue = [...todo], failures: string[] = [];
 await Promise.all(Array.from({ length: 2 }, async () => { for (let job; (job = queue.shift());) await one(job).catch(error => failures.push(String(error.message || error))); }));
 writeFileSync(cacheUrl, JSON.stringify(cache, null, 1) + '\n');
 const strip = (s: string) => s.replace(/[，。、；：？！“”—\s,.;:?!"]/g, '');
 const all = Object.values(cache.items), changed = all.filter(i => strip(i.heard) !== strip(i.text));
 console.log(`\n生成 ${todo.length - failures.length}/${todo.length} 条；缓存共 ${all.length} 条，其中转写与原句文字不同 ${changed.length} 条。`);
 if (failures.length) { console.log(failures.join('\n')); process.exitCode = 1; }
}
