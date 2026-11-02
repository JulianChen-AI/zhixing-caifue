# 知行 Live：协作约定

## 2026-10-22 双层任务清单

简单请求直接进入原业务清单。复杂请求通过 `bank_plan` 和 `lib/plans` 建立外层顺序、依赖、澄清及计算节点，每个业务节点再运行现有内层检查单。两层状态保存到同一会话；已完成步骤保留，失败、待外部结果及暂停会停止后续步骤。详情、边界和验证见 [双层任务清单](workflows/two-layer-checklists-2026-10-22.md)。

## 2026-10-22 参数化用户功能层

当前新增 `lib/workflows` 与 `components/workflow-panel.tsx`，承接“业务模块 → 用户功能 → checklist 编排 → 工具调用”。Omni 增加 `bank_function`，页面和原生工具共用执行层与 D1 会话 revision。目录列出 54 项功能和 85 组逻辑工具，未接入及部分 action 明确阻断，不据数量认定全部完成。具体执行范围、可选参数、认证边界及测试入口见 [当前工作流实现](workflows/README.md)。

下文“首个业务”“旧规划器”“四场景检查单”描述保留的兼容层；新模块由 `workflows/engine.ts` 推进，转账仍复用原 `bank/engine.ts`。多步骤任务由上面的受控拆解器编排。

## 2026-10-28：先办理、复核后播报

本次操作回执与页面焦点分离：`operationResult`携带目录、定义或目标任务的真实返回，`workflow`仍表示当前Checklist。目录/定义查询不改变业务焦点。错误业务使用`business_mismatch`，允许重新选择功能；参数格式错误才保留原功能修正。

实时回复先缓存原生WebRTC语音和转写，`/api/bank/review`使用Flash核对用户原话、后台事实及待播报回复，通过后才显示正式字幕并播放对应录音。漏调用、明确答案未保存、查询与新问卷混淆等不能靠两个模型同意放行；明确字段通过原有解析、schema、依据及revision校验。最多一次有依据的草稿/只读修正，不能由复核器确认、认证或执行资金操作。需要修正但未给动作时，先用现有解析器提取明确字段，再由受约束的修正器提出动作；措辞修正不重放业务。

缓存全部回复会增加首段语音等待，页面显示等待提示和独立后台进度；用户打断会丢弃缓存与迟到复核。尚未执行任何工具的停滞，可在读取状态后重连继续原输入一次；已发起或执行的请求只核对状态，通过`tools:[]`的独立会话报告进度，不重放确认或写操作。只读播报失败不递归重试，新用户输入可回到正常会话。

验证记录见[复核播报与恢复](workflows/verified-reply-recovery-2026-10-28.md)。合成数据、文字输出控制、原生音频输出和人声麦克风分别标记，自动化通过不代表真实银行接入或人声验收。

后续增加有界上下文轮换：60,000输入Token、24轮或15分钟后，在下一轮安全边界重开；Flash只摘要讨论背景，Task ID、原字段、答案和结果从后台恢复，历史确认不能重放。新摘要端点只读，失败时退回确定性快照。工具回执去除外层重复结果，发送失败及协商消息尺寸单独诊断；它们不能当作模型上下文溢出。详见[停滞定位与重开实验](workflows/continuation-stall-investigation-2026-10-28.md)。

纯解释与本轮已完成查询分别用精简事实复核，需纠正时转入独立tools=[]会话，直接以用户原问题为输入。后台其他草稿Checklist不构成本轮完成条件，查询结果不能退化成办理进度；查询凭本轮后台执行日志核实，关键余额与结果条目另做检查。Realtime以response.done完整快照补齐缺失增量，已结束事件去重；空/失败回复即时分流，单Response有120秒绝对上限。验证见[解释隔离与最终快照](workflows/reply-isolation-and-final-snapshot-2026-10-29.md)。

## 当前范围

手机网页，实时语音为主，需要选择、修改、确认、认证时出现业务卡片。首个业务为模拟转账，附带查询余额、取消、回执、重置。所有金额、联系人、账户与认证都是合成演示。

## 数据流

1. WebRTC 连接 Qwen3.8 Omni Realtime；Omni 直接理解连续语音、自然交谈和上下文。ASR 只更新字幕并核对工具字段来源，不再逐句触发旧 planner。
2. Omni 原生调用bank_plan、bank_function或兼容bank_request。实时模式下的键盘输入进入同一Omni会话；普通解释不需要业务工具，但正式回复仍先复核。
3. /api/bank 校验工具名称、参数白名单、字段依据和当前 revision，再进入现有 checklist 与 reducer。合法 ID 不能替代用户依据；重名、金额冲突、缺少账户会作为缺项返回，让 Omni 自然追问。
4. “500”“500。”“五百”在工具金额字段中都可核对为500元，不再要求用户补单位或重复确认金额。
5. 完整摘要带 reviewToken；confirm_transfer 必须引用当前 token 和明确确认。任何草稿修改都换 token、撤销旧确认和认证。没有认证工具；最后仍只能通过页面演示认证。
6. 真实状态和紧凑工具结果回传 function_call_output；等待当前 response.done 后再 response.create 续答。D1 原子提交和 requestId 幂等机制保持。

