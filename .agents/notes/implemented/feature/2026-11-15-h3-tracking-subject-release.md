# Agent Note: H3 追踪对象标签前端发布

Status: implemented

## Problem

[标签交互与 main 集成](2026-11-15-h3-tracking-subject-tags.md) 已完成源码交付，
当前运行的 Visual 与 Models 仍使用旧文本框。用户要求提交 main 并更新运行页面。

## Decision

源码提交为 `fc5e1009`。两个应用分别基于可复现当前构建 ID 的部署源码，只覆盖该提交中的
`VideoSubjectControl.tsx` 与 `video-subject-control.css`；逐文件摘要核对确认没有其他源码差异。
保留现有功能及各自运行 API 指纹，不将 main 中其他版本差异随界面发布带入运行服务。

通过标准 `build-service` 生成不可变前端，登记到 `.runtime/deployment/web-releases/`，
再用 `activate` 与旧构建 ID、API 指纹执行比较后切换。正式构建不依赖 `.local/`，
原构建及资源继续保留，已打开的页面由用户自行刷新，不中断未保存编辑。

| 应用 | 回退构建 | 当前构建 |
| --- | --- | --- |
| Visual | `9afe87f31ad18f9a5327` | `34a079bf68c60b68a6d4` |
| Models | `38042c4965a907a2ba7f` | `734f54a2984925123ee5` |

## Alternatives considered

- 直接从 main 发布全部前端：会附带当前运行版本以外的差异，扩大本次标签样式任务范围。
- 替换容器或重启 Worker：本次两个应用的 API 均不变化，无须后端切换。

## Consequences

main 保存完整功能与标签实现；运行服务接收同一提交中的界面增量。
数据库、配置和后端容器不变，回退仅切换对应应用的前端构建指针。
正式发布回执位于 `.runtime/deployment/releases/tracking-subject-tags-20261115/receipt.json`，
记录源提交、当前与回退构建及各自 API 指纹；不需要全量数据备份。

## Verification

本机 `http://127.0.0.1:3000` 和公网 `https://studio.futurepropslab.cn` 的就绪检查、
新页面构建 ID、旧版动态资源、新版标签 JS/CSS 摘要与 gzip 资源均通过。
前后容器 ID、镜像、启动时间与健康状态一致，两个应用 API 指纹与发布前一致。
