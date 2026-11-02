# 项目概览

[文档索引](DOC_INDEX.md) · [当前状态](CURRENT_STATUS.md)

项目名为“知行银行 / 财富鹅 AI 银行智能体”，参加微众银行相关金融科技创新大赛，面向大学生至初入职场的年轻用户。名称、目标及正式动画路线依据用户2026-10-21本轮确认；业务稿中的“鹅豆”保留为历史称呼，不另建产品。

## 产品目标

用户用自然语言提出需求，Agent理解意图、取得必要信息、规划多步骤任务、在规定节点等待授权、调用业务工具，再解释结果并提出后续操作。业务完整性、体验、安全边界和现场Demo表现共同决定完成质量。

财富鹅表达倾听、思考、提醒、安抚、讲解与鼓励；UI展示实际金额、图表、授权和回执。成长奖励可核实的行为质量，不能用投资收益决定角色健康、等级或惩罚。

## 采用范围

2026-10-26用户确认的[10份最终文档](business/final-20261026/README.md)为当前采用依据，包括六场景及四份配套文档。

| 场景 | 当前稿 |
|---|---|
| 理财操作 | [v1.8](business/final-20261026/wealth-v1.8.md) |
| 智能转账 | [v2.5](business/final-20261026/transfer-v2.5.md) |
| 账单分析 | [v1.7](business/final-20261026/bills-v1.7.md) |
| 订阅/代扣管理 | [v1.5](business/final-20261026/subscriptions-v1.5.md) |
| 卡片管理 | [v1.5](business/final-20261026/cards-v1.5.md) |
| 跨场景联动 | [v1.3](business/final-20261026/cross-scenario-v1.3.md) |

配套为竞品实操、安全攻防、联邦学习与多Agent辩论研究及行为设计学理论层。旧五稿和76条索引原位保留为历史，尚未逐条对齐新稿；设计范围不代表已上线功能或动画制作量。来源见[最终文档清单](business/final-20261026/source_manifest.json)，历史索引见[BUSINESS_FLOWS](BUSINESS_FLOWS.md)。

## 技术方向与边界

业务目标采用呈现、对话、护栏、工具、数据五层。第一阶段运行于Web，React + TypeScript管理界面与Agent状态，PixiJS负责2D角色播放；后续扩展移动端H5。制作采用Sprite Studio + Codex，交付透明PNG序列帧，768×768 RGBA、默认12 FPS。Godot工程仅保留历史素材，不参与生产运行。

现有网页应用位于 `code/webank-competition/voice-bank/`，财富鹅接入尚待实现，证据见[代码接入记录](CODE_INTEGRATION.md)。原型ZIP中另有Rust/Axum、PostgreSQL、React/Vite试验工程，静态登记三类工作流，不能等同于五类业务全部落地。

本文档体系记录项目设计约束；原稿引用的政策、论文、统计数据与导师观点未在本轮作外部事实核验，不能转写成新的监管结论。路演稿、业务实现与动画制作均不在本轮修改范围。
