<!-- docs: {"group":"desktop","order":1,"title":"连接本地 Agent、CLI 与 Python SDK","lead":"让获准的本机客户端通过正式操作访问当前 App。","evidence":["docs/operations/desktop-agent.md","sdk/python/src/future_props_lab","tests/test_desktop_agent.py"]} -->

# 连接本地 Agent、CLI 与 Python SDK

本地 Agent 接入默认关闭。它用于本机正在运行的桌面 App，不提供远程桌面或额外 MCP 服务器。

## 首次配对

1. 正常登录 App，在「账号设置 → API 密钥」开启「本地 Agent 接入」。
2. 本机客户端运行随 App 打包的 `fpl connect --name "My Agent"`。CLI 不会自动加入系统 PATH，需使用 App 内完整路径或自己设置别名。
3. 在 App 中核对客户端名称、核对码与目标 Workspace，再批准。
4. 使用 `fpl status` 查看连接，使用 `fpl operations` 查询当前明确开放的方法。

完整命令路径：

```sh
"/Applications/Future Props Lab.app/Contents/Resources/fpl/fpl" connect --name "My Agent"
```

不加 `--write` 申请只读权限。读写授权允许登记的写操作，包括删除、模型调用和集成校验，可能产生费用，而且不会逐次弹窗；这与 Amadeus 的逐项写入审批不同。

## 使用 CLI 和 SDK

`fpl call resource.method --input parameters.json` 通过正式业务操作调用 App；参数格式先用 `fpl operations resource.method` 查询。下载必须明确给出 `--output`，已有文件默认不覆盖。

Python 可使用 `desktop_client()` 或 `async_desktop_client()` 复用已配对授权；SDK 安装和常规 HTTP 连接见[自动化快速开始](/docs.html?page=sdk-quickstart)。本地通道只开放已登记业务方法，不开放账号治理、密钥管理或任意系统命令。

## 授权和失败处理

授权绑定配对时的账号和 Workspace，不随 App 后续切换空间；需要取消权限时在 App 的 API 密钥列表撤销对应授权。`fpl disconnect` 只清理本机客户端凭据，不能撤销别处持有的副本。

关闭接入或退出 App 会断开连接。超时和断线不会自动取消全部后台任务，也不会重放写请求；先查询状态，再决定是否重试。不要复制或公开数据根下的 `agent/` 凭据目录。
