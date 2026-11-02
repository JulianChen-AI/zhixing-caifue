# GPT-Live 委托机制调研（2026-11-01）

调研对象：OpenAI GPT-Live 如何通过“委托（delegation）”把前台语音对话与后台推理、工具执行分开。

依据是 OpenAI 官方开发者文档，以及微软 Foundry 的事件参考文档（两者对同一套事件的描述一致）。只读了文档，没有调用 GPT-Live 接口；它目前是限量 alpha，需要申请资格。

## 1. 分工：谁负责什么

| 角色 | 负责 | 不负责 |
|---|---|---|
| GPT-Live（前台语音模型） | 听、说、处理插话；判断何时委托；把后台结果改写成口语说出来 | 业务步骤、工具定义、价格或预约等结论 |
| 后台（Responses 模型或你自己的服务） | 完整的任务流程、业务规则、工具调用 | 直接控制说话 |
| 你的应用 | 权限、确认、执行私有函数、可持久保存的任务状态、业务记录、是否放行播放 | — |

文档反复强调：两种委托模式下，权限、确认和任务状态都由应用负责，模型不负责。

## 2. 委托如何被触发

- 前台模型的提示词里有一节 `Delegation policy`，分三部分：`Backend tools`（后台能做什么）、`Generate <|SpawnThinking|> when`（什么情况要委托）、`Do not generate <|SpawnThinking|> when`（什么情况不委托）。
- 前台模型输出特殊标记 `<|SpawnThinking|>`，服务端据此创建委托，并发出 `session.delegation.created` 事件。
- 文档明确说：模型口头说“我查一下”，并不代表后台已经开始工作，只有委托事件才算。依赖后台结果的回答，前台必须等结果回来才能说，不能先猜。
- 闲聊、复述已经给过的结果、或需要先向用户澄清的情况，不委托。

## 3. 两种委托模式

会话创建时就要选定，之后不能更改（改动会报 `immutable_field_update`）；省略则默认为 client 模式。

### Responses 模式（托管）

- 在 `delegation.responses` 中配置后台模型、指令、工具、`reasoning`、`service_tier` 等；会话中途可以整体替换。
- 委托事件带 `target:"responses"` 和 `response_id`，之后的后台事件包在 `response.event` 信封里转发，信封外层带 `delegation_id`。
- 自定义函数的完整调用，从内层的 `response.output_item.done` 事件读取（只有 arguments-done 事件还不够）。应用完成授权检查并执行后，用 `response.item.create` 回传 `function_call_output`；所有待回传的调用都回齐后，再发 `response.create` 让后台继续。缺少结果会报 `function_call_outputs_required`。
- 后台的文字输出会自动注入前台语音会话，由前台说出来。
- 适用场景：托管流程能满足需求，后台结果可以直接交给前台说。

### Client 模式（自己运行后台）

- 委托事件只带 `id`、`target:"client"`、`offset_ms`，**不包含任务文本**。应用要根据转写和自己的状态还原用户想做什么。
- 因此应用要自己积累 `input_transcript.delta` 和 `output_transcript.delta`，记住上下文，才能理解“好的”“是周四不是周五”这类短回复和改口。
- 结果通过三种追加事件交回，每条最多 500 token，都必须带 `delegation_id`；填 `null` 表示面向整个会话：

| 事件 | 用途 |
|---|---|
| `session.commentary.append` | 让前台说出来（会改写成口语） |
| `session.thinking.append` | 静默提供事实或进度，不立即说，用户之后问到时可以用 |
| `session.instructions.append` | 可信的应用指令，能打断前台正在说的话，用于纠偏、披露或叫停 |

- 同一个委托可以多次追加，用于分段返回进度和结果。
- 前台默认会自动说一句应答。设置 `delegation.acknowledgement_delay_ms`，并在收到委托事件后立即发一条空的 `thinking.append`，就能取消这句应答；但这会取消整个会话里所有待发的应答。
- 适用场景：结果需要先校验、脱敏、合并或丢弃才能交给前台；或者需要多个后台、自定义路由、检查点、预算控制。

## 4. 并行与时序

