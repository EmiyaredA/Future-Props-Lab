# 节点验收与固定连接

视觉工坊在视频节点选择“动作迁移”的固定方案。项目入口只展示模板说明和节点汇总；质量结论不作为采用输出、生成、上传或画布保存的前置条件，验收结束不会替用户采用输出。

## 部署配置

只在 `backend/config.toml` 配置以下组，使用 TOML 原生字符串和数组。示例值为空，默认所有执行连接不可用。

```toml
[visual_acceptance]
model_workspace_id = ""
model_id = ""
codex_executable = ""
codex_user_ids = []
claude_executable = ""
claude_user_ids = []
```

模型必须是指定 Workspace 内启用的 chat + vision 模型，供应商也必须启用；不会自动替换连接。两个 executable 必须是本机绝对路径，user_ids 是获准使用该本机 CLI 登录的 FPL 账号 ID。执行账号仍须具有目标 Workspace 的内容写入及模型使用权限。连接状态仅展示安装、版本和登录探测结果，不发起付费模型调用。

新部署的五种 CLI 统一在 `[code_agents]` 设置 `codex`、`claude`、`opencode`、`dsh`、`pi` 的 `*_enabled` 与 `*_executable`，再在编程智能体页授予账号“视觉验收”用途；上面的旧 Codex/Claude 路径和账号列表仅作兼容。新增 OpenCode、DeepSeek Harness 与 Pi 均通过同一个任务专用 MCP 读取清单、证据和有界取样，返回同一份 AgentReport 并接受同样的证据与权限校验。

Codex 要求 0.163.0 或更新版本，Claude Code 要求 2.1.259 或更新版本。安装和登录由部署管理员在应用外完成；配置示例不包含账户、令牌或实际路径。应用不会安装、登录、改写全局配置或自动选择另一连接。正式数据更新仍走桌面停机备份和迁移预检，不能在热加载中应用新增迁移。

新增 CLI 最低版本为 OpenCode 1.19.4、DeepSeek Harness 0.2.1、Pi 1.4.0；执行隔离和模型连接配置边界见[编程智能体接入](code-agents.md)。

## 资料与执行边界

生成版本使用其生成任务的实际请求及输入快照。上传版本使用节点已保存的设置及明确连接的上游输出，并展示来源。全部声明的参考图片是角色参考，参考视频是动作参考，不根据文件名推断角色。缺少角色图或参考视频时，回到生成设置补齐；自适应尺寸和时长不推测成固定值。

节点绑定使用独立 revision CAS。发起请求携带输出 ID、绑定 revision、画布 revision、上下文指纹及幂等请求 ID；同一请求重放返回原记录，内容不同返回 409。运行记录冻结模板、方案、输入规则和返回契约版本、提示词、预期规格及素材引用。新草稿不能修改旧记录。

模型 API 接收检查要求与证据图片，输出抽样最多 12 帧，参考视频取首帧与中部帧。API 的逐项 JSON 和 Agent 的报告分别保存；映射后的建议始终待人工确认。抽帧不能证明完整连续动作、节奏或音画同步。

共享 `capabilities/agents/cli/` 只负责 CLI 参数、事件解析、取消和父进程退出监督。验收拥有任务包、结构化报告及证据转换。任务专用 MCP 只提供清单、证据图片和有界取样；不提供 Shell、任意文件读取或 FPL 服务凭据。一次最多追加 12 帧，每任务最多追加 24 帧，任务最长 15 分钟。取消、超时和进程中断终止子进程，恢复时标记失败，不自动重提。

## API 与历史

- `GET /v1/visual-workshop/acceptance/catalog`：只读模板及当前账号的真实连接状态。
- `GET /v1/visual-workshop/projects/{project_id}/acceptance/summary`：当前版本、验收状态、最终输出及问题摘要。
- `GET/PUT /v1/visual-workshop/projects/{project_id}/nodes/{node_id}/acceptance`：读取自动依据、CAS 选择固定方案。
- `POST /v1/visual-workshop/projects/{project_id}/nodes/{node_id}/acceptance/runs`：冻结并发起单节点检查。
- 记录、人工结论、证据取样和返修继续使用原 `/acceptance/runs/...` 与 `/acceptance/repair-drafts/...` 接口。

原模板写入、项目标准发布和项目批量发起返回 410，说明替代入口。旧模板及标准可以通过原读取 API 查看；旧记录和导入记录只读，不自动转换为新模板或给节点绑定方案。快照验收片段版本为 2，兼容版本 1，保留方案选择、执行依据、原始结构化结果及证据，导入后连接在目标部署重新校验。

## 验证

`tests/apps/visual_workshop/test_visual_acceptance.py` 使用临时 SQLite、合成媒体及假模型／Agent 验证业务闭环；`tests/host/test_acceptance_cli.py` 用假可执行文件验证不同事件、取消、环境隔离、结构化结果和媒体边界。浏览器测试使用真实隔离项目、素材与方案绑定，仅模拟外部执行及审阅响应，避免真实付费调用。真实 CLI 登录和供应商凭据不属于这些确定性测试的证明范围。
