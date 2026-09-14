# 本地 Agent 接入：CLI / Python SDK

此功能操作本机正在运行的 App，不是云同步，也不是远程桌面。首期不包含 MCP、免登录或实时语音
WebSocket 接入。现有账号、工作区和文件保持原位，不新增 schema。

## 首次连接

1. 启动新版 App，正常登录，在「账号设置 → API 密钥」开启「本地 Agent 接入」。
2. 执行下面的命令，在 App 中核对客户端名称、核对码和目标工作区后批准。
3. 后续可以直接调用；默认有效期 90 天，在 API 密钥列表中撤销或续期 `Agent:` 开头的授权。

```sh
"/Applications/Future Props Lab.app/Contents/Resources/fpl/fpl" connect --name "My Agent" --write
"/Applications/Future Props Lab.app/Contents/Resources/fpl/fpl" status
"/Applications/Future Props Lab.app/Contents/Resources/fpl/fpl" operations
```

不传 `--write` 只申请读取权限。读写权限包括删除、外部模型调用与可能产生的费用，不会逐次弹窗。
任何 Agent 自身仍需遵守用户给它的授权，不应把技术上允许的操作等同于用户请求。

可以自行给完整命令设置 `fpl` 别名；安装程序不修改 PATH 或系统目录。以下示例假定已经设置别名。

## 操作示例

```sh
fpl operations visual.create_project
fpl call visual.list_projects --input list-parameters.json
fpl call visual.create_project --input new-project.json
fpl call files.upload_file --input upload-parameters.json --file upload=/absolute/path/image.png
fpl call visual.export_project_snapshot --input project-parameters.json --output project.zip
fpl wait inference.get_task --input task-parameters.json --timeout 300
fpl open visual PROJECT_ID
```

输入文件是 SDK 关键字参数对象，例如创建视觉项目使用
`{"body":{"title":"Agent 创作","kind":"image"}}`，项目参数为 `{"project_id":"实际 ID"}`，
上传参数为 `{"body":{}}`；空查询参数为 `{}`。也可以使用 `--input -` 从标准输入读取 JSON。
`fpl operations resource.method` 给出当前 App 方法、SDK 参数与 schema；不支持的方法默认拒绝。

开放六个工坊、笔记/知识库、素材、生成与独立推理任务，以及模型目录和日志查询。
不开放账号治理、供应商凭据设置、集成管理、文件存储迁移或任意系统命令。
下载必须显式指定 `--output`，已有文件默认拒绝覆盖；只有显式 `--overwrite` 才覆盖。
SSE 每个事件输出一行 JSON；结果在 stdout，进度与错误在 stderr，不把密钥写入输出。

退出码：0 成功；2 输入/本地配置错误；3 未授权或权限不足；4 API 错误（包括 revision 冲突）；
5 任务失败/取消；6 等待超时或打开未完成；7 连接中断；130 用户中断。
等待超时不会取消后台任务。断线不会自动重放请求，尤其不会重新提交付费模型任务；先查询再决定。

## Python SDK

内置 CLI 不依赖外部 Python；Python 程序需要 Python 3.11+ 和交付的 SDK wheel。

```python
from future_props_lab import desktop_client, async_desktop_client

with desktop_client() as app:
    projects = app.visual.list_projects()
    project = app.visual.create_project(body={"title": "SDK 创作", "kind": "image"})

# 已保存的授权可以用于异步调用
async def inspect_projects():
    async with async_desktop_client() as app:
        return await app.visual.list_projects()
```

首次配对可使用 `pair_desktop(name=..., write=True, on_pending=...)` 或异步
`pair_desktop_async(...)`；回调只收到核对信息，返回值不含密钥。
业务方法继续使用已有生成 SDK。既有 `Client(base_url=..., api_key=...)` Web 接入不变。

## 安全与生命周期

正式版数据根下新增 `agent/`，权限 0700：`settings.json` 记录开关，`connection.json` 是无密钥的
连接描述，`credentials-PROFILE.json` 保存客户端授权，均为 0600。Unix Socket 位于每次启动创建的
短路径私有目录。SDK 验证描述、凭据和 Socket 的所有者及权限，不信任符号链接。
开发版独立发现，通过 `--development` 选择；`--data-dir` 只用于显式指定隔离数据根。
`--profile NAME` 可区分客户端，各 profile 独立授权。

密钥绑定批准时的账号和工作区，不跟随 App 后续切换；App 自动导航也不切换账号/工作区。
Mac 同一用户下的进程仍能访问该用户的授权文件，此机制不承诺隔离同用户的恶意软件。
不要把 `agent/` 复制给其他用户或提交到仓库；备份包含凭据时应按敏感数据管理。

关闭接入或退出 App 会切断连接，后台崩溃后需要用户重试；重启后重新发现 Socket，授权仍有效。
`fpl disconnect` 只清除本机 profile 凭据；要取消其他副本的访问能力，必须在 App 中撤销对应密钥。
CLI 无需登录密码，私有桌面启动 token 从不写入描述或交给 SDK。

Agent 写入后 App 显示外部变更提示；「查看更新」经过现有未保存保护再刷新。打开请求在编辑器
有未保存内容时等待处理，也可在通知中取消；不会静默覆盖草稿。

## 构建和验收

```sh
npm run test:desktop
npm run test:sdk
npm run contracts:check
npm run package:desktop
npm run sdk:build
```

CLI 是单独的 PyInstaller onedir 产物，位置为 App 内 `Contents/Resources/fpl/fpl`；不要单独移动
可执行文件而遗漏其 `_internal/`。构建验证检查 arm64、动态库、ad-hoc 签名及系统 PATH 下的 CLI 启动。
SDK wheel 不发布到公共仓库，DMG 不宣称已公证。自动测试使用临时账号和素材，不访问真实 App 数据。