- 前台说话和后台工作各自独立进行。后台完成，不代表用户已经听到；追加事件的确认回执只表示上下文已送达，不代表模型已经用上或已经说出口。
- 插话只会停止说话，**不会取消后台工作**。要把“别说了”和“取消我的预约”分开：后者是新任务，交给后台处理，确认真正取消后才能对用户说“已取消”。
- 用户改了需求时，应用要更新当前任务，并丢弃旧需求迟到的结果。文档建议每个应用动作配一个 operation ID，每次需求变更配一个 task revision，与 `delegation_id` 一起记录。
- 重试前先查原操作是否已经执行，避免重复下单。结果不明时如实告诉用户。
- 互不依赖的查询可以并行；有依赖和需要确认的动作仍然按顺序执行。

## 5. 延迟与安全的取舍

- **默认做法：边说边检查。** 应用持续检查双方的转写，可以用轻量模型并行判断。触发规则时，先在应用状态里拦住相关动作，丢弃迟到的结果，再用 `instructions.append` 纠偏。已经播出的声音收不回来。
- **必要时先审后播。** 应用自己缓冲音频，用自己的输出 VAD 切段，审核通过后再放；没通过、缺转写或超时就丢弃，改用预设的安全兜底。文档承认这样会增加延迟，而且被丢弃的话仍然留在模型上下文里。
- **提前开工。** 根据还没说完的转写提前开始查询（推测性查询）；结果过时就丢弃，并和之后的正式委托去重。
- **降低后台延迟。** 复用连接、预先准备配置、保持提示词前缀稳定以利用缓存；结果要短，不需要再调一次模型把它改写成口语；分段送回已核实的结果。
- **验收两头都要查。** 业务记录对不对、用户实际听到的话对不对，要分开验证。

## 6. 对本项目的启示

对照 `lib/voice/qwen-protocol.ts` 的现状：

1. **已经一致的地方。** 业务规则、确认和认证本来就放在确定性后台；页面状态同步不算用户授权；“请稍等”这类等待提示不能包含结果（`waitNotice`）。这些和 GPT-Live 的职责划分一致。
2. **最接近的模式是 client 委托。** 银行结果必须先校验才能交给前台说，正好符合文档推荐 client 模式的条件。我们可以在 Qwen 上模拟：让模型只调一个粗粒度的“委托”工具，后台还原意图并办理，再把已核实的简短结果交回去说（对应方案阶段1）。
3. **区分“停止说话”和“取消任务”。** 现在的 `interrupt()` 在用户插话时会中止正在执行的工具请求。GPT-Live 的做法是插话只停说话，后台继续，完成后的结果写进卡片，不再播报。写操作被中途中止后结果未知，需要恢复流程额外核实；改为不中止、只是不播报，更安全。这一点需要评审后再决定，现在不改。
4. **需求版本与迟到结果。** 现有的 epoch 机制相当于粗粒度的 task revision。可以借鉴给每个动作配 operation ID 加 revision，用来精确丢弃旧结果和避免重复执行。
5. **先审后播的代价。** 我们的 `VerifiedAudio` 采用的就是文档中“必要时先审后播”的做法，文档也承认它会增加延迟。文档默认推荐的是“边说边检查 + 拦截动作 + 纠偏”。银行场景里涉及结果和金额的话仍然先审后播；追问和解释类可以改为边说边检查（对应方案阶段2）。
6. **不能照搬的部分。** Qwen 没有 `<|SpawnThinking|>`、commentary/thinking 分流，也没有自动应答控制。我们只能用工具调用加 `session.update` 和指令来近似，效果要靠实测确认。

## 来源

- [OpenAI: Delegation and tools in GPT-Live](https://developers.openai.com/api/docs/guides/live-delegation)
- [OpenAI: Prompting GPT-Live](https://developers.openai.com/api/docs/guides/live-prompting)
- [OpenAI: Managing GPT-Live sessions](https://developers.openai.com/api/docs/guides/live-conversations)
- [OpenAI: Server-side controls](https://developers.openai.com/api/docs/guides/voice-server-controls?api=live)
- [Microsoft Foundry: GPT-Live event API reference](https://learn.microsoft.com/en-us/azure/foundry/openai/gpt-live-reference)
- [Microsoft Foundry: Delegate work in GPT-Live](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/gpt-live-delegation)
