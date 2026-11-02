# 知行 · Live

一个以实时语音为入口的手机银行原型：用户说目标，后台按检查单办理，需要选择、核对或认证时出现卡片。

已接入参数化用户功能层：五个模块按“业务模块 → 用户功能 → checklist → 工具”组织。转账复用原执行器；账单、订阅、目标储蓄、理财和卡片有基础沙箱适配器及共用表单、确认和专门认证卡。目录不等于全部能力已完成，具体范围见 [当前工作流实现](docs/workflows/README.md)。

## 先体验

打开页面，点击“给张三转五百元”，选择“室友”，明确付款账户，核对并继续，在认证卡输入 **123456**。500 元在当前即时模拟策略范围内；风险信号仍会阻断。完成后可查余额，刷新保留记录。也可点击“查账单”“查订阅”“看理财产品”“查银行卡”，或展开“选择要办理的业务”。

“交互演示”无需 API Key，使用确定性中文解析与设备语音播报。它不采集麦克风，也不等同于实时语音。

“Qwen 实时语音”通过百炼 WebRTC 接入，由 Omni 理解上下文、自然追问并原生调用 `bank_request` 与 `bank_function`；ASR 用于字幕和字段依据，不逐句送旧规划器。普通对话无需工具，办理结果以后台为准。后台 Flash 仅保留旧文字入口兼容路径，尚无自由动态规划模型。真人手机麦克风、中文口音、回声和实际听感仍需实测。

## 本地运行

建议 Node.js 24 或更高版本（自动测试使用 Node 的 TypeScript transform 支持），使用 npm。

```sh
npm ci
npm run build
npm run db:local
npm run preview:local
```

打开 http://127.0.0.1:5173 。`db:local` 是首次创建本地数据表时运行的命令，已有表请勿重复执行；后续新增迁移按文件顺序应用。日常修改后重新 `npm run build`，再 `npm run preview:local`。

开发时也可以运行 `npm run dev` 使用热更新，数据库持久目录与预览一致，为 `.wrangler/state`。本地和已发布站点各自使用独立数据库。

Windows 若遇到某个插件的 npm 命令包装器错误，可以直接执行 Node.js 安装目录内的 `node_modules/npm/bin/npm-cli.js`，例如 `node "D:/Node.js/node_modules/npm/bin/npm-cli.js" run build`。普通 PowerShell 运行 npm 不需要该替代方式。

## 配置 Qwen 实时语音

