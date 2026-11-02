# 共用能力、依赖与实施顺序

[总入口](README.md) · [快速审核](quick-review.md)

## 只建一次、按场景验收的共享实现

这些是实现方法，不额外凑业务编号。首档依赖在首档交付，不能因为与跨场景共用就被后置。

| 共用部分 | 首个落点 | 复用方 | 最小边界 |
|---|---|---|---|
| 授权记录与撤回 | B02 | W30/T23/S23/C03/X12 | 一次实现范围、来源、过期、撤回记录；域内分别写告知和选择界面。C03仅本次第二还款来源授权，不升级成C28长期家庭监控。 |
| 两层类目/商户字典 | B03 | T04/B04/B05/B12/S01 | 同一字典服务新流水、备注和订阅识别；纠错默认仅本笔，未来规则和历史批改分别授权；不要建三套分类器。 |
| 首档受控事件/到期入口 | W07/T18/S04 | W05/W18/W22/W26/S03/S11 | 第一档即为所在场景交付：明确合成到账/到期事件，确定性授权/余额/对象复核与幂等；只保留一个小入口，不要求先建队列/通用时钟。第二档X09–X11再扩用户通用条件规则。周期自动执行与E0冲突须先裁定。 |
| 七条必要模块交接 | X08 | B13/B18/B17/C15/B24/B10 | 复用现有TaskPlan逐步确认+字段白名单。X01–X07已并入对应业务项，见别名表，不再算7份重复开发成本。 |
| 报告/年度事实素材 | B14/B19/B20 | S14/S17/X28/W28 | 同一流水/行为证据索引，各场景独立文案与授权；没有留存对话不编“那天你说”。 |
| 成长事件去重与呈现 | W27 | S15/S16/C19/账单里程碑 | 共用事件ID与来源校验，但理财等级/订阅免疫力/卡片守护日志/账单里程碑独立计量，不跨域加总、不换资金权益。 |
| 多身份与最小共享 | B23/B24 | S21/C28/X30 | 先完成服务端权限与退出。后面三者保留候选，不能借前置模块已有就宣称它们实现。 |
| 合成夹具与审核入口 | 各实施卡data字段 | 所有37场景 | 扩seed/review-lite已有位置；每个功能同时提交画像数据、步骤与预期结果。切角色/模拟回调只算沙箱，不能冒充真实机构或多设备验收。 |

## 七个接力合并关系

