# 转账＋分项 AA 真实模型视频（S02-A）

2026-10-31 制作成片所用的脚本。助手语音来自真实 Qwen 实时会话；画面用打包后的真实页面组件，按录到的后台状态逐帧回放。

1. `node scripts/tts-user.mjs <.dev.vars> out/audio work/user-lines.json`：用 qwen3-tts-flash（Ethan）合成用户台词。
2. 启动应用（场景接口可用），再用 `node scripts/helper-server.mjs 5203` 提供台词音频、接收录音。
3. 在**应用内浏览器**打开应用：先加载 S02-A，再注入 `http://localhost:5203/hooks.js`，然后开始语音对话。依次 `__filmRec.play('user-0N')`、`settle()`，每步结束调用 `snap(label)`，最后 `finish()`。录音、事件和状态会保存到 `work/<run>/`。本机从命令行启动的 Chrome 拿不到 ICE 候选，所以这一步必须在应用内浏览器里做。
4. 用 ffmpeg 按静音把 `assistant-remote.webm` 切成 `out/voice/ai-0N.wav`，并写 `work/ai-clips.json`（回复原文取自 `response.audio_transcript.done`）。
5. `node --experimental-transform-types film/make-timeline.mts <run>`：生成 `film/data/timeline.js` 和 `out/timeline.json`。
6. `node film/build.mjs`：打包产品界面。构建时只注入状态钩子和本地素材路径，不改应用源码；需要先 `npm run build` 生成 CSS。
7. `node film/export.cjs --hd|--4k`：逐帧导出画面并混入配音，输出 `out/transfer-aa-real-*.mp4`。

录音、状态快照和成片不入库。
