# 画像、数据与完整故事链

[总入口](README.md) · [最小单元](implementation-plan.md)

## 场景与数据同时接入的方法

保留当前状态机。每个完整场景准备一份合成数据集：人物已知属性、授权、账户/交易/订阅/卡片/规则、当前时间与结果事件。数据必须经正常工具入口产生可见状态，禁止点“下一幕”就把交易强改成功。展示跨月/半年可以切换已标注的合成阶段数据，不要求先建统一可控时钟平台。

拟新增 `scenario_id/persona_id/stage/source_refs/synthetic/consents/records/expected_transitions` 作为审核数据包字段；这只是最小字段建议，不代表已有SDK或新架构。挂载位置优先扩展 `lib/workflows/seed.ts` 与现有 `review-lite` 入口，业务行为仍走 `reduceWorkflow/reduceBank/reducePlan`，不从动画反向执行金融动作。

小知、阿澈、栗子按各稿的人生阶段呈现，原稿明写的例子金额/日期保留；用于测试的另造值必须标合成。账单小知大二与理财演示大三是不同阶段，不统一改掉历史故事。没有提供的全局路演稿不虚构，只保住各采用稿已有完整故事和接力。

## 各原文完整场景与画像链

### S01. 路演第一幕：小知月末看懂账单并行动

