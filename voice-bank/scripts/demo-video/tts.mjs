// Synthesizes the demo-video voice lines with Qwen TTS and records each clip's duration.
// Usage: node scripts/demo-video/tts.mjs [--force]
// Reads DASHSCOPE_API_KEY from .dev.vars; the key is never written to output.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const script = JSON.parse(readFileSync(join(root, 'lib/demo/voice-lines.json'), 'utf8'));
const outDir = join(root, 'public/demo/voice');
mkdirSync(outDir, { recursive: true });
const vars = Object.fromEntries(readFileSync(join(root, '.dev.vars'), 'utf8').split('\n')
  .map(line => line.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2].replace(/^"|"$/g, '')]));
const key = vars.DASHSCOPE_API_KEY;
if (!key) throw new Error('DASHSCOPE_API_KEY missing in .dev.vars');
const host = vars.DASHSCOPE_REGION === 'singapore' ? 'dashscope-intl.aliyuncs.com' : 'dashscope.aliyuncs.com';
const force = process.argv.includes('--force');
const manifestPath = join(outDir, 'manifest.json');
const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')).clips : {};

/** Seconds of audio in a WAV file, read from its header. */
function wavSeconds(buffer) {
  let offset = 12, rate = 0, channels = 0, bits = 0;
  while (offset < buffer.length - 8) {
    const id = buffer.toString('ascii', offset, offset + 4), size = buffer.readUInt32LE(offset + 4);
    if (id === 'fmt ') { channels = buffer.readUInt16LE(offset + 10); rate = buffer.readUInt32LE(offset + 12); bits = buffer.readUInt16LE(offset + 22); }
    if (id === 'data') return Math.min(size, buffer.length - offset - 8) / (rate * channels * bits / 8);
    offset += 8 + size + (size % 2);
  }
  throw new Error('No data chunk');
}

/** The page plays an AAC copy; the WAV stays as the source for mixing and ASR checks. */
function webCopy(file) {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', file.replace(/\.wav$/, '.m4a')]);
}

const clips = {};
for (const line of script.lines) {
  const voice = script.voices[line.speaker];
  const text = line.tts || line.text;
  const hash = createHash('sha256').update(`${voice}\n${text}`).digest('hex').slice(0, 16);
  const raw = join(outDir, `${line.id}.raw.wav`), file = join(outDir, `${line.id}.wav`);
  if (!force && previous[line.id]?.hash === hash && existsSync(file)) {
    if (!existsSync(file.replace(/\.wav$/, '.m4a'))) webCopy(file);
    clips[line.id] = previous[line.id]; continue;
  }
  const response = await fetch(`https://${host}/api/v1/services/aigc/multimodal-generation/generation`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'qwen3-tts-flash', input: { text, voice, language_type: 'Chinese' } }),
  });
  const body = await response.json();
  const url = body.output?.audio?.url;
  if (!url) throw new Error(`${line.id}: ${body.code || response.status} ${body.message || ''}`);
  writeFileSync(raw, Buffer.from(await (await fetch(url)).arrayBuffer()));
  // Trim leading/trailing silence and normalize to 48 kHz mono so clips mix cleanly.
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-af',
    'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.08,areverse',
    '-ar', '48000', '-ac', '1', file]);
  execFileSync('rm', [raw]);
  webCopy(file);
  clips[line.id] = { hash, voice, seconds: Number(wavSeconds(readFileSync(file)).toFixed(3)) };
  console.log(line.id, voice, clips[line.id].seconds);
}
writeFileSync(manifestPath, JSON.stringify({ model: 'qwen3-tts-flash', clips }, null, 2) + '\n');
const total = Object.values(clips).reduce((sum, clip) => sum + clip.seconds, 0);
console.log(`lines=${Object.keys(clips).length} speech=${total.toFixed(1)}s`);
