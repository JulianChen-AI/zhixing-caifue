## 审查范围与口径

只读审查本地 `2e9fe0f`，对照：

- `LOCAL_PROJECT/docs/business/final-20261026/wealth-v1.8.md`
- `LOCAL_PROJECT/docs/business/final-20261026/bills-v1.7.md`

未修改文件，未调用模型或外部服务。下面“已有沙箱闭环”仅指代码及相应单测具备，不等于本轮浏览器/真人语音验收通过。

代码路径简称均以此绝对目录为根：

`APP = LOCAL_PROJECT/code/webank-competition/voice-bank`

### 最重要的判断

**基础业务不只是占位，目标存取、申购/赎回受理与模拟结算、撤单、流水统计已有真正的沙箱状态变化；但财富鹅成长陪伴、投教剧情、自动调度、完整账单智能分析是主要缺口。**

另有四个已通过纯内存探针证实的细节缺陷：

1. 改目标金额没有重算关联自动储蓄月供。
2. 未完成认知课程也能申购债券基金。
3. 多年前的 `pending` 订单仍可撤单，没有“仅当日”窗口校验。
4. `cashOrNet` 参数不起作用，现金/净额两种查询完全相同。

---

## 一、理财 v1.8：TF-01～TF-22逐项

| ID | 文档要求 | 实际能力与判断 | 没做/没完善 |
|---|---|---|---|
| TF-01 | 建目标、程序拆月供、单独授权自动转存、成长反馈 | **部分实现**。IN01可计算月供并创建目标；未选自动转存不建规则；明确开启才存规则。 | 规则不会自动扣款/到账触发；没有企鹅成长事件、进度播报与兑现仪式。 |
| TF-02 | 目标罐存入 | **已有基础沙箱闭环**。IN02扣来源账户、加目标余额、写统一流水，守恒检查有单测。 | 还缺与财富鹅反馈/成长的联动；真实银行子账户不是本轮沙箱必做。 |
| TF-03 | 目标罐柔性取用 | **部分实现**。IN02可取用、余额不足阻断、金额守恒。 | 未计算“取出后目标延期多久”，没有对应柔性提醒。 |
| TF-04 | 查询储蓄进度 | **已有基础沙箱查询**。IN03返回目标、已存、差额与比例。 | `includeProjection`明确未接入；无周度反馈、预测达成日。 |
| TF-05 | 三个5～8轮投教剧本、确定性分支、进度与XP | **未见实现**。IN15仅返回固定的一段风险知识。 | 三个剧本、JSON DSL执行器、选择分支、学习进度、XP+20与测评隔离的完整机制均未实现。 |
| TF-06 | 对话式标准风险问卷、财务状况等维度、评分入档 | **部分实现**。IN05有三题演示问卷、程序评分、有效期及记录。 | 不是文档定义的标准问卷；缺财务状况维度、逐题续答/完整对话测评体验。已有明确“非机构正式测评”标注，应保留。 |
| TF-07 | 客观产品信息陈列、适当性边界 | **部分实现**。IN06可读取两款合成产品，含风险、零演示费率、类型、流动性。 | 产品信息维度较少；没有完整产品说明书解释、管理/托管等分项费用、历史表现/最大回撤及对应人话解释。 |
| TF-08 | 同口径产品要素对比，不代替用户决策 | **部分实现**。IN07能返回用户指定的两项以上产品。 | 主要是把原始产品记录并列返回，缺比较维度、差异计算/缺项解释和“三罐”等专门呈现。 |
| TF-09 | 成年、有效测评、认知课程、适当性、冲动提醒、费用风险披露、确认 | **部分实现，存在硬护栏缺口**。已有有效期/产品风险/余额检查、摘要确认、页面认证、申购受理。 | **没有年龄字段/检查，没有认知课程完成门槛，没有冲动提醒链**；风险费用披露与留痕较简化。纯内存探针证实 `education=[]` 时仍可申购债基。 |
| TF-10 | 赎回、部分赎回、费用/到账说明、急用与恐慌分流 | **部分实现**。IN09接受金额赎回；受理后不立即增加账户余额；需手动推进模拟结算。 | 不支持按份额/比例赎回；缺具体费率/预计到账时点；没有“急用/恐慌”区别及陪伴复盘。模拟结算本身是合理的Demo边界，不应误算为真实银行未接入的缺陷。 |
| TF-11 | 硬信号触发的冲动提醒、冷静档案、三选一、坚持执行留痕 | **未见实现**。 | 缺金额/深夜等触发、档案授权和保留期限、24h提醒/小额试投/坚持执行三条分支，以及冷静勋章。不能把普通确认卡当作本流程。 |
| TF-12 | 企鹅状态、成长阶段/XP等 | **未见生产路径实现**。 | 没有企鹅状态模型、健康分/阶段、性格、装扮、心情天气、动作事件和PixiJS接入。 |
| TF-13 | 企鹅周记/行为质量复盘 | **未见实现**。 | 无可核实行为日志到周记的生成链、数据授权/事实约束、周记界面。 |
| TF-14 | 全账户持仓总览、总市值/累计收益/占比、企鹅联动 | **部分实现**。IN10返回持仓市值、成本、收益和合成数据标记。 | 缺总览聚合/产品占比及专门可视化，缺心情天气同步。 |
| TF-15 | 净值更新/异动订阅播报、每日≤1条、画像偏离事实提示 | **部分实现**。IN14可保存用户自设提醒。 | 无行情/净值更新触发、阈值监控、到期交付、日频上限、组合偏离判断和陪伴播报。**保存提醒≠已经盯盘。** |
| TF-16 | 仅当日未确认份额订单可撤、恢复资金并留痕 | **部分实现，有窗口缺陷**。IN12撤销pending并恢复余额/持仓；不可重复撤。 | 只检查 `status==='pending'`，未检查交易日/撤单截止窗口。探针把订单日期设为2020年仍撤单成功。 |
| TF-17 | 成交/扣款/撤单查询、对账汇总 | **已有基础沙箱查询**。IN11可按期间/订单查状态。 | 仅订单列表；未实现回执文件导出、完整对账/日报式汇总。`receiptExport`会返回未接入说明。 |
| TF-18 | 定投金额/周期修改、暂停指定时长、终止、后果重算 | **部分实现**。IN13可创建/改/停/恢复/删规则。 | 无到期执行器；无 `pauseUntil` 字段及定期恢复；无“停两个月后目标晚多久”的影响重算。 |
| TF-19 | 改目标/延期后重算月供，暂停自动锁定即时生效 | **部分实现，有联动重算缺陷**。IN04能改目标/期限并暂停或恢复关联规则。 | 改目标/期限只改goal记录，没有重新计算现有规则金额。探针3000→6000后月供仍375元。 |
| TF-20 | 到期前7天提醒、画像漂移重测、轮换题序、历史保留、过期限制新业务 | **部分实现**。已有画像有效期检查、重新答三题更新画像、问卷记录追加。 | 无到期提醒/画像漂移触发/题序变化；未形成完整重测对话。不能因过期申购会阻断就把本流程算完成。 |
| TF-21 | 自设提醒查看、到期通知、72h失效、可提前执行 | **部分实现**。IN14可增改删查提醒，不锁单。 | 只存提醒数据，无到期交付、72h自动失效；与TF-11还未联通。 |
| TF-22 | 产品详情的人话三板斧、完整费率/最坏情形、历史业绩提示 | **部分实现**。IN06支持单品读取。 | 实际还是合成产品字段，未完成所需的完整解释结构、费用拆分/最大回撤与固定末句机制。 |

