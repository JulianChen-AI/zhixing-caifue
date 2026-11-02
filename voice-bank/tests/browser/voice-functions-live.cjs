// Real Qwen WebRTC probe. Default SCENARIO=smoke uses the real provider and
// synthetic bank data. Keyboard turns test the live tool chain, not ASR.
// SCENARIO=baseline replays the original failing input; SCENARIO=audio sends
// locally synthesized speech through a virtual microphone and tests actual ASR.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));

const base = process.env.BANK_TEST_URL || 'http://127.0.0.1:5180';
const scenario = process.env.SCENARIO || 'smoke'; // Makes real-provider use explicit by default.
const smokeGroup = process.env.SMOKE_GROUP || 'all';
const aux = '/Users/chenjunpeng/30_Developer/webank-aa-voice-20261026';
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const defaultName = scenario === 'smoke' && smokeGroup !== 'all' ? `smoke-${smokeGroup}-${runId}.json` : `${scenario}-${runId}.json`;
const requestedOutput = process.env.BANK_TEST_REPORT || path.join(aux, defaultName);
const output = fs.existsSync(requestedOutput) ? `${requestedOutput.replace(/\.json$/i, '')}-${runId}.json` : requestedOutput;
const baselineText = '三个人AA一百块钱，先把卡片给我看';
const aaNames = ['我', '室友张三', '房东张三'];
const productIds = ['fund-cash', 'fund-bond'];
const aaTurns = [
  { input: '三个人总共100元做AA，先把卡片给我看', id: 'TR05', operation: 'run', params: p => p.action === 'create', check: ({ state, task, dom }) => {
    assert.equal(state.view, 'workflow'); assert.equal(task?.status, 'collecting'); assert.equal(task?.functionId, 'TR05');
    assert.equal(task?.params.total, 100); assert.ok(!Array.isArray(task?.params.participants) || task.params.participants.length < 2);
    assert.equal(state.workflows.records.aa.length, 0); assert.equal(dom.workflowCardVisible, true);
  } },
  { input: '参与者是我、室友张三和房东张三，总额120元，每人40元', id: 'TR05', operation: 'amend', params: p => Array.isArray(p.participants), check: ({ state, task, dom }) => {
    assert.equal(task?.status, 'review'); assert.equal(task?.params.total, 120);
    assert.deepEqual([...(task?.params.participants || [])].sort(), [...aaNames].sort());
    const entries = Object.fromEntries((dom.reviewEntries || []).map(x => [x.label, x.value]));
    assert.match(entries['AA 总额（元）'] || '', /120/); assert.match(entries['参与者'] || '', /我.*室友张三.*房东张三/);
    assert.equal(task.params.total / task.params.participants.length, 40);
    assert.equal(state.workflows.records.aa.length, 0); assert.equal(dom.workflowCardVisible, true);
  } },
  { input: '改口把总额改成150元，还是我、室友张三和房东张三三个人平分', id: 'TR05', operation: 'amend', params: p => p.total === 150, check: ({ state, task, dom }) => {
    assert.equal(task?.status, 'review'); assert.equal(task?.params.total, 150);
    assert.deepEqual([...(task?.params.participants || [])].sort(), [...aaNames].sort());
    const entries = Object.fromEntries((dom.reviewEntries || []).map(x => [x.label, x.value]));
    assert.match(entries['AA 总额（元）'] || '', /150/); assert.match(entries['参与者'] || '', /我.*室友张三.*房东张三/);
    assert.equal(state.workflows.records.aa.length, 0); assert.equal(dom.workflowCardVisible, true);
  } },
  { input: '取消当前这份还未确认的AA草稿', id: 'TR05', operation: 'cancel', params: () => true, check: ({ state, task, dom }) => {
    assert.equal(task?.status, 'cancelled'); assert.equal(state.workflows.records.aa.length, 0); assert.equal(dom.workflowCardVisible, true);
  } },
  { input: '我、室友张三和房东张三共120元AA，创建一张需要我核对的卡片', id: 'TR05', operation: 'run', params: p => p.action === 'create' && p.total === 120, check: ({ state, task, dom }) => {
    assert.equal(task?.status, 'review'); assert.equal(task?.params.total, 120);
    assert.deepEqual([...(task?.params.participants || [])].sort(), [...aaNames].sort());
    assert.equal(state.workflows.records.aa.length, 0); assert.equal(dom.workflowCardVisible, true);
  } },
  { input: '确认当前信息', id: 'TR05', operation: 'confirm', params: () => true, check: ({ state, task, dom }) => {
    assert.equal(task?.status, 'complete'); assert.equal(state.workflows.records.aa.length, 1);
    const aa = state.workflows.records.aa[0]; assert.equal(aa.total, 12000); assert.equal(aa.status, 'awaiting_participants');
    assert.equal(task.result?.id, aa.id); assert.equal(task.result?.total, aa.total);
    assert.deepEqual(aa.participants.map(x => x.amount), [4000, 4000, 4000]);
    assert.deepEqual(aa.participants.map(x => x.name).sort(), [...aaNames].sort()); assert.equal(dom.workflowCardVisible, true);
  } },
  { input: '查一下AA收款记录和每位参与者的状态', id: 'TR05', operation: 'run', params: p => p.action === 'list', check: ({ state, task, dom, requests }) => {
    assert.ok(requests.every(r => r.arguments?.functionId !== 'TR06'), 'AA lookup must not use TR06 transfer receipts');
    assert.equal(task?.functionId, 'TR05'); assert.equal(task?.status, 'complete'); assert.equal(state.workflows.records.aa.length, 1);
    assert.ok(Array.isArray(task?.result), 'AA read must return records, not the function directory');
    assert.equal(task.result.length, 1); assert.equal(task.result[0].id, state.workflows.records.aa[0].id); assert.equal(task.result[0].total, 12000);
    assert.equal(dom.workflowCardVisible, true);
  } },
];
const readTurns = [
  { input: '查看我的收款联系人清单，只读取不修改', id: 'TR08', operation: 'run', params: p => p.action === 'list', check: ({ state, task, dom, businessHashBefore, businessHashAfter }) => {
    assert.equal(task?.status, 'complete'); assert.ok(Array.isArray(task?.result)); assert.ok(task.result.some(x => x.id === 'zhang-roommate' && x.label === '室友'));
    assert.equal(state.view, 'workflow'); assert.equal(dom.workflowCardVisible, true); assert.equal(businessHashAfter, businessHashBefore);
  } },
  { input: '比较演示现金基金和演示债券基金这两款产品，只读比较', id: 'IN07', operation: 'run', params: p => productIds.every(id => p.productIds?.includes(id)), check: ({ state, task, dom, businessHashBefore, businessHashAfter }) => {
    assert.equal(task?.status, 'complete'); assert.equal(task?.functionId, 'IN07'); assert.deepEqual(task.result?.products?.map(x => x.id).sort(), [...productIds].sort());
    assert.equal(dom.workflowCardVisible, true); assert.equal(businessHashAfter, businessHashBefore);
  } },
  { input: '查看2026年10月的月度账单报告，只读查询', ids: ['BI01', 'BI02', 'BI06'], operation: 'run', params: p => p.period === '2026-10', check: ({ task, dom, businessHashBefore, businessHashAfter }) => {
    assert.equal(task?.status, 'complete'); assert.ok(['BI01', 'BI02', 'BI06'].includes(task?.functionId));
    assert.ok(task?.result, 'Bill query must return backend data');
    if (task.functionId === 'BI06') assert.equal(task.result.period, '2026-10');
    if (task.functionId === 'BI01') assert.ok(task.result.transactions?.length > 0);
    if (task.functionId === 'BI02') assert.ok(task.result.current || task.result.grossExpenses != null);
    assert.equal(dom.workflowCardVisible, true); assert.equal(businessHashAfter, businessHashBefore);
  } },
  { input: '查看我的订阅清单，只读取不更改', id: 'SU01', operation: 'run', params: () => true, check: ({ task, dom, businessHashBefore, businessHashAfter }) => {
    assert.equal(task?.status, 'complete'); assert.deepEqual(task?.result?.map(x => x.id).sort(), ['sub-cloud', 'sub-loan', 'sub-video']);
    assert.equal(dom.workflowCardVisible, true); assert.equal(businessHashAfter, businessHashBefore);
  } },
  { input: '查看我的银行卡列表和状态，只读查询', id: 'CA01', operation: 'run', params: () => true, check: ({ task, dom, businessHashBefore, businessHashAfter }) => {
    assert.equal(task?.status, 'complete'); assert.deepEqual(task?.result?.map(x => x.id).sort(), ['card-daily', 'card-judicial', 'card-risk']);
    assert.equal(dom.workflowCardVisible, true); assert.equal(businessHashAfter, businessHashBefore);
  } },
];
// The earlier full AA run already verified incomplete collection, amendment,
// and cancellation. This short branch reuses its exact review/confirm/list
// cases before the independent read-only module group.
const aaShortTurns = [aaTurns[4], aaTurns[5], aaTurns[6]];
const audioUtterances = [
  '我们三个人AA，总共一百二十元，每人四十元。参与者是我、室友张三、房东张三。先把卡片给我看，不要提交。',
  '查看二零二六年十月账单。',
];
const savedAudioClips = [
  { file: '/Users/chenjunpeng/30_Developer/webank-aa-voice-20261026/synthetic-1-meijia-1793011674727.wav', voice: 'Meijia', sha256: 'cd1ee42ce130f99f4b4f5a034cdeba6ead1bc294cb7ff77339adc04aef184823' },
  { file: '/Users/chenjunpeng/30_Developer/webank-aa-voice-20261026/synthetic-2-meijia-1793011676163.wav', voice: 'Meijia', sha256: '06df64afccf4b77f555c98f7e5dc1315ab0176e95038651652041801b81bbd30' },
];