1. 登录 [阿里云百炼控制台](https://bailian.console.aliyun.com/)，选择北京地域，开通模型服务。创建 API Key，复制对应业务空间的 Workspace ID；密钥、业务空间和地域必须匹配。
2. 查看实时模型与后台模型各自的试用额度和有效期，并对两者开启 **免费额度用完即停**。试用不是永久免费，只有北京部分模型/账号有试用；不要依赖应用侧控制账单。
3. 本地复制 .dev.vars.example 为 .dev.vars，填写配置。真实文件已被 Git 忽略；不要把密钥放网页、仓库或聊天里。
4. 运行 `npm run preview:local`，会自动加载项目根目录的 `.dev.vars`。修改配置后重启预览。也可以用 `-- --env-file 其他文件` 指定配置文件；在线版通过 Sites 服务端环境变量配置相同内容。
5. 页面设置中连接“Qwen 实时语音”，允许麦克风。手机使用 HTTPS 发布地址。

| 名称 | 默认值 | 用途 |
| --- | --- | --- |
| DASHSCOPE_API_KEY | 无 | 百炼服务端密钥 |
| DASHSCOPE_WORKSPACE_ID | 无 | 业务空间 ID，通常以 llm- 开头，以控制台为准 |
| DASHSCOPE_REGION | beijing | 支持 beijing / singapore；试用优先北京 |
| QWEN_REALTIME_MODEL | qwen3.8-omni-flash-realtime | 支持 WebRTC 和工具调用的实时模型 |
| QWEN_PLANNER_MODEL | qwen-plus | 后台 JSON 意图解析，关闭思考模式；评测里 qwen-plus 效果最好 |
| QWEN_INTENT | json | json：后台模型一次输出意图与参数，规则只校验；tools：旧的工具循环 |
| QWEN_VOICE | Tina | 实时音色 |

没有密钥仍可完整体验免费交互演示。配置后只有点击连接才创建语音会话，结束按钮关闭麦克风及连接。不会自动回退到 OpenAI。后台与实时语音分别消耗模型额度，先在控制台确认两者均有额度和权限。

## 检查与协作

```sh
npm run check
npm test
npm run build
```

- `app/page.tsx`、`app/globals.css`：手机页面与卡片。
- `lib/voice/live.ts`：Qwen 实时语音 WebRTC 和事件适配器。
- `lib/bank/types.ts`：共享数据结构与转账检查单。
- `lib/bank/engine.ts`：确定性业务状态机、演示语法、金额与认证规则。
- `lib/bank/server.ts`：意图模型、D1 存储与 revision 并发校验。
- `app/api/bank/route.ts`：业务入口，限制模型仅提出草稿。
- `app/api/live/session/route.ts`：服务端代理百炼 SDP 交换，密钥不下发。
- `tests/engine.test.ts`：金额、改口、认证、取消和重复提交检查。
- `docs/architecture.md`：增加第二个业务的接入约定与语音验收清单。

第二位开发者先阅读 `docs/architecture.md`。使用短功能分支，修改共享类型先同步；保持主分支可完成一次模拟转账。不要提交 `.env*`、`.dev.vars`、数据库文件、真实账号或认证信息。

## 当前边界

演示验证码固定为 123456，只用于模拟授权，不代表银行级认证。所有账户和交易都是合成数据，未连接任何真实银行。每个浏览器的演示状态由 HttpOnly cookie 隔离，刷新可恢复；清除 cookie 后新建演示账户。

旧确认随金额、收款人或付款账户修改而失效。数据库用 revision 条件更新，一次事务同时记录余额变化和回执；requestId 防止重复请求。真实语音停止播报与取消业务分别处理，已完成交易不能通过中断对话撤销。

## 设计与协议参考

- Apple iOS 27 官方 UI Kit：https://developer.apple.com/design/resources/
- Qwen 实时语音：https://help.aliyun.com/zh/model-studio/realtime
- WebRTC：https://help.aliyun.com/zh/model-studio/realtime-webrtc-access
- 工具事件：https://help.aliyun.com/zh/model-studio/client-events
- 免费额度与用完即停：https://help.aliyun.com/zh/model-studio/new-free-quota

基础构建使用 React、TypeScript、Vinext 与 Cloudflare Worker/D1，可本地运行，也可用 Sites 私人发布。

## 可解释检查单

[四场景清单与文档溯源](docs/checklists/README.md)已建立。页面“查看办理依据”展示所选流程、原话依据、每项检查与最近记录。转账必须明确付款账户；v2 本地演示允许金额上限内的合成资金即时模拟（含 500 元），不再将文档的 200 元示例作为默认硬门槛。收款人、金额、账户和最终确认可语音完成，只有演示认证需要页面输入。账单、订阅、理财流程目前返回明确的能力待接入说明。

## 原生 Omni 对话与工具（2026-10-22）

实时语音由 Omni 直接交谈和理解上下文，不再用 ASR → 硬路由 → qwen-flash 的链路控制每句话。原生 bank_request 工具受后台 checklist 约束；可先自然告知用户稍等，工具等待时不继续生成，工具结果回来后自然续答。账户查询弹卡片，裸金额500/五百可直接补入当前草稿；确认使用当前摘要 token，认证仍只在页面。等待不会自动压缩供应商已有上下文。

接入细节见 [协作与架构](docs/architecture.md)。所有资金仍为模拟，其他三个业务场景的执行器仍未接入。
