# 给 AI Agent 的运行说明

目标：在本机把“知行 · 财富鹅”跑起来，浏览器打开 http://127.0.0.1:5173 。

1. 需要 Node.js >= 22.13（建议 24）和 npm。没有就先安装。
2. 在本目录运行 `./start.sh`（Windows 用 Git Bash 或 WSL）。它会依次执行 `npm ci`、`npm run build`、首次 `npm run db:local`，然后启动本地服务。这是前台常驻进程，看到 `Ready on http://127.0.0.1:5173` 即成功。
3. Qwen 配置已放在 `voice-bank/.dev.vars`，启动时自动加载，不需要再填。启动前确认其中 `QWEN_PLANNER_MODEL=qwen-plus`（若是 `qwen-flash` 改成 `qwen-plus`），意图理解按 qwen-plus 调优。若该文件不存在，页面仍可用无模型的交互演示。
4. 页面上点“给张三转五百元”→ 选“室友”→ 核对 → 认证卡输入演示码 `123456`，即可走完一笔沙箱转账。`/demo` 是 5 分钟固定脚本演示。实时语音需允许浏览器麦克风。

验证代码：在 `voice-bank/` 运行 `npm run check`、`npm test`；`npm run eval:tasks` 跑无模型任务完成率评测。

注意：所有数据为合成沙箱数据。不要把 `voice-bank/.dev.vars` 提交到任何公开位置。端口 5173 被占用时先停掉占用进程。
