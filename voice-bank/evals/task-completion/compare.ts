// Puts several report.json runs side by side (e.g. text ×3, ASR Cherry, ASR Ethan) and lists the
// cases whose outcome depends on the run or the input: that dependence is the instability.
// Usage: node --experimental-transform-types evals/task-completion/compare.ts <report-dir> <report-dir> ...
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SCENARIOS } from './grade.ts';

type Result = { id: string; scenario: keyof typeof SCENARIOS; brief: string; passed: boolean; interrupted?: boolean; wrongExecution: boolean; wrongDraft: boolean; reasons: string[]; turns: { text: string }[] };
const dirs = process.argv.slice(2);
if (dirs.length < 2) throw new Error('至少给两个报告目录');
const runs = dirs.map(dir => {
 const report = JSON.parse(readFileSync(resolve(dir, 'report.json'), 'utf8')) as { meta: { input: string; voice: string | null; repeat: number; model: string | null }; results: Result[] };
 return { dir, label: report.meta.input === 'audio' ? `语音·${report.meta.voice}` : report.meta.input === 'asr' ? `转写·${report.meta.voice}` : '文字', ...report };
});
const ids = [...new Set(runs.flatMap(r => r.results.map(x => x.id)))];
// ✓ done in one go · ◐ done but the conversation broke off on the way · ✗ not done
const mark = (x: Result) => x.passed ? (x.interrupted ? '◐' : '✓') : '✗';
const marks = (id: string) => runs.map(run => run.results.filter(x => x.id === id).map(mark).join(''));
const outcomes = (id: string) => runs.flatMap(run => run.results.filter(x => x.id === id).map(mark));
const unstable = ids.filter(id => new Set(outcomes(id)).size > 1);
const alwaysPass = ids.filter(id => outcomes(id).every(m => m === '✓'));
const alwaysFail = ids.filter(id => outcomes(id).every(m => m === '✗'));
const alwaysBroken = ids.filter(id => outcomes(id).every(m => m !== '✓'));
const first = (id: string) => runs[0].results.find(x => x.id === id)!;
const dangerous = runs.flatMap(run => run.results.filter(x => x.wrongExecution || x.wrongDraft).map(x => ({ run: run.label, ...x })));

const pct = (n: number, d: number) => d ? `${(100 * n / d).toFixed(1)}%` : '—';
const lines = [
 '# 稳定性对照', '',
 `对照 ${runs.length} 组运行：${runs.map(r => `${r.label}×${r.meta.repeat}`).join('、')}；模型 ${runs[0].meta.model || '无'}。`, '',
 '✓ 一次办完　◐ 办成但中途被打断　✗ 没办成', '',
 '| 场景 | 用例 | 每次都一次办完 | 结果随运行或输入变化 | 每次都没办成 | 每次都没能一次办完 |', '|---|---|---|---|---|---|',
 ...Object.entries(SCENARIOS).map(([key, label]) => {
  const own = ids.filter(id => first(id)?.scenario === key);
  return own.length ? `| ${label} | ${own.length} | ${pct(own.filter(id => alwaysPass.includes(id)).length, own.length)} | ${own.filter(id => unstable.includes(id)).length} | ${own.filter(id => alwaysFail.includes(id)).length} | ${own.filter(id => alwaysBroken.includes(id)).length} |` : '';
 }).filter(Boolean),
 `| **合计** | ${ids.length} | **${pct(alwaysPass.length, ids.length)}** | ${unstable.length} | ${alwaysFail.length} | ${alwaysBroken.length} |`, '',
 `误执行 ${dangerous.filter(d => d.wrongExecution).length} 次，错误草稿 ${dangerous.filter(d => d.wrongDraft).length} 次。`, '',
 '## 全部用例对照', '', `| 用例 | 赛题项 | ${runs.map(r => r.label).join(' | ')} |`, `|---|---|${runs.map(() => '---').join('|')}|`,
 ...ids.map(id => `| ${id}${unstable.includes(id) ? ' ⚠' : ''} | ${first(id).brief} | ${marks(id).join(' | ')} |`), '',
 ...(dangerous.length ? ['## 危险结果', '', ...dangerous.map(d => `- ${d.run} ${d.id}：${d.reasons.join('；')}（输入：${d.turns.map(t => t.text).join(' / ')}）`), ''] : []),
];
const out = resolve(dirs[0], '..', `stability-compare-${new Date().toISOString().replace(/[:.]/g, '-')}.md`);
writeFileSync(out, lines.join('\n') + '\n');
console.log(lines.slice(0, 14).join('\n'));
console.log(`\n对照报告：${out}`);