const report = {
  scenario,
  classification: { realQwenWebRTCProvider: true, syntheticBankOnly: true, humanMicrophoneTested: false, textTurnsValidateASR: false, audioSafeFallbackIndependentOfStrictTranscription: scenario === 'audio-safe' },
  serverConfigPresence: { '.env': fs.existsSync(path.resolve('.env')), '.env.local': fs.existsSync(path.resolve('.env.local')), '.dev.vars': fs.existsSync(path.resolve('.dev.vars')) },
  sessions: [], status: 'running',
};
let activeBrowser = null, interrupted = false;
function saveReport() {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, (key, value) => ['page', 'context', 'pending', 'setTurnIndex'].includes(key) || typeof value === 'function' ? undefined : value, 2));
}
process.on('SIGINT', () => {
  interrupted = true; report.status = 'interrupted'; report.interruption = 'SIGINT received; isolated browser context closed.';
  saveReport(); void activeBrowser?.close().catch(() => {});
});
const omit = Symbol('omit');
function safe(value, key = '') {
  if (/(?:token|secret|sdp|authorization|verification|credential|headers|password|\bcode\b)/i.test(key)) return omit;
  if (Array.isArray(value)) return value.map(v => safe(v)).filter(v => v !== omit);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, safe(v, k)]).filter(([, v]) => v !== omit));
  if (typeof value === 'string') return value
    .replace(/("(?:token|secret|sdp|authorization|verificationId|code)"\s*:\s*)"[^"]*"/gi, '$1"[redacted]"')
    .replace(/\b\d{6,}\b/g, '[redacted-number]');
  return value;
}
function currentTask(state) {
  return state?.workflows?.tasks?.find(t => t.id === state.workflows?.currentTaskId) || null;
}
function recordCounts(state) {
  return Object.fromEntries(Object.entries(state?.workflows?.records || {}).map(([k, v]) => [k, Array.isArray(v) ? v.length : null]));
}
function compactRow(row) {
  if (!row || typeof row !== 'object') return row;
  const keys = ['id', 'functionId', 'name', 'title', 'label', 'status', 'total', 'amount', 'period', 'periodType', 'periodSource', 'risk', 'type', 'productId', 'channel', 'cycle'];
  const out = Object.fromEntries(keys.filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]]));
  if (Array.isArray(row.participants)) out.participants = row.participants.map(p => ({ name: p.name, amount: p.amount, status: p.status }));
  return safe(out);
}
function resultSummary(value) {
  if (Array.isArray(value)) return { kind: 'array', length: value.length, items: value.slice(0, 10).map(compactRow) };
  if (!value || typeof value !== 'object') return value;
  const out = { kind: 'object', keys: Object.keys(value), ...compactRow(value) };
  for (const key of ['period', 'periodType', 'periodSource', 'summary', 'count', 'grossExpenses', 'netExpenses', 'refunds', 'income', 'remaining', 'progress', 'risk', 'type', 'status']) {
    if (!Object.hasOwn(value, key)) continue;
    out[key] = key === 'summary' && value.summary && typeof value.summary === 'object'
      ? Object.fromEntries(['period', 'periodType', 'grossExpenses', 'netExpenses', 'refunds', 'income', 'count'].filter(k => Object.hasOwn(value.summary, k)).map(k => [k, value.summary[k]]))
      : value[key];
  }
  for (const key of ['products', 'subscriptions', 'cards', 'contacts', 'transactions', 'aa', 'bindings']) {
    if (Array.isArray(value[key])) out[key] = { count: value[key].length, items: value[key].slice(0, 10).map(compactRow) };
  }
  if (Array.isArray(value.differences)) out.differenceFields = value.differences.map(x => x.field);
  if (Array.isArray(value.missing)) out.missingFields = value.missing.map(x => x.field);
  return safe(out);
}
function stateSummary(data) {
  const state = data?.state || data;
  if (!state || typeof state !== 'object') return null;
  const task = currentTask(state);
  return {
    revision: state.revision, view: state.view,
    currentWorkflow: task && safe({ id: task.id, functionId: task.functionId, title: task.title, status: task.status, params: task.params, missing: task.missing, resultPresent: task.result != null, resultKeys: task.result && typeof task.result === 'object' ? Object.keys(task.result) : [], result: task.result == null ? null : resultSummary(task.result) }),
    workflowTaskCount: state.workflows?.tasks?.length || 0,
    recordCounts: recordCounts(state),
    aaRecords: safe((state.workflows?.records?.aa || []).map(a => ({ id: a.id, total: a.total, status: a.status, participants: a.participants?.map(p => ({ name: p.name, amount: p.amount, status: p.status })) }))),
  };
}
function businessFingerprint(state) {
  const records = state?.workflows?.records || {};
  const core = {
    accounts: state?.accounts?.map(a => ({ id: a.id, balance: a.balance, status: a.status })),
    receipts: state?.receipts,
    records: Object.fromEntries(Object.entries(records).filter(([, v]) => Array.isArray(v))),
  };
  return crypto.createHash('sha256').update(JSON.stringify(core)).digest('hex');
}
async function readBank(page) {
  const response = await page.request.get(`${base}/api/bank`);
  const data = await response.json().catch(() => null);
  return { status: response.status(), data, state: data?.state || null };
}
async function domSummary(page, state) {
  return page.evaluate(s => {
    const workflow = document.querySelector('section[aria-label="功能办理卡片"]');
    const other = document.querySelector('section.business-card[aria-label="当前办理卡片"]');
    const card = workflow || other;
    return {
      bankView: s?.view || null,
      workflowCardVisible: Boolean(workflow && workflow.getClientRects().length),
      currentBusinessCardVisible: Boolean(other && other.getClientRects().length),
      cardTitle: card?.querySelector('h2')?.textContent?.trim() || null,
      cardStatus: card?.querySelector('.card-top span')?.textContent?.trim() || card?.querySelector('.eyebrow')?.textContent?.trim() || null,
      reviewEntries: workflow ? [...workflow.querySelectorAll('.flow-review .flow-result-fields > div')].map(row => ({ label: row.querySelector('dt')?.textContent?.trim() || '', value: row.querySelector('dd')?.textContent?.trim() || '' })) : [],
    };
  }, state);
}
async function makeSyntheticWav(text, index) {
  const available = execFileSync('say', ['-v', '?'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const voices = available.split(/\r?\n/).map(line => line.trim().split(/\s+/)[0]).filter(Boolean);
  const requested = process.env.SAY_VOICE || 'Meijia';
  const voice = voices.includes(requested) ? requested : voices.includes('Meijia') ? 'Meijia' : voices.includes('Sinji') ? 'Sinji' : null;
  if (!voice) throw new Error('No compatible local Chinese macOS say voice is installed.');
  let file = path.join(aux, `synthetic-${index}-${voice.toLowerCase()}-${Date.now()}.wav`);
  execFileSync('say', ['-v', voice, '-o', file, '--file-format=WAVE', '--data-format=LEI16@24000', text], { timeout: 20000, stdio: 'ignore' });
  const bytes = fs.readFileSync(file);
  return { file, voice, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), base64: bytes.toString('base64') };
}
function loadSavedWav(clip) {
  const bytes = fs.readFileSync(clip.file), sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha256, clip.sha256, `Synthetic audio baseline changed: ${clip.file}`);
  return { ...clip, bytes: bytes.length, base64: bytes.toString('base64') };
}
function exactNamesInTranscript(transcripts, names) {
  const normalized = transcripts.join('').replace(/[\s，,。.!！?？、；;：:]/g, '');
  return names.every(name => normalized.includes(name));
}

