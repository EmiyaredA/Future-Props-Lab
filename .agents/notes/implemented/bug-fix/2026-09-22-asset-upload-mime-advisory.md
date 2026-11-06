# Agent Note: 上传以魔数校验为准，声明 MIME 仅作标签

Status: implemented

## Problem

浏览器 / 桌面选择器给 `.mkv` 等容器申报的 `Content-Type` 经常错误（常见为 `video/mp4`、`video/webm`，或带 `; charset=…` 参数）。若在读入内容前用「扩展名 ↔ 声明 MIME」硬拒绝，真实 Matroska 源片无法导入视频编辑器，即使用户文件本身合法。

## Decision

`AssetLibrary.store_upload` / `stage_local_file` 将客户端声明的 MIME 视为**建议标签**：先 `normalize_content_type`（去参数、空值回落 `application/octet-stream`），**不再**因声明 MIME 不在扩展名白名单而抛 `file_type_mismatch`。是否接受文件仍由扩展名白名单 + `looks_like` 魔数（及必要的结构校验）决定；落库 `mime_type` 仅在声明值属于该扩展名已知集合时采用，否则回落到集合内规范值。`.mkv` 额外承认 `video/matroska` / `application/x-matroska` 别名以便正确贴标签。

## Alternatives considered

- **仅扩大 `.mkv` 的 MIME 白名单（含 `video/mp4` / `video/webm`）并继续硬拒绝** — 能修当前片，但会把错误标签写入 `mime_type`，且其他扩展名仍会踩同一浏览器误标坑。
- **前端按扩展名重写 `File` 的 type 再上传** — 绕过症状，不能覆盖非 Web 客户端与 multipart 中间层，且与魔数真源重复。
- **保持硬 MIME 校验，要求用户转封装为「浏览器认的」MP4** — 对 4K HEVC+FLAC+ASS 的番剧源片成本过高，且问题在标签而非内容。

## Consequences

- **收益**：Matroska 等易被误标的源片可直接导入；假后缀仍被魔数挡住。
- **代价与已知上限**：声明 MIME 不再是独立拒绝门；依赖 `looks_like` 覆盖面。模型测试转写等路径仍可保留更严的 MIME 规则，不在本决定范围内。

## Verification

- `uv run pytest tests/apps/visual_workshop/test_visual_workshop.py::test_file_upload_accepts_mkv_despite_browser_mime_mislabels tests/apps/visual_workshop/test_visual_workshop.py::test_file_management_rejects_invalid_content_and_scope -q`
- 桌面开发下用真实 `.mkv`（即使浏览器申报 `video/mp4`）上传到视频编辑器素材库应成功。
