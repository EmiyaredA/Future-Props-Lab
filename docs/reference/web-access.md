# 本地与公网访问

Mac 后台服务提供网站，本机入口默认 `http://127.0.0.1:9000`。用户级 LaunchAgent 在登录后运行；关闭浏览器不影响服务和后台任务。正式数据与模型保存在项目 `.runtime/`，私人凭据位于 `backend/config.toml` 与 `backend/web-access/credentials/`。

## 操作与结果

1. 在 Mac 本机入口使用管理员登录，从头像菜单打开「本地与公网访问」。其他入口不显示该菜单。
2. 核对公网来源及状态，点击「检查连接」。显示 ready 表示此进程与网关探针一致；错误信息需先处理再继续。
3. 已部署匹配构建与专用 SSH 凭据后可「开启公网」；从另一设备访问原 HTTPS 域名并登录，同一账号应看到相同作品。
4. 「关闭公网」停止隧道及重连，本机服务和已提交后台任务继续运行。公网管理员不能调用这些控制 API。

网关资料通过停机备份后的 TOML 配置维护，不把私钥或管理员密码放进网页。专用密钥只允许指定远端回环转发；必须使用已核验 known_hosts，不能关闭指纹校验。旧 LaunchAgent 隧道保持停用，避免两套重连管理器竞争。

## 构建与发布

`npm run build:studio` 生成 `.local/studio-release/`，包含 build.json、逐文件 SHA256 清单与 gzip/Brotli 文件。相邻 remote-control 项目拥有发布工具和 Caddy 模板。先发布同一产物，再切换 Mac 后端，最后开启公网。云端不存储数据库、素材或供应商密钥。

公网回环监听默认 28081，关闭其 lifespan，复用本机业务进程。Host、Origin、CSRF、账号权限均校验；Cookie 按公网 HTTPS 设置 Secure。主机管理依据真实监听入口判定，伪造转发头或本机 Host 不会获得权限。

## 自动化与故障恢复

CLI、SDK、MCP 在本机通过网站地址和 Management API Key 访问；浏览器中创建并安全输入密钥，使用独立 profile。`fpl open` 返回归属校验后的网站链接，不切换现有编辑页。关闭或刷新 Amadeus 后可重新读取后台运行状态，未知写入和模型提交不自动重试。

服务日志在 `.runtime/logs/`。更新、配置变更及数据恢复遵守[生产部署](../operations/production-deployment.md)的停机快照流程。
