# Agent Note: Creative 和 Integrations 迁移原件及安装关系

Status: implemented

## Problem

旧站将 Creative 的历史版本、安装和 Integrations 的目标资源保存在同一个数据库。独立服务使用各自的状态目录，旧安装必须仍归安装者所有，待配置的 stdio MCP 也必须可以继续配置。Skill 目录使用原绝对路径，迁入另一目录后需要保留原件与摘要。

## Decision

分阶段传输业务记录、封面和 Skill 原件。文件使用账号目录下的受控相对路径，每个文件记录 SHA256 和持久回执。Creative 在元数据与原件读回后，从组合安装和单项安装生成一致的关联。Integrations 通过同一封存源核对目标资源的账号与存在状态，目标导入在事务内再次核对。组件摘要复用正常安装的算法，组合和单项安装仍保留旧 ID 与配置状态。

## Alternatives considered

仅复制 Creative 安装历史会让 Integrations 无法找到待配置的 MCP。直接复制旧库会保留跨服务数据和主机绝对路径。根据目标是否有记录推断旧资源已删除，会把目标漏导当成历史删除。

## Consequences

重新提交同一批次可读取原回执。旧站已删除目标资源的安装历史可迁移，仍保留原资源 ID。迁移后发生首次 stdio 配置时，原安装者可以用现有入口写入，配置回执可恢复。迁移监听器只在维护模式绑定回环地址。

## Verification

使用 `tests/apps/creative_workshop/test_creative_catalog_transfer.py` 和 `tests/apps/integrations/test_integrations_catalog_transfer.py` 的隔离回归验证原件、归属、断点恢复、重复回执、源已删除与目标漏导，以及 stdio 配置回执丢失后的恢复。