### 理财证据索引

- `APP/lib/workflows/adapters.ts:67-86`：基础资格、金额、画像检查；没有年龄/课程条件；IN12仅pending检查。
- `APP/lib/workflows/adapters.ts:145-152`：目标进度、产品、对比、持仓、订单、提醒查询；IN15固定知识文本。
- `APP/lib/workflows/adapters.ts:168-174`：目标创建/存取/修改、三题测评、申购/赎回/撤单的真实沙箱状态变更。
- `APP/lib/workflows/adapters.ts:185,205-213`：定投规则与提醒只保存，明确未接自动扣款调度/外部推送。
- `APP/lib/workflows/adapters.ts:220-233`：订单手动模拟结算。
- `APP/lib/workflows/engine.ts:76-79,126-146`：预览、摘要确认、页面演示认证。
- `APP/lib/workflows/engine.ts:182,188`：进度预测和回执导出明确未接入。
- `APP/lib/workflows/fields.ts:15-17,55-58`：IN系列实际可接收字段，无课程/年龄、份额赎回、暂停截止日。
- `APP/lib/workflows/seed.ts:19-24,30`：两款合成产品、单一初始持仓；`education`初始化为空。
- `APP/components/workflow-panel.tsx:16-23,42-44,57,61`：通用字段/结果呈现、三题问卷、手动结算按钮，不是成长伙伴专门UI。
- `APP/tests/workflows.test.ts:204-215,235-239`：目标守恒、测评后恢复申购、撤单与结算已有对应单测。

