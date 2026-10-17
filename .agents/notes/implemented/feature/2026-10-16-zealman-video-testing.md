# Agent Note: ZEALMAN 双工作流视频测试

Status: implemented

## Problem

ZEALMAN 工作流协议与现有视频协议不同；U17 未开放提示词，两个模板保存示例参考，直接替换部分输入会混入旧素材。模型测试原先一律要求 API Key。

## Decision

新增 zealman_video，限定模型服务与模型测试的 U17、U06。读取并验证工作流关键节点和参考连线，在独立副本写入提示词、参数和素材，按最终输出可达性裁剪无用分支。素材只上传到已配置的同一服务并使用唯一名称。前端消费后端能力声明，后端再次校验，不暴露原始事件。

GenerationTaskDriver 唯一编排状态，提交中断失败且不重提；轮询与账本恢复使用原 prompt_id。结果通过既有公网 HTTPS、大小和媒体识别校验落盘。60 分钟期限从本地任务创建计时。U06 种子范围按真实接口确定为 0 至 2^50，实际值进入快照。重试保存结果保留旧失败日志，为新终态创建新的日志。

追加 0091_zealman_video，扩展连接和模型测试任务的协议约束，保留数据、索引及外键。测试台可以省略不适用的通用字段，原视频协议继续恢复既有默认值。

## Alternatives considered

- **修改远端模板** — 影响其他调用方，改为提交独立副本。
- **任意节点编辑器** — 超出两个已知视频工作流的需求，增加前端协议耦合。
- **放宽公网校验** — TUN 虚拟 DNS 不构成放宽 SSRF 防护的理由；验收网络采用独立核实的公网解析。

## Consequences

- **收益**：输入可控，复用任务、权限、日志与结果保存。
- **代价与已知上限**：关键节点变化将明确拒绝；只有两个工作流；正式桌面需要停机备份和正常迁移，不能热更新绕过迁移预检。

## Verification

参考文件的提交协议后续由 [固定 API 参数修复](../bug-fix/2026-10-17-zealman-reference-input-values.md) 修正；本篇保留接入时的决策背景。

`uv run pytest -q tests/test_zealman_video.py tests/test_zealman_model_test.py tests/test_zealman_migration.py tests/test_zealman_workspace.py`；`npm run test --workspace web -- tests/zealman-model-test.test.tsx`。真实验收经隔离数据中的正式 /v1 任务、视频下载和日志完成。输入与结果保存在已忽略的 `.local/zealman/`。
