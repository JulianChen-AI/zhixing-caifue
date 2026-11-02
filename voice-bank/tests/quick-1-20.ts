import { runQuickReview } from '../lib/workflows/quick-review.ts';
import { existsSync,readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const checks=runQuickReview();
const doc=new URL('../docs/workflows/competitor-corrections.md',import.meta.url);
const last=checks[19];last.pass=existsSync(doc)&&['3.1','3.3','450','452'].every(x=>readFileSync(doc,'utf8').includes(x));const source=new URL('../../../../docs/business/final-20261026/competitor-workflows.md',import.meta.url);
if(last.pass&&existsSync(source)){const sha=createHash('sha256').update(readFileSync(source)).digest('hex');last.pass=readFileSync(doc,'utf8').includes(sha)&&last.evidence.includes(sha);}if(!last.pass)last.evidence='竞品矛盾校正说明缺失或源文件哈希不匹配';
for(const c of checks)console.log(`${c.pass?'PASS':'FAIL'} ${String(c.id).padStart(2,'0')} ${c.title} | ${c.evidence}`);
const passed=checks.filter(c=>c.pass).length;console.log(`RESULT ${passed}/20 (synthetic, no external services)`);process.exitCode=passed===20?0:1;