---

## 二、账单 v1.7：BA-B01～BA-B13逐项

| ID | 文档要求 | 实际能力与判断 | 没做/没完善 |
|---|---|---|---|
| BA-B01 | 自然语言查账、细分类目、期间继承、比较、后续选项 | **部分实现**。BI01/02能筛期间/账户/商户/类目，做确定性统计。 | 缺细分类目字典；演示离线解析只有简单月度/餐饮支持；“那咖啡呢”继承条件等完整对话未验收；没有文档要求的比较+换算+后续行动整套查账链。 |
| BA-B02 | 商户硬映射→LLM分类→置信度分级→统一类目字典、转账备注映射 | **未见动态分类引擎实现**。当前流水类目主要由种子或写流水时直接指定。 | 无商户映射查询/LLM分类调用、置信度/待确认/未分类机制、两层备注映射与统一字典。不能把seed里有category当作分类引擎完成。 |
| BA-B03 | 默认只改本笔、用户可选商户未来规则/历史重分类、纠错留痕 | **部分实现**。BI03能修改当前交易；future会存categories记录。 | 代码未读取categories应用到后续交易；未实现历史批量，且preflight明确不支持；无完整学习/纠错审计与训练opt-out机制。 |
| BA-B04 | AA垫付/收回现金与净额双口径、人情往来联动、退款冲正 | **部分实现，双口径未生效**。已有退款冲减支出、自有账户转移不计消费；有独立往来记录入口。 | AA应收/实收与统一流水未联通；没有净额视图、7天未收齐提醒。`cashOrNet`参数虽可传，统计根本未使用；两种查询探针结果完全一样。 |
| BA-B05 / B05b | 高危硬规则、60天冷启动分层、节律白名单、P99、异常复核/退款超时/重复扣费 | **部分实现，核心识别未做**。BI04能读关联流水和种子中的疑似重复标记，保持unknown不定性。 | 没有运行中的检测器/个人基线/时分秒级规则/冷启动/白名单/双级状态机/主动提醒；“不是我→挂失/申诉”等处置链和材料导出未完成。 |
| BA-B06 | 周期金额容差±20%、商户特征库、首扣候选、T-5提醒、僵尸对话确认 | **部分实现，发现侧主要未做**。BI05返回已有subscriptions并提醒“是否闲置需用户确认”。 | 不是从流水检测周期候选；缺金额容差/商户归一化/新候选入库/活跃度确认状态，缺T-5调度及信用守护文件入口。 |
| BA-B07 | 每月自动报告、分类/环比/预算、k≥50分位、节律解释、1～3洞察、一句话行动、归档 | **部分实现，现有仅基础统计**。BI06返回期内总额统计，BI02可给比较期统计。 | 无月初自动生成、报告归档、分类结构报表/环比解释、匿名分位/人数护栏、节律识别、“离谱洞察”与动作卡。peerComparison明确未接入。 |
| BA-B08 | 年报关键词、消费人格、年度之最、300字叙事、脱敏分享、敏感类目排除 | **部分实现**。用BI06按年度可统计已有流水。 | 无12份月报归档聚合/人格/年度之最/完整叙事/海报；分享能力明确未接入，不能把开关存在算脱敏分享完成。 |
| BA-B09 | 主动CSV/PDF导入、逐来源授权、标准化、四要素去重、疑似重复确认、原件清理 | **未实现，明确UNSUPPORTED**。BI07会返回能力未接入，并保留流水不被伪造。 | 文件上传/解析/源授权/去重/确认队列/原件留存清理全链缺失。文档/安全稿写“已有CSV转义”不能证明代码已实现。 |
| BA-B10 | 洞察挂动作，带商户/金额上下文跳订阅、目标或定投，重新过目标场景确认 | **部分具备通用基础**。已有通用多步plan和各目标业务执行器。 | 未见“由月报洞察生成可点击行动卡、携上下文跳转”专门链；现有通用编排不等于每条洞察已接入。应由跨场景审查代理进一步核实通用plan覆盖范围。 |
| BA-B11 | 所有外部字段打不可信标记、CSV防注入、恶意字段红队 | **部分实现**。参数白名单、严格结构检查、前端纯组件渲染以及后台受控执行已存在。 | 未见文档要求的全量商户/备注/导入文本`<untrusted_field>`包裹；CSV入口自身未实现；尚无本轮该完整数据路径的注入验收。 |
| BA-B12 | 从近三月真实消费计算频次/单价→推演到毕业→明确假设→可选利率→创建规则 | **部分实现**。BI09能确定性计算每期节省×期数，并说明只算本金。 | 需要用户直接给savePerPeriod和periodCount；不读取历史消费推导基准/频次/单价，不解析毕业期限；利率分支明确拒绝；缺与规则创建的专门行动链。 |
| BA-B13 | 多成员授权/退出、私人流水隔离、≥3聚合、退出后人数不足暂停、AA结算 | **未实现，明确UNSUPPORTED**。BI10只有目录入口。 | 共同账本/成员权限/跨账号数据/公共条目/人数运行时护栏/AA结算全部未做。此功能不应再要求FATE；最新版明确是普通共享账本。 |

