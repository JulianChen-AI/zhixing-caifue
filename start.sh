#!/usr/bin/env bash
# 一键启动：安装依赖 → 构建 → 首次建本地数据库 → 启动 http://127.0.0.1:5173
set -euo pipefail
cd "$(dirname "$0")/voice-bank"

node -e 'const [a,b]=process.versions.node.split(".").map(Number); if (a<22||(a===22&&b<13)) { console.error("需要 Node.js >= 22.13，当前 "+process.version); process.exit(1) }'

[ -d node_modules ] || npm ci
npm run build
[ -d .wrangler/state ] || npm run db:local

if [ -f .dev.vars ]; then echo "已加载 voice-bank/.dev.vars：可使用 Qwen 实时语音"; else echo "未找到 voice-bank/.dev.vars：仅交互演示（无模型）"; fi
echo "打开 http://127.0.0.1:5173 （演示舞台：/demo）"
exec npm run preview:local