- **场景标识**：B-DEMO
- **原文位置**：file：bills-v1.7.md；start：663；end：685
- **人物与阶段**：小知大一，月生活费1600；是3.5大二画像同一人的回溯年，不另造角色
- **完整流程**：钱又没了→620/410/280分类→连续扣费3月询问→用户说不看→逐项确认取消56/月→目标场景真实沙箱回执或外部待验证→钱包800/200/300另行确认→23:47新商户89核对→用户说生日礼物→只改本笔→咖啡126/9追问→月报与匿名参照→宿舍288垫付AA草稿
- **拒绝/失败分支**：用户说还在看不取消；外部未核验不报完成；钱包没有另行确认不操作；夜间单笔不是硬规则三连。
- **对应最小单元**：[1·B01](implementation-plan.md#item-1)、[3·B03](implementation-plan.md#item-3)、[5·B05](implementation-plan.md#item-5)、[8·B08](implementation-plan.md#item-8)、[10·B10](implementation-plan.md#item-10)、[12·B12](implementation-plan.md#item-12)、[13·B13](implementation-plan.md#item-13)、[14·B14](implementation-plan.md#item-14)、[15·B15](implementation-plan.md#item-15)、[16·B16](implementation-plan.md#item-16)、[17·B17](implementation-plan.md#item-17)、[30·S01](implementation-plan.md#item-30)、[37·S08](implementation-plan.md#item-37)、[38·S09](implementation-plan.md#item-38)、[40·S11](implementation-plan.md#item-40)

### S02. 阿澈：升学求职期多路收入、垫付报销与毕业迁移

- **场景标识**：B-PERSONA-A
- **原文位置**：file：bills-v1.7.md；start：144；end：147
- **人物与阶段**：阿澈22岁大四实习
- **完整流程**：查询生活费+实习工资→报销到账匹配垫付→账本核销→诈骗风险提示与原渠道证据→半年储蓄/毕业特辑→用户确认切阶段
- **拒绝/失败分支**：同额未知到账不自动核销；读研/延毕不自动毕业；不把疑似诈骗说已定罪。
- **对应最小单元**：[1·B01](implementation-plan.md#item-1)、[6·B06](implementation-plan.md#item-6)、[7·B07](implementation-plan.md#item-7)、[8·B08](implementation-plan.md#item-8)、[19·B19](implementation-plan.md#item-19)、[21·B21](implementation-plan.md#item-21)

### S03. 栗子：发薪-房租-还款-结余节律

- **场景标识**：B-PERSONA-L
- **原文位置**：file：bills-v1.7.md；start：149；end：152
- **人物与阶段**：栗子24岁入职8个月，7500税后/房租1800/花呗1200
- **完整流程**：自设发薪/房租/还款日→主动导入花呗账单→只提醒并引导官方App→基于完整夹具算结余2100→建议500定投→理财闸门→工作第一年年度账单
- **拒绝/失败分支**：无导入不声称看见花呗；不替还款/评估偿债；没有完整支出不得按剧本硬算2100。
- **对应最小单元**：[9·B09](implementation-plan.md#item-9)、[14·B14](implementation-plan.md#item-14)、[17·B17](implementation-plan.md#item-17)、[19·B19](implementation-plan.md#item-19)、[22·B22](implementation-plan.md#item-22)

### S04. 研究生半收入期多源津贴与低收入异动

- **场景标识**：B-POSTGRAD
- **原文位置**：file：bills-v1.7.md；start：114；end：114
- **人物与阶段**：研一-研二，助学金600+助研津贴/奖学金，月600–2000波动
- **完整流程**：按来源列收入→识别订阅小额连续扣费→用户确认闲置→波动只温和解释→阶段由用户确认
- **拒绝/失败分支**：不套职场工资基线、不自动认定异常/毕业。
- **对应最小单元**：[1·B01](implementation-plan.md#item-1)、[7·B07](implementation-plan.md#item-7)、[9·B09](implementation-plan.md#item-9)、[12·B12](implementation-plan.md#item-12)、[14·B14](implementation-plan.md#item-14)、[21·B21](implementation-plan.md#item-21)

### S05. 如果模拟器：看见未来再建规则

- **场景标识**：B-WHATIF
- **原文位置**：file：bills-v1.7.md；start：529；end：544
- **人物与阶段**：阿澈毕业前14个月
- **完整流程**：少喝奶茶问题→取近三月月均180→14月本金2520与估算标签→拟每周45储蓄规则→用户明确周期/金额→目标规则闸门
- **拒绝/失败分支**：拒绝不建规则；实际没有数据就不编历史；本金与利息分离。
- **对应最小单元**：[1·B01](implementation-plan.md#item-1)、[18·B18](implementation-plan.md#item-18)、[17·B17](implementation-plan.md#item-17)

### S06. 宿舍AA公共账本：多账号共同记公共支出

- **场景标识**：B-DORM
- **原文位置**：file：bills-v1.7.md；start：546；end：565
- **人物与阶段**：小知四人宿舍
- **完整流程**：发起邀请→逐人授权→只上传自愿公开条目→210/4=52.5→结差额→用户确认AA→核销→退出至两人暂停聚合
- **拒绝/失败分支**：双设备演示至少三名已授权合成人；越权私人明细被拒；退出不再聚合。
- **对应最小单元**：[23·B23](implementation-plan.md#item-23)、[24·B24](implementation-plan.md#item-24)、[6·B06](implementation-plan.md#item-6)

### S07. 毕业/入职周年年度故事与脱敏分享

- **场景标识**：B-YEAR-STORY
- **原文位置**：file：bills-v1.7.md；start：297；end：303
- **人物与阶段**：同一人物大学到职场
- **完整流程**：真实或明确合成年度行为→生成300字AI标识散文→引语追溯→选字段→脱敏预览→本人确认下载
- **拒绝/失败分支**：无留存对话不写引语；关闭分享/未成年不导出；不编收益成长。
- **对应最小单元**：[19·B19](implementation-plan.md#item-19)、[20·B20](implementation-plan.md#item-20)、[21·B21](implementation-plan.md#item-21)、[46·S17](implementation-plan.md#item-46)

### S08. 订阅路演第一幕执行侧：40元→588年付→银行直连取消

- **场景标识**：S-DEMO
- **原文位置**：file：subscriptions-v1.5.md；start：532；end：549
- **人物与阶段**：小知，七订阅预置
- **完整流程**：40元苹果扣款→七项126全景图→PDF7天后月付确认→问588何时扣→11月2日具体日期→询问是否仍用而非偷看活跃→苹果指引亲点→健身直连后果+确认→回执→分级闭环卡→65节省估算有依据才建议储蓄
- **拒绝/失败分支**：日历“还有12天”须演示日期2026-10-21才成立；10月26则7天，不能固定照读；外部未核验不宣称已解约；保护类贷款拒绝。
- **对应最小单元**：[30·S01](implementation-plan.md#item-30)、[31·S02](implementation-plan.md#item-31)、[32·S03](implementation-plan.md#item-32)、[37·S08](implementation-plan.md#item-37)、[38·S09](implementation-plan.md#item-38)、[39·S10](implementation-plan.md#item-39)、[40·S11](implementation-plan.md#item-40)、[42·S13](implementation-plan.md#item-42)、[43·S14](implementation-plan.md#item-43)

### S09. 小知：陷阱易感期

- **场景标识**：S-TRAP
- **原文位置**：file：subscriptions-v1.5.md；start：167；end：172
- **人物与阶段**：20岁大二1600生活费，5–8项低价视频音乐网盘外卖会员
- **完整流程**：首月1元条款→下月25元提示→自愿建续费提醒→本人选择取消/保留→只对真实行为计成长
- **拒绝/失败分支**：未成年无个性诱导；关提醒不影响协议管理；不用未授权应用行为识别。
- **对应最小单元**：[30·S01](implementation-plan.md#item-30)、[32·S03](implementation-plan.md#item-32)、[33·S04](implementation-plan.md#item-33)、[44·S15](implementation-plan.md#item-44)、[45·S16](implementation-plan.md#item-45)、[52·S23](implementation-plan.md#item-52)

### S10. 阿澈：工具焦虑期

- **场景标识**：S-TOOLS
- **原文位置**：file：subscriptions-v1.5.md；start：174；end：178
- **人物与阶段**：22岁大四实习3000，考研/求职PDF简历AI会员
- **完整流程**：摘要/截图确认导入→7日试用明确到期→T1/短试用T0提醒→用户进官方入口→实际到期观察→毕业六月订阅体检清理
- **拒绝/失败分支**：OCR不确定不入库；无权查协议不能伪造T1核验；没有毕业确认不自动清。
- **对应最小单元**：[30·S01](implementation-plan.md#item-30)、[31·S02](implementation-plan.md#item-31)、[32·S03](implementation-plan.md#item-32)、[33·S04](implementation-plan.md#item-33)、[38·S09](implementation-plan.md#item-38)、[40·S11](implementation-plan.md#item-40)、[46·S17](implementation-plan.md#item-46)、[47·S18](implementation-plan.md#item-47)

### S11. 栗子：膨胀失控期与扣费地震仪

- **场景标识**：S-GROWTH
- **原文位置**：file：subscriptions-v1.5.md；start：180；end：184
- **人物与阶段**：24岁职场第一年，税后7500，300–600订阅含外币
- **完整流程**：五通道汇总→外币原金额/参考换算→对照自估与实际→12日98热区对15日到账→优先预留提醒/钱包草稿→月度年度复盘
- **拒绝/失败分支**：无汇率不硬算；不改平台扣款日；资金预留需授权；不将同一计划汇率波动当商户涨价。
- **对应最小单元**：[30·S01](implementation-plan.md#item-30)、[34·S05](implementation-plan.md#item-34)、[35·S06](implementation-plan.md#item-35)、[36·S07](implementation-plan.md#item-36)、[43·S14](implementation-plan.md#item-43)、[49·S20](implementation-plan.md#item-49)

### S12. 订阅葬礼：毕业清理仪式

- **场景标识**：S-GRAD
- **原文位置**：file：subscriptions-v1.5.md；start：397；end：401
- **人物与阶段**：用户确认毕业的同一小知，时间跳转明确标演示
- **完整流程**：六月经确认阶段→历史23/现存7→学生优惠到期→逐项清理→可跳过→证书预计年省1140须来自数据→第五幕年度叙事
- **拒绝/失败分支**：通道待核验不写全部取消；缺四年数据标模拟叙事；不自动推定毕业。
- **对应最小单元**：[34·S05](implementation-plan.md#item-34)、[37·S08](implementation-plan.md#item-37)、[38·S09](implementation-plan.md#item-38)、[43·S14](implementation-plan.md#item-43)、[46·S17](implementation-plan.md#item-46)、[20·B20](implementation-plan.md#item-20)、[21·B21](implementation-plan.md#item-21)

### S13. 小知生活费与冲动消费的一天

- **场景标识**：WS1
- **原文位置**：file：wealth-v1.8.md；start：120；end：125；quote：**Persona 1 · 小知｜20 岁，大二女生，文科**
- **人物与阶段**：小知20岁大二/月生活费1600
- **起因**：月初生活费到账
- **用户步骤**：按上月明确范围规则锁150演唱会目标→深夜399盲盒念头→提醒/冷静档案→周日记
- **终点结果**：目标有余额，日记有本周真实行为数，未发生实际交易不记成功
- **拒绝/失败分支**：撤回自动存钱同意/拒绝档案/坚持合法操作仍可走强确认
- **原文身份**：原稿场景
- **对应最小单元**：[77·W01](implementation-plan.md#item-77)、[78·W02](implementation-plan.md#item-78)、[83·W07](implementation-plan.md#item-83)、[100·W24](implementation-plan.md#item-100)、[101·W25](implementation-plan.md#item-101)、[103·W27](implementation-plan.md#item-103)、[104·W28](implementation-plan.md#item-104)、[106·W30](implementation-plan.md#item-106)

### S14. 阿澈实习结余到第一笔定投

- **场景标识**：WS2
- **原文位置**：file：wealth-v1.8.md；start：127；end：132；quote：**Persona 2 · 阿澈｜22 岁，大四男生，工科，实习中**
- **人物与阶段**：阿澈22岁大四/实习波动收入
- **起因**：实习工资到账
- **用户步骤**：30%毕业过渡目标→请求理财→分支课程→正式/合成明确标签测评→匹配产品→周投50→求职诈骗核验
- **终点结果**：已授权储蓄和定投受理分开，不能跳过课程/测评
- **拒绝/失败分支**：课程缺失、画像不适配、伪招聘链接不自动付款
- **原文身份**：原稿场景
- **对应最小单元**：[77·W01](implementation-plan.md#item-77)、[83·W07](implementation-plan.md#item-83)、[84·W08](implementation-plan.md#item-84)、[85·W09](implementation-plan.md#item-85)、[87·W11](implementation-plan.md#item-87)、[88·W12](implementation-plan.md#item-88)、[90·W14](implementation-plan.md#item-90)、[93·W17](implementation-plan.md#item-93)、[59·T07](implementation-plan.md#item-59)

### S15. 栗子第一笔工资与售后陪伴

- **场景标识**：WS3
- **原文位置**：file：wealth-v1.8.md；start：134；end：139；quote：**Persona 3 · 栗子｜24 岁，女，入职 8 个月，互联网公司运营**
- **人物与阶段**：栗子24岁/税后7500/10号工资/房租1800
- **起因**：已授权发薪分配事件
- **用户步骤**：先留足房租生活→1500应急金/500债基定投→持仓总览→旧基金事实复盘→月储蓄率28%与自设25%目标比较
- **终点结果**：本金/收益/现金流同源，固定费用与消费不重复扣算
- **拒绝/失败分支**：资金不足停、画像过期新业务限、亏损不惩罚/不荐调仓
- **原文身份**：原稿场景
- **对应最小单元**：[83·W07](implementation-plan.md#item-83)、[89·W13](implementation-plan.md#item-89)、[93·W17](implementation-plan.md#item-93)、[97·W21](implementation-plan.md#item-97)、[98·W22](implementation-plan.md#item-98)、[99·W23](implementation-plan.md#item-99)、[103·W27](implementation-plan.md#item-103)、[104·W28](implementation-plan.md#item-104)、[105·W29](implementation-plan.md#item-105)

### S16. 研一研二奖助学金与离校储备

- **场景标识**：WS4
- **原文位置**：file：wealth-v1.8.md；start：115；end：115；quote：| 研一–研二 | 奖助学金 + 助研津贴 + 实习 | 小额理财启蒙、定投纪律、为离校储备 | 奖学金到账、offer 落定 | 规划伙伴：目标储蓄体系化 |
- **人物与阶段**：研一研二阶段，不虚构第四个有名Persona
- **起因**：用户明确奖学金/助研津贴到账
- **用户步骤**：有期限目标→金额/比例规则→定投知识学习→进度和储备查询
- **终点结果**：复用目标/教育能力，明确阶段样例非额外核心银行业务
- **拒绝/失败分支**：来源不明不触发自动转存；用户不想定投仍能仅储蓄
- **原文身份**：原稿阶段覆盖
- **对应最小单元**：[77·W01](implementation-plan.md#item-77)、[80·W04](implementation-plan.md#item-80)、[83·W07](implementation-plan.md#item-83)、[86·W10](implementation-plan.md#item-86)、[97·W21](implementation-plan.md#item-97)

### S17. 理财第三幕完整路演

- **场景标识**：WS5
- **原文位置**：file：wealth-v1.8.md；start：723；end：747；quote：# 第八部分 · 端到端演示剧本（比赛 Demo）
- **人物与阶段**：小知大三20岁，不覆盖大二Persona夹具
- **起因**：800兼职费
- **用户步骤**：确认存300进度62%→剩500想理财→《500元的抉择》分支选错→标准题演示R2→费率风险→周三50授权与沙箱受理→深夜彩蛋小额100→两周后200/203.6→雨天陪伴/赎回说明→半年后应急金达标
- **终点结果**：所有金额来自同一剧情夹具实际事件，确认/受理/结算分开；达标事件触发绅士反馈
- **拒绝/失败分支**：未成年/画像不足/缺课拒绝；改口重确认；撤单/暂停可插演；不给卖不卖建议
- **原文身份**：原稿场景
- **对应最小单元**：[77·W01](implementation-plan.md#item-77)、[78·W02](implementation-plan.md#item-78)、[84·W08](implementation-plan.md#item-84)、[87·W11](implementation-plan.md#item-87)、[88·W12](implementation-plan.md#item-88)、[91·W15](implementation-plan.md#item-91)、[93·W17](implementation-plan.md#item-93)、[94·W18](implementation-plan.md#item-94)、[95·W19](implementation-plan.md#item-95)、[96·W20](implementation-plan.md#item-96)、[97·W21](implementation-plan.md#item-97)、[98·W22](implementation-plan.md#item-98)、[100·W24](implementation-plan.md#item-100)、[101·W25](implementation-plan.md#item-101)、[102·W26](implementation-plan.md#item-102)、[103·W27](implementation-plan.md#item-103)、[105·W29](implementation-plan.md#item-105)、[106·W30](implementation-plan.md#item-106)

### S18. 小知体面AA与反诈一天

- **场景标识**：TS1
- **原文位置**：file：transfer-v2.5.md；start：130；end：134；quote：**Persona 1 · 小知｜20 岁，大二**（月生活费 1600，住宿舍）
- **人物与阶段**：小知20岁大二/月生活费1600
- **起因**：垫付288聚餐
- **用户步骤**：规则确认→非等额改算→参与者确认→收款→逐人状态→24/48/72提醒→收齐归档→深夜保证金警示
- **终点结果**：288总额守恒，私密、来源分级、不进群
- **拒绝/失败分支**：不明名单澄清；有人拒绝规则不发出；外部已付待发起人核实
- **原文身份**：原稿场景
- **对应最小单元**：[60·T08](implementation-plan.md#item-60)、[61·T09](implementation-plan.md#item-61)、[62·T10](implementation-plan.md#item-62)、[63·T11](implementation-plan.md#item-63)、[64·T12](implementation-plan.md#item-64)、[65·T13](implementation-plan.md#item-65)、[66·T14](implementation-plan.md#item-66)、[74·T22](implementation-plan.md#item-74)、[59·T07](implementation-plan.md#item-59)

### S19. 阿澈租房押金与报销

- **场景标识**：TS2
- **原文位置**：file：transfer-v2.5.md；start：136；end：140；quote：**Persona 2 · 阿澈｜22 岁，大四，实习中**
- **人物与阶段**：阿澈22岁大四
- **起因**：给陌生房东2000押金
- **用户步骤**：号码/户名核验→新对象升级→延迟指令→电子回执租住归档；交通垫付标待报销→到账候选→用户核销
- **终点结果**：押金留凭证且有未执行撤销窗口，报销不被误认赠与
- **拒绝/失败分支**：无姓氏安全降级；已到账不能撤；核销不替代真实银行回调
- **原文身份**：原稿场景
- **对应最小单元**：[53·T01](implementation-plan.md#item-53)、[54·T02](implementation-plan.md#item-54)、[55·T03](implementation-plan.md#item-55)、[56·T04](implementation-plan.md#item-56)、[57·T05](implementation-plan.md#item-57)、[58·T06](implementation-plan.md#item-58)、[72·T20](implementation-plan.md#item-72)、[73·T21](implementation-plan.md#item-73)、[74·T22](implementation-plan.md#item-74)

### S20. 栗子合租月度资金安排

- **场景标识**：TS3
- **原文位置**：file：transfer-v2.5.md；start：142；end：146；quote：**Persona 3 · 栗子｜24 岁，入职 8 个月**
- **人物与阶段**：栗子24岁入职8个月
- **起因**：工资/房租/还款错期
- **用户步骤**：同历三日期→前三天余额检查→不足改期→规则执行回执→合租水电3人长期AA→随礼仅现金流事实
- **终点结果**：周期事务有实执行结果；净额仅建议，付款独立确认
- **拒绝/失败分支**：不足不垫付；失败即停；照片提取待确认，不能直接扣款
- **原文身份**：原稿场景
- **对应最小单元**：[67·T15](implementation-plan.md#item-67)、[68·T16](implementation-plan.md#item-68)、[69·T17](implementation-plan.md#item-69)、[70·T18](implementation-plan.md#item-70)、[71·T19](implementation-plan.md#item-71)、[72·T20](implementation-plan.md#item-72)、[73·T21](implementation-plan.md#item-73)、[105·W29](implementation-plan.md#item-105)

### S21. 转账第四幕完整路演

- **场景标识**：TS4
- **原文位置**：file：transfer-v2.5.md；start：563；end：586；quote：# 第八部分 · 端到端演示剧本（比赛 Demo）
- **人物与阶段**：小知大二周五晚
- **起因**：给张伟转50饭钱
- **用户步骤**：三张伟消歧→室友尾6688→回读与确认→回执→288/6改28和52→参与者确认→阶梯代催→收齐/月620→每月1号200目标规则与资金日历→500刷单保证金警示→用户取消
- **终点结果**：找人/AA/规则/反诈四段连续可走，不用静态话术代替金融结果
- **拒绝/失败分支**：对象改口旧确认失效；已结算不能撤；取消诈骗请求余额不动
- **原文身份**：原稿场景
- **对应最小单元**：[53·T01](implementation-plan.md#item-53)、[56·T04](implementation-plan.md#item-56)、[57·T05](implementation-plan.md#item-57)、[59·T07](implementation-plan.md#item-59)、[60·T08](implementation-plan.md#item-60)、[61·T09](implementation-plan.md#item-61)、[62·T10](implementation-plan.md#item-62)、[63·T11](implementation-plan.md#item-63)、[64·T12](implementation-plan.md#item-64)、[65·T13](implementation-plan.md#item-65)、[66·T14](implementation-plan.md#item-66)、[68·T16](implementation-plan.md#item-68)、[69·T17](implementation-plan.md#item-69)、[70·T18](implementation-plan.md#item-70)、[72·T20](implementation-plan.md#item-72)、[83·W07](implementation-plan.md#item-83)

### S22. 小知：第一张卡与温柔拒绝

- **场景标识**：CS1
- **原文位置**：cards-v1.5.md:173-177,517
- **人物与阶段**：20岁大二月生活费1600，另17岁边界夹具
- **完整流程**：说想办信用卡→澄清外区订阅或信用需要→年龄/学生资格→三路选择→父母单次授权→收件跟踪
- **终点结果**：合格只收件，未成年/缺同意温柔拒绝+合适支付替代
- **拒绝/失败分支**：授权拒绝/过期停收件，不劝虚构收入或借贷
- **对应最小单元**：[111·C01](implementation-plan.md#item-111)、[112·C02](implementation-plan.md#item-112)、[113·C03](implementation-plan.md#item-113)、[114·C04](implementation-plan.md#item-114)、[135·C25](implementation-plan.md#item-135)

### S23. 栗子南京268元误伤救援（原文候选安全演示）

- **场景标识**：CS2
- **原文位置**：cards-v1.5.md:126-137,504-517
- **人物与阶段**：24岁职场第一年，月薪7500
- **完整流程**：风险事件主动告警→概要原因→确认本人→强验/风控复核→解锁→重试→可选南京3天窗口→记录误伤守护日志
- **终点结果**：当场处理但不越风控/司法边界；误伤诚实记录
- **拒绝/失败分支**：红队角标模拟要求跳过验证时中止；验证失败不放行
- **对应最小单元**：[118·C08](implementation-plan.md#item-118)、[119·C09](implementation-plan.md#item-119)、[120·C10](implementation-plan.md#item-120)、[121·C11](implementation-plan.md#item-121)、[128·C18](implementation-plan.md#item-128)、[129·C19](implementation-plan.md#item-129)

### S24. 丢卡急救、挂失仪式与绑定迁移

- **场景标识**：CS3
- **原文位置**：cards-v1.5.md:272-305,514-515
- **人物与阶段**：小知校园丢卡，栗子工资卡丢失
- **完整流程**：我卡丢了→明确卡对象→同设备弱认证先冻结→安抚→可选单次地点授权寻卡→找到原机秒解；确认丢失则后果/费用+强验正式挂失→3订阅迁移→补卡/虚拟卡过渡→守护归来卡
- **终点结果**：冻/挂/补/换绑各自真实沙箱状态，未迁项保留
- **拒绝/失败分支**：不授权地点仍可办理；补验超时转人工；旧挂失卡不能解冻
- **对应最小单元**：[122·C12](implementation-plan.md#item-122)、[123·C13](implementation-plan.md#item-123)、[124·C14](implementation-plan.md#item-124)、[125·C15](implementation-plan.md#item-125)、[126·C16](implementation-plan.md#item-126)、[135·C25](implementation-plan.md#item-135)、[137·C27](implementation-plan.md#item-137)

### S25. 阿澈出国：多卡开关与回国复位

- **场景标识**：CS4
- **原文位置**：cards-v1.5.md:179-183,270,386
- **人物与阶段**：22岁大四实习，毕业旅行
- **完整流程**：出国意图→卡台账与来源说明→本行逐项确认设置→他行官方操作清单→回国提醒复位
- **终点结果**：本行可验证的设置与他行只导航同时成立
- **拒绝/失败分支**：无授权不聚合；台账不能假称他行实时状态
- **对应最小单元**：[127·C17](implementation-plan.md#item-127)、[119·C09](implementation-plan.md#item-119)、[124·C14](implementation-plan.md#item-124)

### S26. 额度焦虑到自我保护

- **场景标识**：CS5
- **原文位置**：cards-v1.5.md:185-189,244-251,331-347,389-390
- **人物与阶段**：栗子房租押金不够，转正后申请；小知深夜冲动
- **完整流程**：区分授信/交易限额→公开因素说明→额度年轮→身份确认的毕业提额包或主动降额→选深夜锁/30分钟/72小时保护→紧急豁免→次日中性回顾
- **终点结果**：可视、可解释但不保证审批；自律不限制必要支出
- **拒绝/失败分支**：缺有效来源不做评分；恢复冷静期不能被模型绕过
- **对应最小单元**：[115·C05](implementation-plan.md#item-115)、[116·C06](implementation-plan.md#item-116)、[117·C07](implementation-plan.md#item-117)、[130·C20](implementation-plan.md#item-130)、[131·C21](implementation-plan.md#item-131)、[132·C22](implementation-plan.md#item-132)、[133·C23](implementation-plan.md#item-133)、[134·C24](implementation-plan.md#item-134)、[129·C19](implementation-plan.md#item-129)

### S27. 一商户一卡与断粮测试

- **场景标识**：CS6
- **原文位置**：cards-v1.5.md:349-355,391
- **人物与阶段**：阿澈外区订阅、栗子线上消费
- **完整流程**：创建沙箱虚拟卡→用途和月流出矩阵→选择订阅→主动声明无合约月付→后果告知+二次确认→关该卡→观察→正式解约另办
- **终点结果**：隔离卡片支付风险与商户合约法律效果
- **拒绝/失败分支**：保护名单、分期、合约不允许测试；不把扣不到钱当合约取消
- **对应最小单元**：[135·C25](implementation-plan.md#item-135)、[136·C26](implementation-plan.md#item-136)、[129·C19](implementation-plan.md#item-129)

### S28. 五纵向场景内七条必要接力

- **场景标识**：XS1
- **原文位置**：cross-scenario-v1.3.md:98-106
- **人物与阶段**：小知/阿澈/栗子各原场景
- **完整流程**：触发/洞察→说明将去哪做什么→白名单上下文→目标场景独立确认→记录真实结果→下一步单独确认
- **终点结果**：完成的是整个场景，不是只留跳转按钮
- **拒绝/失败分支**：缺授权带路不带数据；中断明确已完成/卡点/手动继续
- **对应最小单元**：[13·B13](implementation-plan.md#item-13)、[18·B18](implementation-plan.md#item-18)、[17·B17](implementation-plan.md#item-17)、[125·C15](implementation-plan.md#item-125)、[24·B24](implementation-plan.md#item-24)、[10·B10](implementation-plan.md#item-10)、[140·X08](implementation-plan.md#item-140)

### S29. 生日不翻车：四次确认完整链

- **场景标识**：XS2
- **原文位置**：cross-scenario-v1.3.md:170-197,431-436
- **人物与阶段**：阿澈大四，小冉11月3日生日，不擅塞小知四年幕次
- **完整流程**：T-7有授权依据触达→确认①锁300→方案128+99+机动70→确认②定方案→T-2核对→确认③唤起美团沙箱→确认④付227→回流生日账单/AI叙事→可逆后悔药
- **终点结果**：四确认分别可见，预算结余73，支付/叙事基于实际沙箱回执
- **拒绝/失败分支**：拒绝任一步不越过；外页关闭可续接；已付款不给虚假一键退款
- **对应最小单元**：[144·X12](implementation-plan.md#item-144)、[145·X13](implementation-plan.md#item-145)、[146·X14](implementation-plan.md#item-146)、[148·X16](implementation-plan.md#item-148)、[149·X17](implementation-plan.md#item-149)、[150·X18](implementation-plan.md#item-150)、[151·X19](implementation-plan.md#item-151)、[157·X25](implementation-plan.md#item-157)、[158·X26](implementation-plan.md#item-158)、[159·X27](implementation-plan.md#item-159)、[161·X29](implementation-plan.md#item-161)

### S30. 工资到账规则可信演示

- **场景标识**：XS3
- **原文位置**：cross-scenario-v1.3.md:129-142,438
- **人物与阶段**：栗子发薪日
- **完整流程**：说到账转500→条件/上限/冲突预检→创建确认→到账触发→首跑确认→结果/历史→规则中心暂停
- **终点结果**：之后仅限明确低风险授权范围按规则执行
- **拒绝/失败分支**：余额不足停止；重复事件幂等；暂停即停；模型不能自由触发
- **对应最小单元**：[141·X09](implementation-plan.md#item-141)、[142·X10](implementation-plan.md#item-142)、[143·X11](implementation-plan.md#item-143)、[145·X13](implementation-plan.md#item-145)

### S31. 第一份工资

- **场景标识**：XS4
- **原文位置**：cross-scenario-v1.3.md:203-221
- **人物与阶段**：栗子毕业入职首月
- **完整流程**：首薪确认→三个独立建议→妈妈520与可改附言→每月500计划创建/首跑→房租还款提醒→实际结余→年度叙事
- **终点结果**：独立选择，留出生活消费，不劝每分都存
- **拒绝/失败分支**：识别/余额不足不编“还剩800多”；取消一项不被迫接受其他
- **对应最小单元**：[152·X20](implementation-plan.md#item-152)、[142·X10](implementation-plan.md#item-142)、[143·X11](implementation-plan.md#item-143)、[140·X08](implementation-plan.md#item-140)、[160·X28](implementation-plan.md#item-160)

### S32. 妈妈生日

- **场景标识**：XS5
- **原文位置**：cross-scenario-v1.3.md:223-241
- **人物与阶段**：成年用户与父母
- **完整流程**：T-7授权事件→转520+视频提醒／69宽带代扣／鲜花蛋糕三方案→方案选定→各自确认→账单“给妈妈的”→年度回顾
- **终点结果**：代扣成为亲情工具但有本人确认与父母知情
- **拒绝/失败分支**：不自动代付别人的协议；偏好/历史无来源就不讲
- **对应最小单元**：[153·X21](implementation-plan.md#item-153)、[144·X12](implementation-plan.md#item-144)、[146·X14](implementation-plan.md#item-146)、[151·X19](implementation-plan.md#item-151)、[160·X28](implementation-plan.md#item-160)

### S33. 生活费断供缓冲

- **场景标识**：XS6
- **原文位置**：cross-scenario-v1.3.md:243-261
- **人物与阶段**：小知月中生活费迟到
- **完整流程**：满2个月节律后T+5私下问→余额÷近三月必要日支出→算可撑天数→逐项可选暂停→代拟不代发→到账后确认恢复→不留窘迫标签
- **终点结果**：守住体面与退出权，不通知家长
- **拒绝/失败分支**：数据不足不报9天；保护代扣不能随意停；恢复不能自动越权
- **对应最小单元**：[154·X22](implementation-plan.md#item-154)、[145·X13](implementation-plan.md#item-145)、[140·X08](implementation-plan.md#item-140)

### S34. 开学与毕业阶段接续

- **场景标识**：XS7
- **原文位置**：cross-scenario-v1.3.md:154-155,371,440
- **人物与阶段**：小知四年及阿澈毕业
- **完整流程**：单独确认阶段→开学预算分配或毕业账单体系迁移→订阅葬礼/学生价失效→提额包→年度钱与跑腿故事合并
- **终点结果**：多场景按阶段接续，故事与结果同步
- **拒绝/失败分支**：不把工资到账自动当毕业；各迁移环节可拒绝
- **对应最小单元**：[155·X23](implementation-plan.md#item-155)、[156·X24](implementation-plan.md#item-156)、[116·C06](implementation-plan.md#item-116)、[160·X28](implementation-plan.md#item-160)

### S35. 七个候选事件模板与多人协同储备

- **场景标识**：XS8
- **原文位置**：cross-scenario-v1.3.md:263-275,321-325
- **人物与阶段**：恋爱、备考、开学、租房、人情、深夜情境及宿舍群体
- **完整流程**：事件+最短接力概要登记→挑选后再完整链设计；多人需逐人授权和退出专项设计
- **终点结果**：全部有去向但不伪称本轮MVP已支持
- **拒绝/失败分支**：不将储备模板/多人共享说成已实现或联邦学习
- **对应最小单元**：[162·X30](implementation-plan.md#item-162)、[163·X31](implementation-plan.md#item-163)、[164·X32](implementation-plan.md#item-164)、[165·X33](implementation-plan.md#item-165)、[166·X34](implementation-plan.md#item-166)、[167·X35](implementation-plan.md#item-167)、[168·X36](implementation-plan.md#item-168)、[169·X37](implementation-plan.md#item-169)

### S36. 联邦+辩论：异地新商户是否真异常

- **原文位置**：federated-learning-agent-debate.md:143–153,193–197
- **完整流程**：三方合成训练与对照→版本化风险证据→三方独立初答/质询→确定性裁决→本人/非本人/人工；争议不直接变写操作
- **对应最小单元**：[170·R01](implementation-plan.md#item-170)、[171·R02](implementation-plan.md#item-171)、[172·R03](implementation-plan.md#item-172)、[173·R04](implementation-plan.md#item-173)、[174·R05](implementation-plan.md#item-174)、[175·R06](implementation-plan.md#item-175)、[176·R07](implementation-plan.md#item-176)、[177·R08](implementation-plan.md#item-177)、[179·R10](implementation-plan.md#item-179)、[180·R11](implementation-plan.md#item-180)

### S37. 三分钟轻量攻防

- **原文位置**：security-v2.0.md:190–194
- **完整流程**：骗局提示→姓名注入仅作为数据→语音确认不直接写→金额回读→专用确认表单→留痕；不展示真实资金或生产凭据
- **对应最小单元**：[182·Q01](implementation-plan.md#item-182)、[188·Q07](implementation-plan.md#item-188)、[189·Q08](implementation-plan.md#item-189)、[190·Q09](implementation-plan.md#item-190)、[191·Q10](implementation-plan.md#item-191)

## 每场一次集中审核的顺序

1. 显示画像/情境/原文引用和合成角标，载入明确初始状态。
2. 按原故事完成正常路径，核对每个用户停顿/确认、后台结果与角色反馈，不只检查工具是否返回。
3. 同入口运行拒绝授权、改口、取消、失败/未知回执及重复请求；只对可逆的沙箱状态做还原，不能把已结算付款当可回滚。
4. 多人账本必须用独立身份/会话验证权限，单机切换角色只能算预览，不能冒充多账号验收。
5. 一页汇总每个场景通过/失败/未做与剩余问题，一次供用户审核；没有跑过的场景保持未验收。