### 账单证据索引

- `APP/lib/workflows/adapters.ts:22-26,34-35`：筛选与aggregate只处理expense/refund/income，未读取`cashOrNet`或AA数据。
- `APP/lib/workflows/adapters.ts:130-139`：BI01～06、预算、What-if实际查询，BI04只读` suspectedDuplicate`；BI05只回已有订阅；BI06仅统计并明确不出分位/海报。
- `APP/lib/workflows/adapters.ts:175`：future只存categories，生产代码中无相应读取/分类应用路径。
- `APP/lib/workflows/adapters.ts:67,114-115`：不支持历史批量分类、不支持利率试算。
- `APP/lib/workflows/catalog.ts:9`：BI07、BI10明确未接入。
- `APP/lib/workflows/fields.ts:11-12`：BI实际接受字段。
- `APP/lib/workflows/engine.ts:177-178`：核对材料、匿名分位、分享海报未接入说明。
- `APP/lib/workflows/offline.ts:68-84`：离线账单文字路由与有限期间/类目解析。
- `APP/lib/workflows/seed.ts:6-17`：合成流水、疑似重复标记、预置订阅。
- `APP/components/workflow-panel.tsx:16-23,43-44,49,57`：通用表单和结果呈现；不是完整月报/年报/海报。
- `APP/tests/workflows.test.ts:194-198,232-234`：统计退款/互转与单笔纠错测试；导入不可用测试。
- `APP/tests/plans.test.ts:112-114`：不可用导入会阻断后续链，不会伪造完成。

---

## 三、需要优先补的事项

1. **先补理财硬边界，不先堆动画**：年龄/课程门槛、当日撤单窗口；明确Demo测评与正式测评的差别。
2. **修复目标重规划**：改目标和期限后更新月供及关联规则，旧授权失效并重新展示后果。
3. **做出一个完整账单展示闭环**：动态分类→真实规则异常→月报洞察→订阅/目标行动，而不是仅增加目录项目。
4. **补上任务兑现层**：自动储蓄/定投、提醒目前都停在存规则；需要可控的模拟时钟/调度器，不能用保存成功代替触发成功。
5. **再补财富鹅核心差异化**：至少一个真实分支投教剧本、行为质量事件、成长/周记/进度反馈；目前财富鹅并未形成闭环。
6. 多源导入、公共账本、匿名分位、分享海报等可分批做，但应保留明确“未接入”状态，不能报已完成。

