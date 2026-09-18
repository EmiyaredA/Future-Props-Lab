# Agent Note: 录音标注从工具升级为正式应用

Status: implemented

## Problem

录音标注具备项目列表、完整编辑器与 Workspace 持久化，代码形状与五个正式工坊一致，却挂在工具导航与 `/tools/audio-annotation` 下。产品概念和代码结构错位，应用中心无法发现它，工具目录却混入了一个真正的项目型工作流。

## Decision

录音标注以「录音标注工坊」注册为第六个应用：`features/audio-annotation/module.ts` 进入 `applicationRegistry`，路由归入 `WorkshopPage`，规范 URL 为 `/apps/audio-annotation` 与 `/apps/audio-annotation/projects/<id>`；旧 `/tools/audio-annotation` 仍可解析并在进入时改写到新地址。工具目录摘除该条目；遗留的工具收藏/最近使用状态因 `TOOL_BY_ID` 过滤而被忽略。后端 API、ORM 与 SDK 路径不变。品牌图使用 `web/public/brand/audio-annotation-mark.png`（萌郁），经 `brandImage` 接到应用中心与侧栏。

## Alternatives considered

- **只把代码放进 apps/、保留工具 URL** — 产品概念仍错位，应用中心仍看不见。
- **连同后端一起改 `/v1/apps/audio-annotation`** — 破坏已有 SDK、桌面 Agent 操作白名单与书签，收益只在命名对称。
- **要求先补品牌图与项目存储根再升级** — 演示工坊同样只引用公共文件库；品牌图已按工坊徽章家族补齐。

## Consequences

- **收益**：应用中心、工坊壳、文档分组与路由类型与真实产品边界对齐；工具导航只保留单页工具。
- **代价与已知上限**：旧书签依赖前端重定向；文档截图仍可能显示旧入口文案，需择机重拍。

## Verification

- `uv run pytest -q tests/test_architecture.py`
- `npm run test --workspace web -- --run tests/navigation.test.tsx tests/tool-navigation.test.tsx tests/docs-content.test.ts`
- 打开 `/tools/audio-annotation` 应落到 `/apps/audio-annotation`；应用中心可见「录音标注工坊」。