调用前可自然说“稍等，我确认一下”，不要求固定话术。工具等待时不循环生成、不轮询模型；此处 waiting 相当于应用层 sleep，不是假造供应商 sleep API，也不代表已有上下文被清空或供应商费用归零。结果只包含当前事实、必要字段和检查状态，不把完整审计记录、原始转录、认证标识回灌给模型。复杂后台模型/适配器以后接在工具执行内部，不参与日常语音理解。

用户插话会静音并取消旧播报、终止工具等待，丢弃旧调用与迟到结果，不向供应商已撤销的 call_id 回传结果。已提交状态不会假称回滚；后续通过 revision 冲突刷新事实。仅发出 response.create 不等于响应已启动，必须收到 response.created 才允许取消。

## 转账状态

`recipient → details / review → authenticate → complete`

任何未完成状态可取消。`review` 前由模型/用户补充信息；`confirm` 可由明确页面操作或受控语音工具触发；`authenticate` 只通过页面演示认证卡。验证码仅用于本演示，不发送给语音或后台规划模型。交易完成后取消对话不会撤销回执。

## 新增业务

第二位开发者可以仿照转账模块接入查询或订阅业务：

- 在 `lib/bank/types.ts` 定义状态、卡片数据与允许的 action。
- 在独立业务 reducer 中编写状态变化，接入 `engine.ts`。
- 在工具参数白名单与独立适配器添加受限操作，返回紧凑事实和缺项；禁止模型输出任意数据库操作。
- 在页面接入该业务卡片，继续共用语音、确认、字幕、错误提示和 revision 机制。
- 涉及共享类型和接口的变更先同步；使用短分支与 PR，保持主分支可运行。

## 当前验证边界

真实 Qwen 实时语音 需要项目密钥及模型权限。未配置时界面明确显示待配置，`/api/live/session` 返回 503。交互演示使用确定性中文解析与浏览器设备播报，不是 Qwen 实时语音，不提供麦克风连续对话；不能据此宣称已验证自然插话效果。

实际语音验收需用演示手机测试：用户插话能否及时停止播报；字幕是否完整；多个改口是否正确；背景声与回声是否误触发；改口后的旧规划是否不再显示；断网、结束会话和重连是否释放麦克风并保留业务状态。

## Qwen 协议与配置

WebRTC先协商音频sendrecv并注册服务端txt DataChannel；收到session.created且事件通道open后发送session.update，不再额外等待整体PeerConnection的connected回调。收到session.updated才挂载麦克风。语音通过RTP，不发送PCM append事件。输入转录text+stash每次替换预览，不拼接重复前缀。

VAD 自动响应现在保留自然交谈能力。原生 response.function_call_arguments.done 才发起后台工作，并用 call_id 去重；普通 ASR 完成不会自动办理。卡片操作以 session.update 替换最新后台事实；首次连接等待用户开口。停止、超时或失败释放所有媒体资源。

服务端默认北京地域；密钥与业务空间不发送给浏览器。Omni负责语音理解和工具提议，Flash负责正式播报前复核及受约束修正，不将普通ASR逐句送入旧规划器。旧`/api/bank command`和离线文字演示仍是兼容入口。

官方参考（2026-10-22 核对）：

- https://help.aliyun.com/zh/model-studio/realtime
- https://help.aliyun.com/zh/model-studio/realtime-webrtc-access
- https://help.aliyun.com/zh/model-studio/client-events
- https://help.aliyun.com/zh/model-studio/server-events
- https://help.aliyun.com/zh/model-studio/qwen-structured-output
- https://help.aliyun.com/zh/model-studio/new-free-quota

模型名与音色均可配置。2026-10-22 已完成真实百炼接口和浏览器 WebRTC 合成语音测试；转录、后台卡片与插话改口均有运行记录。真人中文语音、VAD 阈值、手机自动播放、回声、听感及跨网质量仍需手机验收。合成音轨测试不证明真人的实际打断延迟。

## 四场景检查单建设（2026-10-22）

详见 [检查单目录与接入约定](checklists/README.md)。当前路由先验证预设业务与字段来源，再进入同源规则执行器；前端展示实际校验结果。其他场景尚无执行适配器时返回明确阻断。v2 本地演示覆盖策略允许金额上限内即时模拟，不沿用文档的 200 元示例硬门槛。原生 Omni 工具接受没有单位的明确金额，账户名/尾号/可见序号由字段核对定位，明确语音确认与按钮共用执行器，演示认证仍仅在页面完成。
