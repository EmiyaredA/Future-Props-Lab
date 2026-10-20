# Agent Note: 工具导航抖音 / B 站视频下载

Status: implemented

## Problem

创作流程经常需要把抖音或哔哩哔哩上的参考视频落到本机或 Workspace 文件库，但浏览器无法直接绕过站点限制完成下载；用户此前只能在终端手工调用 yt-dlp，并自行处理 Cookie 与落盘路径。

## Decision

在工具导航增加内部工具「视频下载」。后端落在 `tool_navigation/`：探测本机 `yt-dlp`/`ffmpeg`，校验抖音与 B 站宿主，用内存任务加运行时临时目录执行下载；可选 `--cookies-from-browser`（前端先 ConfirmDialog，系统钥匙串可能再确认），不经 API 回传 Cookie 明文。产物可浏览器另存，并可经 `AssetLibrary.stage_local_copy` 写入当前 Workspace 文件库。

## Alternatives considered

- **仅浏览器另存，不进文件库** — 无法直接在工坊选用，否决。
- **用户上传 Cookie 文件** — 操作成本高且明文经前端；改为确认后从本机浏览器读取。
- **Electron IPC 打开登录窗抓 Cookie** — 比 yt-dlp `--cookies-from-browser` 更重；同机后端已足够触发系统授权提示。
- **新建独立 App** — 能力属于工具导航单次下载，不引入新 App 边界。

## Consequences

- **收益**：工具页内完成链接下载、Cookie 授权提示、本机另存与文件库入库。
- **代价与已知上限**：依赖本机 yt-dlp/ffmpeg（不打包）；B 站等仍可能需 Cookie 授权；抖音公开视频改由应用内签名详情接口解析（见 [douyin-aweme-signature](../bug-fix/2026-10-20-douyin-aweme-signature.md)）；任务不跨进程持久化；不支持播放列表与其它站点。

## Verification

`uv run pytest tests/test_video_download.py`；Web 工具卡片与页面单测；`npm run contracts:generate` 后 `contracts:check`；`npm run verify-notes`。
