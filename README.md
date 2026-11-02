# 知行 · 财富鹅 — AI 银行智能体

微众银行竞赛国内赛道“AI 代人操作银行（安全 + 体验）”参赛作品。

面向大学生和初入职场的用户：**说一句话**，智能体理解金融意图、拆解多步任务、调用银行业务工具、在关键节点请用户确认与认证，再解释结果和后续操作。财富鹅角色根据真实业务状态给出陪伴反馈。

> 所有账户、资金、联系人、产品与认证均为合成沙箱数据，未接入真实银行、支付通道或身份系统。

![系统架构图](docs/technical/system-architecture.png)

## 核心设计：模型负责听懂，代码负责放行

| 原则 | 怎么落实 |
|---|---|
| 模型只能提议，不能放行 | 工具参数先过 Zod 白名单，再过字段依据核验、检查单与令牌链；模型无法设置“已通过” |
| 认证与模型隔离 | 验证码只能在页面卡片输入，模型工具里没有认证操作 |
| 改了就要重新确认 | 对象或金额任一字段变化，旧确认与认证全部作废 |
| 状态是唯一事实来源 | 卡片、语音回复、财富鹅动画读同一份后台状态，动画不能反向触发业务 |
| 可并发、可重放 | `revision` 乐观锁原子提交，`requestId` 去重，重复请求返回原结果 |

## 六大场景覆盖

| 赛题场景 | 已实现（沙箱） | 代码入口 |
|---|---|---|
| 智能转账 | 选收款人、改金额、备注、核对确认、页面认证、回执查询、周期转账规则、AA 均分 | `voice-bank/lib/bank/`、`lib/workflows/` |
| 账单分析 | 明细、净支出与退款统计、分类纠正、异常线索、预算、月度报告 | `lib/workflows/`、`lib/plans/` |
| 理财操作 | 目标储蓄、演示风险测评、产品比较、申购赎回受理、撤单、持仓、定投规则 | `lib/workflows/` |
| 卡片管理 | 卡片详情、限额与授信、临时冻结 / 解冻、挂失补卡 | `lib/workflows/` |
| 订阅 / 代扣管理 | 订阅清单、提醒规则、模拟解约与恢复、扣款日历 | `lib/workflows/` |
| 跨场景联动 | 一句话拆成最多 6 项业务、12 个步骤，建立依赖链，逐项确认后推进 | `lib/plans/` |

功能目录共 54 项，逐项范围与“明确未接入、不造结果”的能力见 [工作流实现范围](voice-bank/docs/workflows/README.md)。

## 快速运行（无需 API Key）

需要 Node.js 22.13 或更新版本（建议 24）。一条命令启动（也可以把本目录交给 AI Agent，按 [AGENTS.md](AGENTS.md) 执行）：

```sh
./start.sh
```

等价于在 `voice-bank/` 依次执行 `npm ci`、`npm run build`、首次 `npm run db:local`、`npm run preview:local`。

打开 http://127.0.0.1:5173 。没有密钥时使用确定性中文解析的交互演示：点“给张三转五百元”，选“室友”，核对后在认证卡输入演示码 **123456**。

`/demo` 是 5 分钟固定脚本演示舞台（与演示视频同一套沙箱流程）。

接入真实 Qwen 实时语音：复制 `voice-bank/.dev.vars.example` 为 `.dev.vars`，填写阿里云百炼 API Key 与业务空间 ID，详见 [应用说明](voice-bank/README.md)。密钥只保存在本地，`.gitignore` 已排除。

## 测试

```sh
cd voice-bank
npm run check           # TypeScript 类型检查
npm test                # 单元测试：状态机、护栏、语音协议、六场景路演流程等
npm run eval:tasks      # 任务完成率评测集（98 条，覆盖六场景与安全约束，默认不联网）
```

评测集口径（一次办完率、误执行、错误草稿、中断）见 [评测说明](voice-bank/evals/task-completion/README.md)。

## 目录

| 位置 | 内容 |
|---|---|
| `voice-bank/app/` | 页面与服务端接口（`/api/bank` 为唯一业务写入口） |
| `voice-bank/lib/voice/` | Qwen 实时语音连接、会话协议、后台监督 |
| `voice-bank/lib/plans/`、`lib/workflows/` | 外层任务编排与内层检查单引擎 |
| `voice-bank/lib/bank/` | 意图解析、转账状态机、共享类型 |
| `voice-bank/components/` | 业务卡片、任务清单、财富鹅播放器 |
| `voice-bank/tests/`、`voice-bank/evals/` | 单元测试与任务完成率评测 |
| `deploy/` | VPS 部署脚本与说明 |
| `docs/technical/` | 竞赛技术文档与安全自评（Markdown 原稿） |
| `docs/business/` | 六场景业务设计稿 |

## 与提交材料对照

| 提交材料 | 对应文档 |
|---|---|
| 技术文档 | [系统架构](docs/technical/01-system-architecture.md)、[核心算法](docs/technical/02-core-algorithms.md)、[安全设计](docs/technical/03-security-design.md) |
| 安全自评报告 | [安全自评](docs/technical/04-security-self-assessment.md) |
| 部署说明 | [deploy/README.md](deploy/README.md) |
