# Agent Note: H3 紧凑追踪标签发布

Status: implemented

## Problem

首版追踪对象标签占用三层卡片空间，减少下方提示词的可见区域。用户要求压扁控件，
并将确认后的紧凑版提交到 main、发布到当前运行版本。

## Decision

源码提交 `2d79ec5b` 将标题、标签和输入压为单行，常态高度 32px。常驻说明保留为
无障碍描述和悬浮提示，错误信息仍可见；多个对象在局部横向滚动，避免增加常态高度。

两个应用各自基于可复现当前构建 ID 的部署源码，只覆盖该提交中的
`VideoSubjectControl.tsx` 和 `video-subject-control.css`。两个文件逐字节与提交比较，
其他源码摘要保持一致；沿用各自已部署 API 指纹。

不可变构建通过标准 stage 与 activate 发布到 `.runtime/deployment/web-releases/`，
比较原构建 ID 后切换，旧资源与回退版本保留。

| 应用 | 回退构建 | 当前构建 |
| --- | --- | --- |
| Visual | `34a079bf68c60b68a6d4` | `9903c2ca72e26f5a47b4` |
| Models | `734f54a2984925123ee5` | `e693bfdc79abf675c4c0` |

## Alternatives considered

- 保持三层卡片：占用提示词空间，用户已要求紧凑布局。
- 整体发布 main：会附带运行版本之外的源码差异，超出本次样式更新范围。

## Consequences

无需重启容器或 Worker，不修改数据库、配置或 API。用户自行刷新页面查看新布局。
正式发布回执保存在 `.runtime/deployment/releases/tracking-subject-compact-20261115/receipt.json`，
记录源码提交、当前与回退构建及 API 指纹；正式服务不依赖临时构建目录。

## Verification

标签交互 6 项测试、ESLint、Prettier 与差异空白检查通过。
Chrome 隔离预览中，桌面与 360px 窄屏高度均为 32px，明暗主题正常，无页面脚本错误或横向溢出。
两个应用不可变构建通过；本机和公网的新页面构建 ID、新旧动态资源、CSS 与 gzip 摘要校验通过。
发布前后容器 ID、镜像、启动时间与健康状态一致，两个应用 API 指纹保持一致。