| 原分域key | 合并后的同一实施项 | 说明 |
|---|---|---|
| X01 | [13·B13](implementation-plan.md#item-13) | 原文交接与验收全部并入，不重复编号/成本 |
| X02 | [18·B18](implementation-plan.md#item-18) | 原文交接与验收全部并入，不重复编号/成本 |
| X03 | [17·B17](implementation-plan.md#item-17) | 原文交接与验收全部并入，不重复编号/成本 |
| X04 | [125·C15](implementation-plan.md#item-125) | 原文交接与验收全部并入，不重复编号/成本 |
| X05 | [24·B24](implementation-plan.md#item-24) | 原文交接与验收全部并入，不重复编号/成本 |
| X06 | [10·B10](implementation-plan.md#item-10) | 原文交接与验收全部并入，不重复编号/成本 |
| X07 | [17·B17](implementation-plan.md#item-17) | 原文交接与验收全部并入，不重复编号/成本 |

## 语义前置条件的明确去向

这些名字是跨稿依赖别名，不是另有一套待建设的产品。

| 前置名称 | 落点/处理 |
|---|---|
| AA结算 | [64·T12](implementation-plan.md#item-64)、[66·T14](implementation-plan.md#item-66) |
| 人生事件日历 | [144·X12](implementation-plan.md#item-144) |
| 共享站内通知 | [33·S04](implementation-plan.md#item-33) |
| 宿舍账本 | [23·B23](implementation-plan.md#item-23)、[24·B24](implementation-plan.md#item-24) |
| 按人名/商户解析 | [53·T01](implementation-plan.md#item-53)、[12·B12](implementation-plan.md#item-12) |
| 理财护栏 | [87·W11](implementation-plan.md#item-87)、[88·W12](implementation-plan.md#item-88) |
| 理财目标转存 | [77·W01](implementation-plan.md#item-77)、[78·W02](implementation-plan.md#item-78) |
| 生日不翻车四确认链 | [148·X16](implementation-plan.md#item-148)、[149·X17](implementation-plan.md#item-149)、[150·X18](implementation-plan.md#item-150)、[151·X19](implementation-plan.md#item-151) |
| 确认口径裁定 | 实施前按下列确认口径裁定，不作为已完成能力 |
| 订阅协议建档 | [30·S01](implementation-plan.md#item-30)、[31·S02](implementation-plan.md#item-31) |
| 订阅暂停恢复 | [37·S08](implementation-plan.md#item-37)、[39·S10](implementation-plan.md#item-39) |
| 订阅葬礼 | [46·S17](implementation-plan.md#item-46) |
| 订阅通道分层观察 | [40·S11](implementation-plan.md#item-40) |
| 账单体系迁移 | [21·B21](implementation-plan.md#item-21) |
| 账单共享账本/导入 | [22·B22](implementation-plan.md#item-22)、[23·B23](implementation-plan.md#item-23) |
| 账单分享 | [19·B19](implementation-plan.md#item-19) |
| 账单叙事 | [20·B20](implementation-plan.md#item-20) |
| 账单年度叙事 | [20·B20](implementation-plan.md#item-20) |
| 账单异常复核 | [8·B08](implementation-plan.md#item-8)、[9·B09](implementation-plan.md#item-9)、[10·B10](implementation-plan.md#item-10) |
| 账单非标流水 | [6·B06](implementation-plan.md#item-6)、[7·B07](implementation-plan.md#item-7) |
| 跨场景共用授权事件执行入口 | [83·W07](implementation-plan.md#item-83)、[70·T18](implementation-plan.md#item-70)、[33·S04](implementation-plan.md#item-33) |
| 转账AA付款核销 | [62·T10](implementation-plan.md#item-62)、[63·T11](implementation-plan.md#item-63)、[64·T12](implementation-plan.md#item-64) |
| 转账周期规则 | [68·T16](implementation-plan.md#item-68)、[70·T18](implementation-plan.md#item-70)、[71·T19](implementation-plan.md#item-71) |
| 转账确认等级 | [57·T05](implementation-plan.md#item-57) |
| 转账风险提醒 | [59·T07](implementation-plan.md#item-59) |
| 预算钱包 | [17·B17](implementation-plan.md#item-17)、[77·W01](implementation-plan.md#item-77)、[78·W02](implementation-plan.md#item-78) |

## 首档按场景推进，不按表号硬跑

- 账单—订阅：授权/字典与三个画像夹具 → 查账/发现 → 用户核实 → 通道分流与后果确认 → 真实沙箱银行解约或外部指引 → 分层停扣观察 → 报告/免疫力/自选行动。三个Persona与现金流数据随功能加入，不留到“以后讲故事”。
- 转账：稳定收款人/手机号合成核验 → 回读与分级确认 → 执行/延迟/撤销分支 → AA改算/成员确认/收款/代催 → 周期规则与失败停机。
- 理财：目标罐 → 课程分支 → 独立问卷/年龄/课程硬准入 → 货架/详情/比较 → 申购/定投受理及结算 → 后续赎回/冷静/成长。R2债基用新增明确合成产品，不偷改现有risk=3。
- 卡片：三画像办卡/额度/解锁 → CM-C08保护性例外 → 正式挂失/迁移/补卡 → 日志/年轮/三种自律/数字分卡/挂失仪式。真实支付阻断不在Web沙箱承诺内。
- 第二档再扩独立事件日历、通用规则中心、四旗舰与外部交接准备。第三、四档按原顺序；现有基础安全不推迟。

## 候选与后续研究不自动开工

| key/编号 | 候选或后续项 | 本轮处理 |
|---|---|---|
| [25·B25](implementation-plan.md#item-25) | 储备：情绪记账·后悔数据 | 只登记去向；只有另行选中才执行卡内实现/验收，成本不进入首版承诺 |
| [26·B26](implementation-plan.md#item-26) | 储备：账单时光机事件标签 | 只登记去向；只有另行选中才执行卡内实现/验收，成本不进入首版承诺 |
| [27·B27](implementation-plan.md#item-27) | 储备：预算作战模式 | 只登记去向；只有另行选中才执行卡内实现/验收，成本不进入首版承诺 |
| [28·B28](implementation-plan.md#item-28) | 储备：反诈疫苗月度案例 | 只登记去向；只有另行选中才执行卡内实现/验收，成本不进入首版承诺 |
| [29·B29](implementation-plan.md#item-29) | 储备：人情温度计 | 只登记去向；只有另行选中才执行卡内实现/验收，成本不进入首版承诺 |
| [50·S21](implementation-plan.md#item-50) | 候选：宿舍团购哨兵与会员分账 | 只登记去向；只有另行选中才执行卡内实现/验收，成本不进入首版承诺 |
| [51·S22](implementation-plan.md#item-51) | 候选：学生价资格提醒与官方认证入口 | 只登记去向；只有另行选中才执行卡内实现/验收，成本不进入首版承诺 |
| [107·W31](implementation-plan.md#item-107) | 竞品候选：交易时点、非交易挂单与全额撤单 | 只登记去向；只有另行选中才执行卡内实现/验收，成本不进入首版承诺 |
| [108·W32](implementation-plan.md#item-108) | 竞品候选：指定日期申购/赎回 | 只登记去向；只有另行选中才执行卡内实现/验收，成本不进入首版承诺 |
| [109·W33](implementation-plan.md#item-109) | 竞品候选：巨额赎回未成交部分顺延 | 只登记去向；只有另行选中才执行卡内实现/验收，成本不进入首版承诺 |
| [110·W34](implementation-plan.md#item-110) | 竞品候选：定赎与定投失败策略 | 只登记去向；只有另行选中才执行卡内实现/验收，成本不进入首版承诺 |
| [138·C28](implementation-plan.md#item-138) | 家庭共管候选：隐私范围与后续实施边界 | 只登记去向；只有另行选中才执行卡内实现/验收，成本不进入首版承诺 |
| [162·X30](implementation-plan.md#item-162) | 多人协同链：保留候选与退出权限设计 | 只登记去向；只有另行选中才执行卡内实现/验收，成本不进入首版承诺 |
| [163·X31](implementation-plan.md#item-163) | 候选模板：异地见面（恋爱） | 只登记去向；只有另行选中才执行卡内实现/验收，成本不进入首版承诺 |
| [164·X32](implementation-plan.md#item-164) | 候选模板：道歉急救（慎用） | 只登记去向；只有另行选中才执行卡内实现/验收，成本不进入首版承诺 |
| [165·X33](implementation-plan.md#item-165) | 候选模板：考试季护航 | 只登记去向；只有另行选中才执行卡内实现/验收，成本不进入首版承诺 |
| [166·X34](implementation-plan.md#item-166) | 候选模板：开学季分配扩展 | 只登记去向；只有另行选中才执行卡内实现/验收，成本不进入首版承诺 |
| [167·X35](implementation-plan.md#item-167) | 候选模板：租房季闯关 | 只登记去向；只有另行选中才执行卡内实现/验收，成本不进入首版承诺 |
| [168·X36](implementation-plan.md#item-168) | 候选模板：份子钱潮汐 | 只登记去向；只有另行选中才执行卡内实现/验收，成本不进入首版承诺 |
| [169·X37](implementation-plan.md#item-169) | 候选模板：深夜冲动守护 | 只登记去向；只有另行选中才执行卡内实现/验收，成本不进入首版承诺 |
| [181·R12](implementation-plan.md#item-181) | 订阅别名/取消路由冲突的研究复用 | 只登记去向；只有另行选中才执行卡内实现/验收，成本不进入首版承诺 |

## 实施前需裁定的少数边界

1. **交互式写、周期授权与临冻**：建议普通交互写手动；已明确范围的周期规则创建+首跑确认后可确定性自动执行；CM-C08先冻结后补验。三类不是同一“所有写”规则。源稿相冲突，须确认该矩阵后改代码；本次不称裁定已获批。
2. **软模型风险分**：只读提示与硬升级分开；不得靠概率模型自行授权或把疑似定性为诈骗。
3. **生日罐付款**：现有engine仅有账户付款；需明确是预算子账本受控核销还是先释放回付款账户，再做余额守恒和确认。源稿又写“当天解锁”却T-2付款，执行前定清时间/用途，不能直接把goal记录当已有支付账户。
4. **外部与正式资格**：官方问卷、真实号码核验、商户回执、征信与官方跳转未接时按明确沙箱或手工指引；不把待核材料编成接口。