async function createSession(browser, name) {
  const context = await browser.newContext();
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  const session = { name, context, page, provider: { liveConfigured: null, sessionStatus: null, sessionUpdated: false, errors: [] }, initialState: null, finalState: null, turns: [], eventTypes: [], functionCalls: [], bankRequests: [], bankResponses: [], browserErrorCount: 0, cleanup: null };
  let currentTurnIndex = -1;
  const requestTurn = new WeakMap();
  const pending = new Set();
  page.on('pageerror', () => { session.browserErrorCount++; });
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname !== '/api/bank' || request.method() !== 'POST') return;
    let body; try { body = request.postDataJSON(); } catch { return; }
    if (!body?.tool) return;
    const origin = String(body.requestId || '').startsWith('voice-literal-') ? (body.tool.arguments?.operation === 'confirm' ? 'literal-confirmation' : 'literal-shortcut') : 'qwen-function-call';
    const entry = { turnIndex: currentTurnIndex, origin, name: body.tool.name, arguments: safe(body.tool.arguments), utterance: safe(body.tool.utterance), historyCount: body.tool.history?.length || 0, revision: body.revision };
    session.bankRequests.push(entry); requestTurn.set(request, entry.turnIndex); pending.add(request);
  });
  page.on('response', async response => {
    const request = response.request(), url = new URL(response.url());
    if (url.pathname === '/api/live/session' && request.method() === 'POST') { session.provider.sessionStatus = response.status(); return; } // Deliberately never read SDP.
    if (url.pathname !== '/api/bank' || request.method() !== 'POST') return;
    let body; try { body = request.postDataJSON(); } catch { body = null; }
    if (!body?.tool) return;
    pending.delete(request);
    let data = null; try { data = await response.json(); } catch {}
    const doneCount = await page.evaluate(() => window.__voiceFunctionsLive?.eventTypes.filter(t => t === 'response.done').length || 0).catch(() => 0);
    session.bankResponses.push({ turnIndex: requestTurn.get(request) ?? -1, status: response.status(), error: typeof data?.error === 'string' ? safe(data.error) : null, state: data?.state ? stateSummary(data) : null, responseDoneCountAtReturn: doneCount });
  });
  await page.addInitScript(() => {
    const trace = window.__voiceFunctionsLive = { eventTypes: [], errors: [], unexpectedErrorCount: 0, calls: new Map(), user: new Map(), assistant: new Map(), peerConnections: [], mediaTracks: [], audioContext: null, destination: null };
    const scrub = value => {
      if (Array.isArray(value)) return value.map(scrub);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !/(?:token|secret|sdp|authorization|verification|credential|headers|password|^code$)/i.test(key)).map(([key, item]) => [key, scrub(item)]));
      if (typeof value === 'string') return value.replace(/\b\d{6,}\b/g, '[redacted-number]');
      return value;
    };
    const observe = channel => channel.addEventListener('message', event => {
      let e; try { e = JSON.parse(event.data); } catch { return; }
      if (typeof e.type === 'string') trace.eventTypes.push(e.type);
      if (e.type === 'session.updated') trace.sessionUpdated = true;
      if (e.type === 'error') {
        const expectedCancellation = e.error?.code === 'response_cancel_not_active' || e.error?.type === 'invalid_request_error' && e.error?.message === 'Response request cancelled by new input';
        trace.errors.push({ type: e.error?.type || null, code: e.error?.code || null });
        if (!expectedCancellation) trace.unexpectedErrorCount++;
      }
      if (e.type === 'conversation.item.input_audio_transcription.completed') trace.user.set(String(e.item_id || trace.user.size), String(e.transcript || ''));
      if (e.type === 'response.audio_transcript.delta') { const id = String(e.item_id || e.response_id || trace.assistant.size); trace.assistant.set(id, (trace.assistant.get(id) || '') + String(e.delta || '')); }
      if (e.type === 'response.audio_transcript.done') trace.assistant.set(String(e.item_id || e.response_id || trace.assistant.size), String(e.transcript || ''));
      const item = e.item?.type === 'function_call' ? e.item : null;
      if (e.type === 'response.function_call_arguments.done' || e.type === 'response.output_item.done' && item) {
        const id = String(e.call_id || item?.call_id || item?.id || e.item_id || 'unknown');
        const args = typeof e.arguments === 'string' ? e.arguments : typeof item?.arguments === 'string' ? item.arguments : e.arguments && typeof e.arguments === 'object' ? JSON.stringify(e.arguments) : '';
        let cleanArgs = args;
        try { cleanArgs = JSON.stringify(scrub(JSON.parse(args))); } catch { cleanArgs = args.replace(/("(?:token|secret|sdp|authorization|verificationId|code)"\s*:\s*)"[^"]*"/gi, '$1"[redacted]"]').replace(/\b\d{6,}\b/g, '[redacted-number]'); }
        const old = trace.calls.get(id) || {}; trace.calls.set(id, { name: String(e.name || item?.name || old.name || ''), arguments: cleanArgs || old.arguments || '' });
      }
    });
    const NativePeer = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends NativePeer {
      constructor(...args) { super(...args); trace.peerConnections.push(this); this.addEventListener('datachannel', e => observe(e.channel)); }
      createDataChannel(...args) { const channel = super.createDataChannel(...args); observe(channel); return channel; }
    };
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = trace.audioContext = new AudioContext(); await ctx.resume();
      const destination = trace.destination = ctx.createMediaStreamDestination();
      const stream = destination.stream; trace.mediaTracks.push(...stream.getTracks()); return stream;
    };
  });
  await page.goto(base, { waitUntil: 'networkidle' });
  const initial = await readBank(page); session.initialState = { status: initial.status, state: stateSummary(initial.data) };
  session.provider.liveConfigured = typeof initial.data?.liveConfigured === 'boolean' ? initial.data.liveConfigured : null;
  const start = page.getByRole('button', { name: '开始对话', exact: true }).first();
  if (await start.count() && await start.isVisible().catch(() => false)) await start.click();
  else {
    await page.getByRole('button', { name: '开始语音对话', exact: true }).click();
    const firstConnect = page.getByRole('button', { name: '连接实时语音', exact: true });
    if (await firstConnect.isVisible().catch(() => false)) await firstConnect.click();
  }
  const connect = page.getByRole('button', { name: '连接实时语音', exact: true });
  if (await connect.isVisible().catch(() => false)) await connect.click();
  await page.getByRole('button', { name: '静音', exact: true }).waitFor({ timeout: 65000 });
  await page.waitForFunction(() => window.__voiceFunctionsLive?.sessionUpdated === true, null, { timeout: 10000 });
  session.provider.connectedLiveUi = true;
  session.provider.sessionUpdated = true;
  return { ...session, pending, setTurnIndex: index => { currentTurnIndex = index; }, context };
}
async function counts(page) {
  return page.evaluate(() => {
    const t = window.__voiceFunctionsLive;
    return { done: t.eventTypes.filter(e => e === 'response.done').length, events: t.eventTypes.length, user: t.user.size, assistant: t.assistant.size, errors: t.errors.length, unexpectedErrors: t.unexpectedErrorCount, calls: t.calls.size };
  });
}
async function waitForTurn(session, before, turnIndex, needAsr = false) {
  const { page, pending } = session, start = Date.now();
  const deadline = 35000;
  let stable = null;
  while (Date.now() - start < deadline) {
    const c = await counts(page);
    const requests = session.bankRequests.filter(r => r.turnIndex === turnIndex);
    const responses = session.bankResponses.filter(r => r.turnIndex === turnIndex);
    const doneAfterLastResponse = !responses.length || c.done > Math.max(...responses.map(r => r.responseDoneCountAtReturn));
    const turnObserved = (needAsr ? c.user > before.user : c.done > before.done) || c.errors > before.errors;
    const complete = turnObserved && (!requests.length || responses.length >= requests.length && doneAfterLastResponse) && pending.size === 0;
    const signature = `${c.done}:${c.events}:${c.user}:${requests.length}:${responses.length}:${c.errors}`;
    if (complete) {
      if (stable?.signature === signature && Date.now() - stable.since >= 1800) break;
      if (stable?.signature !== signature) stable = { signature, since: Date.now() };
    } else stable = null;
    await new Promise(resolve => setTimeout(resolve, 350));
  }
  return { elapsedMs: Date.now() - start, timedOut: Date.now() - start >= deadline };
}
function functionArguments(request) { return request?.arguments || {}; }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
async function runTurn(session, test, index, inputChannel = 'keyboard-live') {
  const { page } = session;
  session.setTurnIndex(index);
  const turn = { index, input: test.input, inputChannel, expectedFunctions: test.ids || [test.id], expectedOperation: test.operation, startedAt: new Date().toISOString(), assertions: [] };
  session.turns.push(turn);
  saveReport();
  const beforeCounts = await counts(page), beforeRead = await readBank(page), beforeBusinessHash = businessFingerprint(beforeRead.state);
  if (inputChannel === 'keyboard-live') {
    const composer = page.getByLabel('输入你的要求', { exact: true });
    if (!await composer.isVisible().catch(() => false)) await page.getByRole('button', { name: '键盘输入', exact: true }).click();
    await composer.fill(test.input);
    await page.getByRole('button', { name: '发送', exact: true }).click();
  } else if (inputChannel === 'synthetic-audio') {
    const wav = test.wav;
    await page.evaluate(async base64 => {
      const t = window.__voiceFunctionsLive, raw = atob(base64), bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const buffer = await t.audioContext.decodeAudioData(bytes.buffer);
      const source = t.audioContext.createBufferSource(); source.buffer = buffer; source.connect(t.destination); t.lastAudioSource = source; source.start();
      await new Promise(resolve => { source.onended = resolve; });
    }, wav.base64);
    turn.syntheticAudio = { file: wav.file, voice: wav.voice, bytes: wav.bytes, sha256: wav.sha256 };
  } else throw new Error(`Unknown input channel: ${inputChannel}`);
  turn.wait = await waitForTurn(session, beforeCounts, index, inputChannel === 'synthetic-audio');
  const afterRead = await readBank(page), state = afterRead.state, task = currentTask(state), dom = await domSummary(page, state);
  const modelCalls = await page.evaluate(n => [...window.__voiceFunctionsLive.calls.values()].slice(n).map(call => {
    let args; try { args = JSON.parse(call.arguments); } catch { args = call.arguments; }
    return { name: call.name, arguments: args };
  }), beforeCounts.calls);
  const asr = inputChannel === 'synthetic-audio' ? await page.evaluate(n => [...window.__voiceFunctionsLive.user.values()].slice(n), beforeCounts.user) : [];
  if (test.nameSet && inputChannel === 'synthetic-audio') turn.nameExact = exactNamesInTranscript(asr, test.nameSet);
  if (test.periodPattern && inputChannel === 'synthetic-audio') turn.periodExact = test.periodPattern.test(asr.join(''));
  turn.modelFunctionCalls = modelCalls.map(call => ({ name: call.name, arguments: safe(call.arguments) }));
  const requests = session.bankRequests.filter(r => r.turnIndex === index);
  const responses = session.bankResponses.filter(r => r.turnIndex === index);
  const functions = [...new Set(requests.map(r => r.arguments?.functionId).filter(Boolean))];
  turn.actualFunctions = functions;
  turn.apiStatuses = responses.map(r => ({ status: r.status, error: r.error }));
  turn.observation = { state: stateSummary(afterRead.data), dom, businessHashBefore: beforeBusinessHash, businessHashAfter: businessFingerprint(state) };
  if (test.safeAvailability) turn.safeAvailability = {
    nameExact: turn.nameExact,
    taskStatus: task?.status || null,
    total: task?.params?.total ?? null,
    participants: Array.isArray(task?.params?.participants) ? task.params.participants : [],
    aaRecordCount: state?.workflows?.records?.aa?.length ?? null,
    cardVisible: dom.workflowCardVisible,
  };
  const inputArgs = requests.map(functionArguments);
  try {
    if ((test.id || test.ids) && test.operation === 'run') {
      const expected = test.ids || [test.id];
      assert.ok(expected.some(id => functions.includes(id)), `No expected function; expected ${expected.join('/')} got ${functions.join(',') || 'none'}`);
    } else if (test.id) assert.equal(task?.functionId, test.id, `Current task must remain ${test.id}`);
    assert.ok(requests.every(r => r.name === 'bank_function'), 'Unexpected tool name reached /api/bank');
    assert.ok(requests.length > 0, 'No /api/bank tool request reached the backend');
    const providerRequests = requests.filter(r => r.origin === 'qwen-function-call');
    const literalRequests = requests.filter(r => r.origin !== 'qwen-function-call');
    assert.equal(modelCalls.length, providerRequests.length, 'Unexpected or missing provider function_call for a non-literal bank request');
    assert.ok(modelCalls.every(call => call.name === 'bank_function'), 'Unexpected Qwen function name');
    for (const request of providerRequests) assert.ok(modelCalls.some(call => call.name === request.name && JSON.stringify(canonical(safe(call.arguments))) === JSON.stringify(canonical(request.arguments))), 'Backend tool arguments differ from the real Qwen function_call payload');
    if (test.operation === 'confirm' && literalRequests.length) assert.ok(literalRequests.every(r => r.origin === 'literal-confirmation'), 'Confirmation did not use the explicit live-confirmation path');
    if (test.operation === 'cancel' && literalRequests.length) assert.ok(literalRequests.every(r => r.origin === 'literal-shortcut'), 'Cancellation used an unexpected literal shortcut');
    assert.ok(responses.length === requests.length, 'One or more tool POSTs had no observed backend response');
    assert.ok(responses.every(r => r.status >= 200 && r.status < 300), `A bank tool request returned ${responses.map(r => r.status).join(',')}`);
    if (test.operation) assert.ok(inputArgs.some(a => a.operation === test.operation), `Missing operation ${test.operation}`);
    if (test.params) assert.ok(inputArgs.some(a => test.params(a.params || {})), 'Tool parameters did not satisfy the requested field contract');
    if (test.check) test.check({ state, task, dom, requests, responses, asr, nameExact: turn.nameExact, periodExact: turn.periodExact, businessHashBefore: beforeBusinessHash, businessHashAfter: businessFingerprint(state) });
    turn.assertions.push('expected tool payload and state behavior observed', 'matching backend state and visible card observed');
    turn.passed = true;
  } catch (error) {
    turn.passed = false; turn.assertionError = error.message; throw error;
  } finally {
    turn.completedAt = new Date().toISOString();
    turn.assistantTranscripts = await page.evaluate(n => [...window.__voiceFunctionsLive.assistant.values()].slice(n).map(x => x.replace(/\b\d{6,}\b/g, '[redacted-number]')), beforeCounts.assistant);
    turn.actualAsrTranscripts = inputChannel === 'synthetic-audio' ? await page.evaluate(n => [...window.__voiceFunctionsLive.user.values()].slice(n), beforeCounts.user) : undefined;
    saveReport();
  }
  return turn;
}
async function finishSession(session) {
  const { page, context } = session;
  session.eventTypes = await page.evaluate(() => window.__voiceFunctionsLive?.eventTypes || []).catch(() => []);
  session.provider.sessionUpdated = session.eventTypes.includes('session.updated');
  session.provider.errors = await page.evaluate(() => window.__voiceFunctionsLive?.errors || []).catch(() => []);
  session.provider.unexpectedErrorCount = await page.evaluate(() => window.__voiceFunctionsLive?.unexpectedErrorCount || 0).catch(() => 0);
  const rawCalls = await page.evaluate(() => [...(window.__voiceFunctionsLive?.calls || [])].map(([id, call]) => ({ id, name: call.name, arguments: call.arguments }))).catch(() => []);
  session.functionCalls = rawCalls.map(call => { let args; try { args = JSON.parse(call.arguments); } catch { args = call.arguments; } return { id: call.id, name: call.name, arguments: safe(args) }; });
  session.transcripts = await page.evaluate(() => ({
    user: [...(window.__voiceFunctionsLive?.user.values() || [])].map(x => x.replace(/\b\d{6,}\b/g, '[redacted-number]')),
    assistant: [...(window.__voiceFunctionsLive?.assistant.values() || [])].map(x => x.replace(/\b\d{6,}\b/g, '[redacted-number]')),
  })).catch(() => ({ user: [], assistant: [] }));
  session.finalState = (await readBank(page).catch(() => ({ status: 0, state: null })));
  session.finalState = { status: session.finalState.status, state: stateSummary(session.finalState.data || session.finalState.state) };
  await page.getByRole('button', { name: '结束对话', exact: true }).click().catch(() => {});
  await page.waitForFunction(() => window.__voiceFunctionsLive?.peerConnections.every(p => p.connectionState === 'closed') && window.__voiceFunctionsLive?.mediaTracks.every(t => t.readyState === 'ended'), null, { timeout: 5000 }).catch(() => {});
  session.cleanup = await page.evaluate(() => ({ rtcStates: window.__voiceFunctionsLive?.peerConnections.map(p => p.connectionState) || [], syntheticTracks: window.__voiceFunctionsLive?.mediaTracks.map(t => t.readyState) || [] })).catch(() => null);
  await context.close().catch(() => {});
  delete session.page; delete session.context; delete session.pending; delete session.setTurnIndex;
  return session;
}
async function runGroup(browser, name, tests) {
  const session = await createSession(browser, name);
  report.sessions.push(session); saveReport();
  try {
    assert.equal(session.initialState.status, 200); assert.equal(session.provider.liveConfigured, true);
    for (let i = 0; i < tests.length; i++) await runTurn(session, tests[i], i);
    assert.equal(session.provider.sessionStatus, 201); assert.equal(session.provider.connectedLiveUi, true); assert.equal(session.provider.sessionUpdated, true);
    session.provider.errors = await session.page.evaluate(() => window.__voiceFunctionsLive?.errors || []);
    assert.equal(await session.page.evaluate(() => window.__voiceFunctionsLive?.unexpectedErrorCount || 0), 0, 'Unexpected Qwen error event occurred');
    return await finishSession(session);
  } catch (error) {
    session.failure = error.message;
    return await finishSession(session);
  }
}
async function runAudio(browser) {
  const session = await createSession(browser, 'audio');
  report.sessions.push(session); saveReport();
  try {
    assert.equal(session.initialState.status, 200); assert.equal(session.provider.liveConfigured, true);
    const wavs = [];
    for (let i = 0; i < audioUtterances.length; i++) wavs.push(await makeSyntheticWav(audioUtterances[i], i + 1));
    report.syntheticAudioVoice = [...new Set(wavs.map(w => w.voice))];
    // First clip must remain a draft even though it contains a full equal split.
    await runTurn(session, { input: audioUtterances[0], wav: wavs[0], id: 'TR05', operation: 'run', params: p => p.total === 120, check: ({ state, task, dom, asr }) => {
      const heard = asr.join(''); assert.match(heard, /120|一百二十|一二零/); assert.match(heard, /室友/); assert.match(heard, /房东/);
      assert.ok(['review', 'collecting'].includes(task?.status)); assert.equal(task?.functionId, 'TR05'); assert.equal(task?.params.total, 120);
      assert.notEqual(task?.status, 'complete'); assert.equal(state.workflows.records.aa.length, 0); assert.equal(dom.workflowCardVisible, true);
    } }, 0, 'synthetic-audio');
    // One second utterance validates ASR on a read-only path already covered by text smoke.
    await runTurn(session, { input: audioUtterances[1], wav: wavs[1], ids: ['BI01', 'BI02', 'BI06'], operation: 'run', params: p => p.period === '2026-10', check: ({ task, dom, asr, businessHashBefore, businessHashAfter }) => {
      assert.match(asr.join(''), /十月|10/); assert.ok(['BI01', 'BI02', 'BI06'].includes(task?.functionId)); assert.equal(task?.status, 'complete'); assert.equal(dom.workflowCardVisible, true); assert.equal(businessHashAfter, businessHashBefore);
    } }, 1, 'synthetic-audio');
    assert.equal(session.provider.sessionStatus, 201); assert.equal(session.provider.connectedLiveUi, true); assert.equal(session.provider.sessionUpdated, true);
    session.provider.errors = await session.page.evaluate(() => window.__voiceFunctionsLive?.errors || []);
    assert.equal(await session.page.evaluate(() => window.__voiceFunctionsLive?.unexpectedErrorCount || 0), 0, 'Unexpected Qwen error event occurred');
    session.syntheticAudioFiles = wavs.map(({ file, voice, bytes, sha256 }) => ({ file, voice, bytes, sha256 }));
    return await finishSession(session);
  } catch (error) { session.failure = error.message; return await finishSession(session); }
}
async function runAudioSafeAA(browser, wav) {
  const session = await createSession(browser, 'audio-safe-aa');
  report.sessions.push(session); saveReport();
  try {
    assert.equal(session.initialState.status, 200); assert.equal(session.provider.liveConfigured, true);
    const test = {
      input: audioUtterances[0], wav, nameSet: aaNames, safeAvailability: true, id: 'TR05', operation: 'run', params: p => p.total === 120,
      check: ({ state, task, dom, nameExact }) => {
        assert.equal(task?.functionId, 'TR05'); assert.equal(task?.params.total, 120);
        assert.notEqual(task?.status, 'complete', 'Synthetic AA audio must never auto-confirm');
        assert.equal(state.workflows.records.aa.length, 0); assert.equal(dom.workflowCardVisible, true);
        if (nameExact) {
          assert.equal(task?.status, 'review'); assert.deepEqual(task.params.participants, aaNames);
          assert.equal(dom.cardStatus, '等待确认');
        } else {
          assert.equal(task?.status, 'collecting');
          assert.ok(!Array.isArray(task?.params.participants) || task.params.participants.length === 0, 'Unclear ASR names must not be retained or guessed');
          assert.ok(task?.missing?.includes('participants')); assert.equal(dom.cardStatus, '等待补充');
        }
      },
    };
    await runTurn(session, test, 0, 'synthetic-audio');
    if (session.turns[0].nameExact === false) {
      await runTurn(session, {
        input: '参与者是我、室友张三和房东张三，总额120元，每人40元', id: 'TR05', operation: 'amend', params: p => Array.isArray(p.participants),
        check: ({ state, task, dom }) => {
          assert.equal(task?.status, 'review'); assert.equal(task?.params.total, 120);
          assert.deepEqual([...(task?.params.participants || [])].sort(), [...aaNames].sort());
          const entries = Object.fromEntries((dom.reviewEntries || []).map(x => [x.label, x.value]));
          assert.match(entries['AA 总额（元）'] || '', /120/); assert.match(entries['参与者'] || '', /我.*室友张三.*房东张三/);
          assert.equal(state.workflows.records.aa.length, 0); assert.equal(dom.workflowCardVisible, true);
        },
      }, 1, 'keyboard-live');
      session.textCorrectionAfterASRMiss = 'passed; keyboard text, not ASR';
    }
    assert.equal(session.provider.sessionStatus, 201); assert.equal(session.provider.sessionUpdated, true);
    session.provider.errors = await session.page.evaluate(() => window.__voiceFunctionsLive?.errors || []);
    assert.equal(await session.page.evaluate(() => window.__voiceFunctionsLive?.unexpectedErrorCount || 0), 0, 'Unexpected Qwen error event occurred');
  } catch (error) { session.failure = error.message; }
  return await finishSession(session);
}
async function runAudioSafeRead(browser, wav) {
  const session = await createSession(browser, 'audio-safe-read');
  report.sessions.push(session); saveReport();
  try {
    assert.equal(session.initialState.status, 200); assert.equal(session.provider.liveConfigured, true);
    const bill = { ...readTurns[2], input: audioUtterances[1], wav, periodPattern: /十月|10/, check: ({ task, dom, businessHashBefore, businessHashAfter, periodExact }) => {
      assert.equal(periodExact, true, 'Bill month was not recognized in synthetic speech');
      assert.equal(task?.status, 'complete'); assert.ok(['BI01', 'BI02', 'BI06'].includes(task?.functionId));
      if (task.functionId === 'BI06') assert.equal(task.result?.period, '2026-10');
      if (task.functionId === 'BI01') assert.ok(task.result?.transactions?.length > 0);
      if (task.functionId === 'BI02') assert.ok(task.result?.current || task.result?.grossExpenses != null);
      assert.equal(dom.workflowCardVisible, true); assert.equal(businessHashAfter, businessHashBefore);
    } };
    await runTurn(session, bill, 0, 'synthetic-audio');
    assert.equal(session.provider.sessionStatus, 201); assert.equal(session.provider.sessionUpdated, true);
    session.provider.errors = await session.page.evaluate(() => window.__voiceFunctionsLive?.errors || []);
    assert.equal(await session.page.evaluate(() => window.__voiceFunctionsLive?.unexpectedErrorCount || 0), 0, 'Unexpected Qwen error event occurred');
  } catch (error) { session.failure = error.message; }
  return await finishSession(session);
}
async function runAudioSafe(browser) {
  const aaWav = loadSavedWav(savedAudioClips[0]), billWav = loadSavedWav(savedAudioClips[1]);
  report.audioSafeMode = { preservesStrictASRFailureScenario: true, nameExactIsMeasuredNotAssumed: true, readoutContinuesInIndependentSessionAfterAAFailure: true };
  report.reusedSyntheticWavs = [aaWav, billWav].map(({ file, voice, bytes, sha256 }) => ({ file, voice, bytes, sha256 }));
  report.strictASRFailureReference = '/Users/chenjunpeng/30_Developer/webank-aa-voice-20261026/audio-2026-10-26T10-47-52-185Z.json';
  saveReport();
  const aa = await runAudioSafeAA(browser, aaWav);
  // Independent new Qwen session: report read-only ASR even when AA fails.
  const bill = await runAudioSafeRead(browser, billWav);
  return [aa, bill];
}
async function runBaseline(browser) {
  const session = await createSession(browser, 'baseline');
  report.sessions.push(session); saveReport();
  try {
    const index = 0; session.setTurnIndex(index);
    const before = await counts(session.page);
    await session.page.getByRole('button', { name: '键盘输入', exact: true }).click();
    await session.page.getByLabel('输入你的要求', { exact: true }).fill(baselineText);
    await session.page.getByRole('button', { name: '发送', exact: true }).click();
    const wait = await waitForTurn(session, before, index);
    const current = await readBank(session.page);
    const turn = { index, input: baselineText, inputChannel: 'keyboard text entered through the live Qwen UI; not ASR', wait, state: stateSummary(current.data), dom: await domSummary(session.page, current.state), bankRequests: session.bankRequests.filter(r => r.turnIndex === index), bankResponses: session.bankResponses.filter(r => r.turnIndex === index) };
    session.turns.push(turn);
    return await finishSession(session);
  } catch (error) { session.failure = error.message; return await finishSession(session); }
}
async function main() {
  fs.mkdirSync(aux, { recursive: true });
  const browser = activeBrowser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    if (scenario === 'baseline') await runBaseline(browser);
    else if (scenario === 'smoke') {
      const groups = smokeGroup === 'all' ? [['aa', aaTurns], ['read', readTurns]] : smokeGroup === 'aa' ? [['aa', aaTurns]] : smokeGroup === 'short' ? [['aa-short', aaShortTurns], ['read', readTurns]] : smokeGroup === 'read' ? [['read', readTurns]] : [];
      if (!groups.length) throw new Error('SMOKE_GROUP must be all, aa, short, or read.');
      for (const [name, tests] of groups) {
        const result = await runGroup(browser, name, tests);
        if (result.failure) break; // Stop at the first broken group; don't amplify a provider/tool defect.
      }
    } else if (scenario === 'audio') await runAudio(browser);
    else if (scenario === 'audio-safe') await runAudioSafe(browser);
    else throw new Error(`Unsupported SCENARIO: ${scenario}`);
    const failures = report.sessions.flatMap(s => [s.failure, ...s.turns.filter(t => t.passed === false).map(t => t.assertionError)].filter(Boolean));
    if (!interrupted) { report.status = failures.length ? 'failed' : 'completed'; if (failures.length) report.failures = failures; }
  } catch (error) { if (!interrupted) { report.status = 'execution_error'; report.executionError = error.message; } }
  finally {
    saveReport();
    console.log(JSON.stringify({ status: report.status, scenario, output, sessions: report.sessions.map(s => ({ name: s.name, provider: s.provider, turns: s.turns.map(t => ({ input: t.input, functions: t.actualFunctions || t.bankRequests?.map(r => r.arguments?.functionId), statuses: t.apiStatuses || t.bankResponses?.map(r => ({ status: r.status, error: r.error })), state: t.observation?.state || t.state, dom: t.observation?.dom || t.dom, passed: t.passed })), failure: s.failure || null, cleanup: s.cleanup })), failures: report.failures || (report.executionError ? [report.executionError] : []) }, null, 2));
    await browser.close().catch(() => {}); activeBrowser = null;
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
