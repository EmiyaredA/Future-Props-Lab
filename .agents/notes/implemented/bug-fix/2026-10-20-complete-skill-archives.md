# Agent Note: 完整 Skill 资源包导入

Status: implemented

## Problem

Anatomy 等含交互示例及 PDF 的合法 Skill 资源包超过原先默认 10 MiB 的 ZIP 上限，简介也可能略超 1000 字符。删减示例或截断简介会使安装内容偏离用户提供的完整版本。原先容量和文件数错误文案还固定显示默认限制，不能说明部署实际配置。

## Decision

Skill ZIP 默认上限为 20 MiB，解压总量和文件数默认仍为 50 MiB 与 500，三项配置继续通过 TOML 和已有环境变量覆盖。校验错误显示当前配置值，上传表单说明默认值与配置边界。SKILL.md 的简介允许 1–4000 字符，原始 Markdown 和包内资源不作改写。

迁移 `0102_skill_description` 重建两个 Skill 表以扩容声明类型，保留全部列值、外键、唯一约束、检查约束与查询索引；迁移执行器在单个事务中关闭外键并在提交前检查完整性。旧 migration 不改写。目录职责及公共 HTTP 参数和响应形状保持不变。

实际资源的安装与导入通过用户授权的本地 Skill 目录和现有 `/v1/integrations/skills` 入口完成，包内脚本不会因导入而执行。正式数据升级使用停机备份和已登记迁移，热加载仍拒绝待迁移数据库。

## Alternatives considered

- 去掉示例 PDF 并缩短简介：可以沿用旧限制，但不满足用户选择的完整原包导入。
- 取消容量和简介限制：缺少必要资源边界，因此仍保留明确上限与 ZIP 安全校验。

## Consequences

已有显式配置仍优先于新默认值。增大压缩包上限不会放宽解压量、文件数量、路径、符号链接或重复路径限制。需要一次正式 schema 升级；已有版本目录、文件摘要、revision 和标签不变。

## Verification

`tests/apps/integrations/test_skill_archive_limits.py` 覆盖 20 MiB 边界、配置覆盖、1018/4000/4001 字符、超过旧大小限制的新建、追加版本和逐文件下载一致性。`tests/apps/integrations/test_skill_description_migration.py` 覆盖旧数据、类型、索引、唯一约束、外键、级联删除与重复运行。配置及原有 ZIP 安全测试继续验证其余边界。
