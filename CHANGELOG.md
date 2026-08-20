# 变更日志

本项目按交付批次记录用户可见变化与重要工程治理。日期采用 `YYYY-MM-DD`。

## Unreleased

### Changed

- 以 Cookie Session、账号中心和逻辑多 Workspace 替换 Studio 管理令牌，加入管理员账号治理、
  成员邀请、Management API Key、安全审计与登录后公开作品展台。
- Galgame Story 文档与文档说明统一到 1.4，前端网络边界使用生成契约并规范化当前内部模型。
- 拆分大型编辑器、播放器、资源工作区、测试和业务样式，增加统一模块尺寸门禁。
- 图片/视频生成 Runner 复用供应商提交、轮询、临时上传、安全错误和下载运行时。
- 自绘下拉补齐 combobox/listbox ARIA 和完整键盘操作。
- 明确 Node.js 24、Python 3.11 最低版本，并增加 Python 3.11/3.14、Web 与 Chromium CI。

### Documentation

- 增加贡献指南、故障排查、备份恢复与交付检查表。
- 更新账号引导、Workspace 隔离、备份范围与 Cookie 安全配置，移除旧管理令牌说明。
