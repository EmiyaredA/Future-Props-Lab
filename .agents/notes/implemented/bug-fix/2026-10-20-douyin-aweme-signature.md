# Agent Note: 抖音详情接口签名下载

Status: implemented

## Problem

工具导航「视频下载」依赖本机 yt-dlp 的 Douyin 提取器。抖音 web `aweme/detail` 现要求 `uifid` 与 `x-secsdk-web-signature`，稳定版 yt-dlp 在已提供浏览器 Cookie 时仍返回 403 /「Fresh cookies are needed」，导致站内抖音下载不可用。

## Decision

抖音链接不再走 yt-dlp DouyinIE。后端在 `tool_navigation/video_download_douyin.py` 用公开约定的校验和自行请求详情、按清晰度挑选播放地址，再把 CDN URL 交给本机 yt-dlp 做通用下载；可选浏览器 Cookie 仅用于登录可见内容。B 站路径仍直接调用 yt-dlp。相关产品说明见既有工具 Note：[tool-video-downloader](../feature/2026-10-20-tool-video-downloader.md)。

## Alternatives considered

- **等待 brew 稳定版合并 yt-dlp#17826** — 用户当前无法下载；否决为唯一方案。
- **运行时 `uvx` 拉取社区 douyin-fix 分支** — 首次依赖外网与第三方 fork，桌面路径不可控。
- **继续只提示升级 yt-dlp / 刷新 Cookie** — 无法解决 Argus 签名缺失。

## Consequences

- **收益**：普通公开抖音视频默认可不下发 Cookie 完成下载；错误文案不再误导为「必须升级 yt-dlp」。
- **代价与已知上限**：签名盐与接口属站点侧约定，抖音变更时需再适配；极少数登录墙内容仍依赖浏览器 Cookie；CDN 下载仍需要本机 yt-dlp/ffmpeg。

## Verification

`uv run pytest tests/apps/tools/test_video_download.py`；`npm test -- web/tests/features/video-downloader.test.tsx`；对公开抖音链接做一次真实下载烟测。
