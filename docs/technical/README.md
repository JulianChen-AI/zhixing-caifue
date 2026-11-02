# 技术文档

竞赛提交材料“技术文档：系统架构图、核心算法说明、安全设计文档”。内容依据 `voice-bank` 代码（`main` 提交 `52f2da9`）整理，只记录代码中实际存在的实现，并单列尚未具备的能力。

| 文档 | 内容 |
|---|---|
| [系统架构说明](01-system-architecture.md) | 四层架构、组件与接口、语音转账时序、数据模型、部署与技术栈 |
| [系统架构图](system-architecture.svg)（[PNG](system-architecture.png)） | 单页架构图，含 8 条主要数据流与关键不变量 |
| [核心算法说明](02-core-algorithms.md) | 双层任务编排与比例计算、字段依据核验、检查单求值、令牌链、并发幂等、流式播报的后台监督与核对、状态驱动动画、上下文轮换 |
| [安全设计文档](03-security-design.md) | 安全目标、威胁模型、身份与请求完整性、业务护栏、数据最小化、资源上限、已知局限 |
| [安全自评报告](04-security-self-assessment.md) | 竞赛材料第 5 项：权限分级实现说明（调用方分级、业务五级、放行链、测试覆盖）与已知风险清单（19 项，按高 / 中 / 低分级）；适用提交 `299f495` |

验证记录：2026-10-31 在 `main` 执行 `npm test` 361 项通过，`npm run check` 通过；浏览器端到端测试本轮未运行。

架构图修改后，用 Inkscape 重新导出 PNG：

```bash
inkscape system-architecture.svg --export-type=png --export-filename=system-architecture.png --export-width=2560
```
