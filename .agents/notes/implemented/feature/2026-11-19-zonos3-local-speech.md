# Agent Note: ZONOS3 本机音色克隆与情绪控制

Status: implemented

## Problem

本地语音目录只有要求参考文稿的 Qwen Base，不能在模型测试中比较无需文稿的两种克隆条件和可控情绪。
单独运行供应商 Web 服务会绕开既有账号授权、任务回执和音频保存流程。

## Decision

- `config/local_models.json` 固定官方 ZONOS3-Mini 权重 revision、六份 GGUF 的大小和 SHA256，
  以及官方 MLX 源码归档的提交与 SHA256。安装只包含 keep2 解码器、说话人编码器、参考编码器、
  SSL teacher 与 steering；不安装完整解码器和编辑模型。
- `host/local_models/zonos_install.py` 使用独立的源码提交目录、Python 和带哈希的依赖锁。
  环境 ready 标记包含源码 revision 和依赖锁摘要；修复失败恢复该环境，不替换 Qwen 环境。
  所有运行依赖、可复用下载缓存和模型在实际 Worker 登记的 `.runtime/` 模型根目录中。
- `zonos_worker.py` 通过官方 Engine/Scheduler 执行 embedding/reference 克隆和情绪方向控制。
  复用串行私有管道、600 秒超时、取消回收和 300 秒空闲卸载，不开放新 HTTP 端口。
- 公共参数按 provider 校验。Qwen 保持非空参考文稿；ZONOS 提供中英日、可选参考文稿、
  两种克隆模式、六种情绪及 neutral、0–1 强度和 uint32 种子。强度按官方 base LM 建议上限缩放，
  neutral 不施加 steering。这里提供结构化情绪控制，不把任意自然语言 prompt 当作已支持功能。
- Models 从持久任务恢复合成选项并放入 path-free 原生信封；Mac 再校验模型专属参数。
  参数不能覆盖参考素材、文稿或输出路径，原始账号授权与输入摘要继续约束执行和恢复。
  UI 按 capabilities 显示控件，不向 Qwen 发送 ZONOS 参数。
  回执只接受有界测量及与原请求相符的 ZONOS 控制字段；已删除任务的延迟回执使用核验过摘要的
  原 lease 校验，不依赖已清空的持久 payload，也不恢复已清理的私人文本。
- 兼容网站追加 `0130_local_zonos_provider`，仅扩展 provider CHECK 并保留目录数据。
  独立 Models 的 provider kind 无 CHECK，现有字段与状态足够，不新增无关迁移。

## Alternatives considered

- 直接复用 Qwen MLX 环境：官方依赖版本不同，升级可能破坏现有语音，拒绝。
- 只部署官方网页服务：不能复用平台账号、任务记录与恢复边界，拒绝。
- 同时下载完整解码器或编辑模型：增加存储且无法隔离克隆模式变量，本次不采用。

## Consequences

两个克隆模式共享 keep2 解码器；reference 额外加载较大的参考编码器，速度和内存需分模式实测。
安装空间按两份权重加独立环境预算显示，实际占用含可复用下载缓存。情绪越强可能降低音色相似度。
模型只在显式安装动作后下载，导入代码、目录查询与应用启动不会触发安装。

## Verification

确定性测试覆盖 provider 参数隔离、非法值、私有信封重新校验、环境隔离及 ready 标记；
原生完整租约测试覆盖两种模式、可选文稿和情绪参数不丢失。Web 验证无需文稿、模式与情绪选择、
种子校验、单次提交及原 Qwen 语音流程。实机试听使用原冈部／红莉栖参考和既有 Qwen 基线，
对照结果、任务回执、资源消耗及失败记录保存在本次 `.local/zonos3-mini/` 验收目录。
隔离回归为 550 项通过，既有 spreadsheet SDK 文档标签缺项单列；相关 Web 40 项和生产构建通过。
独立环境修复失败／取消恢复与删除后的延迟回执均有确定性覆盖。实机 12 条任务均完成且无重生成，
12 份原件及 4 条连续对照通过正式 API 保存到文件库；空闲观测确认模型已卸载。
