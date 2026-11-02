// Synthesize the user's lines with Qwen TTS (a voice distinct from the assistant's Tina).
// Keys are read from the app's .dev.vars and never printed.
import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';
const [envFile,outDir,linesFile]=process.argv.slice(2);
const env=Object.fromEntries(fs.readFileSync(envFile,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1).trim()]));
const base=`https://${env.DASHSCOPE_WORKSPACE_ID}.cn-beijing.maas.aliyuncs.com`;
export function duration(file){let text='';try{execFileSync('ffmpeg',['-hide_banner','-i',file],{encoding:'utf8',stdio:'pipe'});}catch(e){text=String(e.stderr);}const m=text.match(/Duration: (\d+):(\d+):([\d.]+)/);return m?Number(m[1])*3600+Number(m[2])*60+Number(m[3]):0;}
const lines=JSON.parse(fs.readFileSync(linesFile,'utf8'));
fs.mkdirSync(outDir,{recursive:true});
for(const line of lines){
 const r=await fetch(base+'/api/v1/services/aigc/multimodal-generation/generation',{method:'POST',headers:{Authorization:'Bearer '+env.DASHSCOPE_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:'qwen3-tts-flash',input:{text:line.tts||line.text,voice:line.voice||'Ethan',language_type:'Chinese'}})});
 const data=await r.json();if(!r.ok||!data.output?.audio?.url)throw new Error(`TTS ${line.id} ${r.status} ${data.code||''} ${data.message||''}`);
 const raw=path.join(outDir,line.id+'.raw.wav');fs.writeFileSync(raw,Buffer.from(await (await fetch(data.output.audio.url)).arrayBuffer()));
 const out=path.join(outDir,line.id+'.wav');
 // Trim leading/trailing silence so clips can be placed exactly on the timeline.
 execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',raw,'-af','silenceremove=start_periods=1:start_duration=0.02:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_duration=0.02:start_threshold=-45dB,areverse,apad=pad_dur=0.08','-ar','24000','-ac','1','-c:a','pcm_s16le',out]);
 fs.unlinkSync(raw);
 const dur=duration(out);
 console.log(line.id,dur.toFixed(2)+'s',line.text);
}
