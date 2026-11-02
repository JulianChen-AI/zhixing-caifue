// Transcribes every synthesized voice clip with Qwen ASR and prints it next to the script text,
// so mispronounced names, numbers or "AA" can be caught before rendering.
// Usage: node scripts/demo-video/asr-check.mjs [lineId ...]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const script = JSON.parse(readFileSync(join(root, 'lib/demo/voice-lines.json'), 'utf8'));
const vars = Object.fromEntries(readFileSync(join(root, '.dev.vars'), 'utf8').split('\n')
  .map(line => line.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2].replace(/^"|"$/g, '')]));
const only = process.argv.slice(2);
const strip = text => text.replace(/[，。、；：？！“”—\s,.;:?!"]/g, '');

for (const line of script.lines) {
  if (only.length && !only.includes(line.id)) continue;
  const wav = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', join(root, 'public/demo/voice', `${line.id}.wav`), '-ar', '16000', '-ac', '1', '-f', 'wav', '-']);
  const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation', {
    method: 'POST',
    headers: { Authorization: `Bearer ${vars.DASHSCOPE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'qwen3-asr-flash', input: { messages: [{ role: 'user', content: [{ audio: `data:audio/wav;base64,${wav.toString('base64')}` }] }] }, parameters: { asr_options: { language: 'zh' } } }),
  });
  const body = await response.json();
  const heard = body.output?.choices?.[0]?.message?.content?.[0]?.text ?? `ERROR ${body.code || response.status}`;
  const same = strip(heard) === strip(line.tts || line.text) || strip(heard) === strip(line.text);
  console.log(`${same ? 'OK  ' : 'DIFF'} ${line.id}\n     script: ${line.text}\n     heard : ${heard}`);
}
