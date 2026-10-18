# Agent Note: Seedance 官方视频接入

Status: implemented

## Problem

现有 Seedance 2.0 仅通过 SenseAudio 视频网关调用，无法使用火山方舟原生视频接口；固定的 15 秒、9/3/3 参考数量及音频组合规则不能表达 2.5。

## Decision

供应商类型 `volcengine_video` 直接适配方舟创建/查询任务。版本策略和文件预检位于 llm/providers，测试台、视觉工坊与独立推理消费公共 VideoCapabilitiesOut，分别管理自己的素材与事务。预检在任务写入和外传素材前执行；视频复用已有临时上传协议，图片与音频直接编码。状态仍由 GenerationTaskDriver 唯一编排，提交中断不自动重提，结果下载可独立恢复。

公共请求及草稿接收两个版本的参数并集，各用例按供应商校验旧上限，避免扩展泄漏到原供应商。迁移只扩展三个表的供应商检查约束，完整保留任务执行信息、外键和索引；不向已有 Workspace 自动写入连接、模型或密钥。模型服务提供两个官方 ID 预设；首尾帧测试素材共用 reference_image 所有权角色，具体位置存入请求快照。

## Alternatives considered

- 扩充 SenseAudio 网关：用户选择官方直连，不能假设网关已开放 2.5。
- 新增 TOS 上传：需要额外存储与凭据，用户选择复用现有临时上传服务。
- 把所有供应商扩成 30 秒：会让不支持的请求越过本地检查，保留分版本校验。

## Consequences

2.5 支持 30 秒和纯音频参考；2.0 保留 15 秒及音频组合限制。无视频上传配置时明确拒绝参考视频，文本、图片与音频仍可调用。输出固定 MP4，不增加编辑、延长、样片专用流程。所有自动验收使用临时隔离数据与模拟供应商，不读取或迁移桌面正式数据，不需要真实供应商 Key。

## Verification

确定性验证覆盖 tests/test_seedance_video.py、tests/test_seedance_migration.py 和 web/tests/seedance-generation.test.tsx；回归共享任务驱动、SenseAudio、ZEALMAN 与独立推理。执行契约生成、SDK 检查、相关架构测试、格式、lint、构建、官方知识库种子和 Agent Note 检查。真实供应商调用未执行。
