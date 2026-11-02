# AA语音工具修复：已实测与边界

请结束旧语音对话，刷新主页面，再重新连接。旧会话保留旧工具说明。

## 结果

- 原句AA现在真实调用TR05并弹出补充卡；后台不再把金额/人数误当字段。
- 真实Qwen已完成AA补名单、改金额、取消、确认建单、查询记录；联系人/基金比较/账单/订阅/银行卡读取也实际返回卡片。
- 同一合成语音WAV最终已通过真实ASR调出AA确认卡；独立十月账单音频也通过。未确认AA，没有真实收款。
- ASR仍会误听：历史严格音频失败保留；安全补充降级由确定性错误转写回放验证，最终音频重放恰好识别准确，没有现场触发该分支。未做真人麦克风/听感验收。
-216项单测、13项语音定向回归、20项业务快检、TypeScript、构建通过。

本轮源码（本地资料：`docs/audit/business-gap-20261026/lite-implementation/voice-aa-fix-20261026/MODIFIED_FILE.tar.gz`，未随本次文档包上传） · 增量补丁（本地资料：`docs/audit/business-gap-20261026/lite-implementation/voice-aa-fix-20261026/DIFF_FILE.patch`，未随本次文档包上传） · [完整命令/输出/哈希](VERIFICATION.txt) · 独立副本回滚（本地资料：`docs/audit/business-gap-20261026/lite-implementation/voice-aa-fix-20261026/ROLLBACK.sh`，未随本次文档包上传）

[用户验证说明](../../../../../voice-bank/docs/workflows/voice-function-verification-2026-10-26.md)

原始成功与失败报告均在 reports/。部分文件整体标为failed，但前面的AA子步骤通过；完整记录明确区分，不把失败报表说成整体通过。

源码回滚已在独立副本实跑并核对哈希；它不回退金融状态。原工作区其他未提交修改保留。全局状态文档另备份在辅助backup/project-baseline中，不在应用回滚范围。