---

## 四、纯内存探针：最小复现及原始输出

运行目录：

`LOCAL_PROJECT/code/webank-competition/voice-bank`

命令：

```sh
node --experimental-transform-types --input-type=module <<'JS'
import {initialState,reduceBank} from './lib/bank/engine.ts';
import {currentWorkflow} from './lib/workflows/engine.ts';
const act=(s,c)=>reduceBank(s,{type:'workflow',command:{source:'card',...c}},crypto.randomUUID());
const run=(s,id,params={})=>act(s,{operation:'run',functionId:id,params});
function finish(s){
  let t=currentWorkflow(s);
  s=act(s,{operation:'confirm',taskId:t.id,token:t.reviewToken});
  t=currentWorkflow(s);
  if(t.status==='authenticate')
    s=act(s,{operation:'authenticate',taskId:t.id,token:t.verificationId,code:'123456'});
  return s;
}
let s=finish(run(initialState(),'IN01',{
  name:'test',target:3000,deadline:'2027-06-01',
  autoSave:true,accountId:'daily',schedule:'monthly'
}));
const goal=s.workflows.records.goals.at(-1);
const old=s.workflows.records.rules.at(-1).amount;
s=finish(run(s,'IN04',{action:'update',goalId:goal.id,target:6000}));
console.log(JSON.stringify({
  probe:'target_replan',
  newTarget:s.workflows.records.goals.at(-1).target,
  oldRuleAmount:old,newRuleAmount:s.workflows.records.rules.at(-1).amount,
  result:currentWorkflow(s).status
}));
s=finish(run(initialState(),'IN05',{answers:[5,5,5]}));
s=finish(run(s,'IN08',{productId:'fund-bond',accountId:'daily',amount:100}));
console.log(JSON.stringify({
  probe:'course_gate',educationRecords:s.workflows.records.education.length,
  bondOrder:s.workflows.records.orders[0].status
}));
s.workflows.records.orders[0].createdAt='2020-01-01T00:00:00.000Z';
s=finish(run(s,'IN12',{orderId:s.workflows.records.orders[0].id}));
console.log(JSON.stringify({
  probe:'stale_pending_order_cancel',
  orderDate:s.workflows.records.orders[0].createdAt,
  status:s.workflows.records.orders[0].status
}));
const a=run(initialState(),'BI02',{period:'2026-10',cashOrNet:'cash'});
const b=run(initialState(),'BI02',{period:'2026-10',cashOrNet:'net'});
console.log(JSON.stringify({
  probe:'cashOrNet',cash:currentWorkflow(a).result,net:currentWorkflow(b).result,
  same:JSON.stringify(currentWorkflow(a).result)===JSON.stringify(currentWorkflow(b).result)
}));
JS
```

Exit status: `0`

Literal stdout:

```text
{"probe":"target_replan","newTarget":600000,"oldRuleAmount":37500,"newRuleAmount":37500,"result":"complete"}
{"probe":"course_gate","educationRecords":0,"bondOrder":"pending"}
{"probe":"stale_pending_order_cancel","orderDate":"2020-01-01T00:00:00.000Z","status":"cancelled"}
{"probe":"cashOrNet","cash":{"current":{"grossExpenses":11500,"netExpenses":10300,"refunds":1200,"income":0,"count":5,"expenseCount":4,"refundCount":1,"countBasis":"交易笔数包括退款，并非全部为消费","period":"2026-10","category":"全部","basis":"退款冲减原支出；自有账户转移不计消费","coverage":"当前会话内合成本行流水及沙箱执行记录"}},"net":{"current":{"grossExpenses":11500,"netExpenses":10300,"refunds":1200,"income":0,"count":5,"expenseCount":4,"refundCount":1,"countBasis":"交易笔数包括退款，并非全部为消费","period":"2026-10","category":"全部","basis":"退款冲减原支出；自有账户转移不计消费","coverage":"当前会话内合成本行流水及沙箱执行记录"}},"same":true}
```

Literal stderr（只有Node实验功能提示）：

```text
(node:71119) ExperimentalWarning: Transform Types is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
```
