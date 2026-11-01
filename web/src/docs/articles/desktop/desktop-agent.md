<!-- docs: {"group": "desktop", "order": 1, "title": "连接网站 CLI、SDK 与 MCP", "lead": "使用网站地址和账号 API 密钥授权外部客户端。", "evidence": ["sdk/python/src/future_props_lab/website.py", "tests/test_website.py"]} -->

# Future Props Lab Python SDK

独立 SDK 不依赖后端运行时。仓库 `npm run setup` 同时安装 `fpl`；外部环境可运行 `uv pip install ./sdk/python`。

## 连接网站

网站使用地址和 Management API Key 接入：

```sh
fpl --profile codex connect --url http://127.0.0.1:9000
fpl --profile codex operations
fpl --profile codex mcp serve
```

connect 使用隐藏输入读取密钥；自动化可用 `--api-key-stdin` 从安全标准输入读取。不要把密钥写进命令参数或源码。配置目录默认 `~/.config/future-props-lab/`（0700），profile 文件为 0600；可通过 `--profile-dir` 显式指定。服务端撤销密钥后后续调用会重新校验授权。

## Python 调用

```python
from future_props_lab import Client, website_client

# 使用已保存的客户端 profile，不需要桌面 App 或 Unix Socket。
with website_client(profile="codex") as client:
    projects = client.visual.list_projects()
```

也可在进程环境中提供 `FPL_URL`、`FPL_API_KEY`，或向 `Client(base_url=..., api_key=...)` 显式传入凭据。CLI/MCP 只执行服务端登记的业务操作。`fpl open` 返回校验归属的网站链接，不控制浏览器标签页。写入不自动重试，CAS 冲突由调用者重新读取并处理。

生成类型和具名方法来自 OpenAPI；修改后运行 `npm run contracts:generate`，使用 `npm run sdk:check` 检查漂移。业务工作流示例位于 `future_props_lab.workshop_examples`，版本化数据与素材契约以产品官方指南为准。
